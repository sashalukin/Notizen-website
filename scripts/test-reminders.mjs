import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import { encode } from 'next-auth/jwt';
const dbConfig=JSON.parse(await readFile('/tmp/notizen-test-db.json','utf8'));
const db=new pg.Pool(dbConfig);
await db.query(await readFile('setup.sql','utf8'));
const user=randomUUID(), other=randomUUID();
await db.query('INSERT INTO users(id,name,email) VALUES($1,$2,$3),($4,$5,$6)',[user,'Offline Test',`${user}@example.invalid`,other,'Other Test',`${other}@example.invalid`]);
const secret=randomBytes(32).toString('hex');
const url='http://localhost:3210';
const connection=`postgresql:///notizen_test?host=${encodeURIComponent(dbConfig.host)}&port=55439&user=${encodeURIComponent(dbConfig.user)}`;
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3210','-H','127.0.0.1'],{
  env:{...process.env,DATABASE_URL:connection,AUTH_SECRET:secret,AUTH_TRUST_HOST:'true',NEXTAUTH_URL:url,NODE_ENV:'production'},stdio:['ignore','ignore','pipe']});
let errors='';server.stderr.on('data',d=>{errors+=d.toString();});
let browser;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function eventually(fn,label) { for(let i=0;i<80;i++){if(await fn())return;await sleep(200);}throw new Error(label); }
async function authenticatedContext(who=user) {
  const c=await browser.newContext({viewport:{width:1100,height:800}});
  const token=await encode({token:{id:who,sub:who,name:'Offline Test',email:`${who}@example.invalid`},secret,salt:'authjs.session-token',maxAge:3600});
  await c.addCookies([{name:'authjs.session-token',value:token,url,httpOnly:true,sameSite:'Lax'}]);
  return c;
}
async function synced(page) { await page.locator('[data-sync-state="synced"]').waitFor({timeout:30000}); }
async function newNote(page) {
  const previous=page.url();
  await page.getByTitle('New Note',{exact:true}).click();
  await page.waitForURL(value => value.href !== previous);
  await page.getByPlaceholder('Untitled').waitFor();
}
async function title(page,value) {await page.getByPlaceholder('Untitled').fill(value);}
try {
  await eventually(async()=>{try{return(await fetch(url)).ok;}catch{return false;}},'server startup');
  browser=await chromium.launch({headless:false});
  const context=await authenticatedContext();
  const page=await context.newPage();
  const runtimeErrors=[];page.on('pageerror',e=>runtimeErrors.push(e.message));
  await page.goto(url+'/notes');await synced(page);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await newNote(page);await title(page,'Reminder delivery');await synced(page);
  const id=new URL(page.url()).pathname.split('/')[2];
  async function schedule() {
    // Pick a future local minute exactly as the datetime-local picker does.
    return page.locator('input[type=datetime-local]').evaluate(el=>{
      const date=new Date(Date.now()+120000);date.setSeconds(0,0);
      const pad=n=>String(n).padStart(2,'0');
      const value=`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
      return date.toISOString();
    });
  }
  async function persistedReminder(value) {
    await eventually(async()=> (await db.query('SELECT remind_at FROM notes WHERE id=$1',[id])).rows[0].remind_at?.toISOString()===value,'reminder persisted');
  }
  let due=await schedule();await persistedReminder(due);
  const permission=await page.evaluate(()=>Notification.permission);
  if(permission==='default') await page.getByRole('button',{name:'Enable notifications',exact:true}).waitFor();
  else await page.getByText('Notifications are blocked.', {exact:false}).waitFor();
  await page.clock.setFixedTime(new Date(Date.parse(due)+1000));
  await sleep(1200);
  assert.equal(await page.getByRole('alert').filter({hasText:'Reminder: Reminder delivery'}).count(),0);
  assert.equal((await db.query('SELECT remind_at FROM notes WHERE id=$1',[id])).rows[0].remind_at.toISOString(),due,'No silent clearing without permission');
  page.once('dialog',d=>d.accept());await page.getByTitle(/^Reminder:/).click();
  await eventually(async()=> (await db.query('SELECT remind_at FROM notes WHERE id=$1',[id])).rows[0].remind_at===null,'explicit dismissal persists');
  console.log('PASS: missing permission retains scheduled reminder without an in-app banner');

  await page.evaluate(()=>{
    window.acceptedNotifications=[];window.notificationAttempts=0;
    window.failNotification=false;
    const original=ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification=async function(title,options){
      window.notificationAttempts++;
      if (window.failNotification) throw new Error('Simulated notification service failure');
      await original.call(this,title,options);
      window.acceptedNotifications.push({title,body:options.body,url:options.data.url});
    };
  });
  await context.grantPermissions(['notifications'],{origin:url});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  const accepted=()=>page.evaluate(()=>window.acceptedNotifications.filter(n=>n.title==='Notizen reminder').length);
  const reset=async()=>{
    await page.getByTitle('Set reminder',{exact:true}).waitFor();
    await eventually(async()=> (await db.query('SELECT remind_at FROM notes WHERE id=$1',[id])).rows[0].remind_at===null,'automatic reminder reset persisted');
  };
  due=await schedule();await persistedReminder(due);
  assert.equal(await page.getByRole('button',{name:'Test notification',exact:true}).count(),0);
  await page.clock.setFixedTime(new Date(Date.parse(due)+1000));
  await eventually(async()=>await accepted()===1,'browser accepted service-worker notification');await reset();
  const notification=await page.evaluate(()=>window.acceptedNotifications.find(n=>n.title==='Notizen reminder'));
  assert.deepEqual(notification,{title:'Notizen reminder',body:'Reminder delivery',url:`/notes/${id}`});
  const stillShown=await page.evaluate(async()=> (await(await navigator.serviceWorker.getRegistration('/')).getNotifications()).some(n=>n.title==='Notizen reminder'));
  assert.equal(stillShown,true,'Reset must not immediately close the system notification');
  assert.equal(await page.locator('[aria-label="Due reminders"]').count(),0);
  console.log('PASS: no test control; automatic bell/server reset keeps the system notification available');

  due=await schedule();await persistedReminder(due);
  await page.clock.setFixedTime(new Date(Date.parse(due)+1000));
  await eventually(async()=>await accepted()===2,'second reminder on same note delivered');await reset();
  console.log('PASS: a later reminder on the same note also delivers and resets');

  due=await schedule();await persistedReminder(due);
  await page.evaluate(()=>{window.failNotification=true;});
  await page.clock.setFixedTime(new Date(Date.parse(due)+1000));
  await page.getByText('Notification could not be shown.',{exact:false}).waitFor();
  assert.equal((await db.query('SELECT remind_at FROM notes WHERE id=$1',[id])).rows[0].remind_at.toISOString(),due,'failed notification remains scheduled');
  await page.clock.setFixedTime(new Date(Date.parse(due)+61000));
  await page.evaluate(()=>{window.failNotification=false;window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('notizen-resume'));});
  await sleep(1600);
  assert.equal(await page.evaluate(()=>window.notificationAttempts),3,'No automatic or resume retries');
  assert.equal(await page.getByRole('button',{name:'Retry notification',exact:true}).count(),0);
  page.once('dialog',d=>d.accept());await page.getByTitle(/^Reminder:/).click();await reset();
  due=await schedule();await persistedReminder(due);
  await page.clock.setFixedTime(new Date(Date.parse(due)+1000));
  await eventually(async()=>await accepted()===3,'newly scheduled reminder delivers');await reset();
  console.log('PASS: failed sends are not retried; a newly scheduled reminder still works');

  due=await schedule();await persistedReminder(due);
  await page.evaluate(noteId=>{
    const original=IDBObjectStore.prototype.put;
    window.restoreWrites=()=>{IDBObjectStore.prototype.put=original;};
    IDBObjectStore.prototype.put=function(value,...args){
      if(this.name==='notes' && value.id===noteId && value.remind_at===null) throw new DOMException('Storage unavailable','QuotaExceededError');
      return original.call(this,value,...args);
    };
  },id);
  await page.clock.setFixedTime(new Date(Date.parse(due)+1000));
  await page.getByText('Notification sent, but the reminder could not be reset.',{exact:false}).waitFor();
  assert.equal(await accepted(),4);
  await page.reload(); // restores writes; the durable receipt must suppress another notification
  await reset();
  const receipt=await page.evaluate(async ({user,id})=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('notizen-offline');r.onsuccess=()=>resolve(r.result);});
    const result=await new Promise(resolve=>{const r=db.transaction('meta').objectStore('meta').get(['reminder-delivery',user,id]);r.onsuccess=()=>resolve(r.result);});db.close();return result;
  },{user,id});
  assert.equal(receipt,due);
  console.log('PASS: notification acceptance survives reload after reset write failure');

  due=await schedule();await persistedReminder(due);
  page.once('dialog',d=>d.accept());await page.getByTitle(/^Reminder:/).click();
  await reset();
  await page.clock.setFixedTime(new Date(Date.parse(due)+1000));await sleep(1200);
  assert.equal(await page.getByRole('button',{name:'Dismiss reminder',exact:true}).count(),0);
  console.log('PASS: canceled reminder stays canceled');

  await context.clearPermissions();
  await page.evaluate(()=>Object.defineProperty(window,'Notification',{value:undefined,configurable:true}));
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  due=await schedule();await persistedReminder(due);
  await page.getByText('System notifications are unavailable here.', {exact:false}).waitFor();
  await context.setOffline(true);await page.clock.setFixedTime(new Date(Date.parse(due)+1000));
  await page.getByTitle(/^Reminder:/).waitFor();
  assert.equal(await page.locator('[aria-label="Due reminders"]').count(),0);
  await page.reload();
  await page.getByTitle(/^Reminder:/).waitFor();
  assert.equal(await page.locator('[aria-label="Due reminders"]').count(),0);
  page.once('dialog',d=>d.accept());await page.getByTitle(/^Reminder:/).click();
  await page.getByRole('button',{name:'Dismiss reminder',exact:true}).waitFor({state:'hidden'});
  await context.setOffline(false);await synced(page);
  await eventually(async()=> (await db.query('SELECT remind_at FROM notes WHERE id=$1',[id])).rows[0].remind_at===null,'offline dismissal syncs');
  assert.deepEqual(runtimeErrors,[]);
  console.log('PASS: unsupported API and offline reload retain reminder without a banner; cancellation synchronizes');
} finally {
  await browser?.close();server.kill('SIGTERM');await db.end();
}
