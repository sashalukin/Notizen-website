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
  browser=await chromium.launch({headless:true});
  const context=await authenticatedContext();
  await context.addInitScript(()=>{
    Object.defineProperty(window,'Notification',{value:undefined,configurable:true});
    window.nativeState={permission:'default',active:true};
    window.nativeMessages=[];
    window.AndroidNotifications={postMessage(raw){
      const message=JSON.parse(raw);window.nativeMessages.push(message);
      if(message.type==='GET_STATE' || message.type==='REQUEST_PERMISSION') {
        if(message.type==='REQUEST_PERMISSION') window.nativeState.permission='granted';
        queueMicrotask(()=>window.AndroidNotifications.onmessage?.({data:JSON.stringify({requestId:message.requestId,...window.nativeState})}));
      }
      // SHOW_NOTIFICATION never replies.
    }};
  });
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+'/notes');await synced(page);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await newNote(page);await title(page,'Native offline reminder');await synced(page);
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

  const shows=()=>page.evaluate(()=>window.nativeMessages.filter(m=>m.type==='SHOW_NOTIFICATION'));
  async function persisted(due) {
    await eventually(async()=> (await db.query('SELECT remind_at FROM notes WHERE id=$1',[id])).rows[0].remind_at?.toISOString()===due,'reminder persisted');
  }
  async function reset() { await page.getByTitle('Set reminder',{exact:true}).waitFor(); }
  let due=await schedule();await persisted(due);
  await page.getByRole('button',{name:'Enable notifications',exact:true}).click();
  await page.getByRole('button',{name:'Enable notifications',exact:true}).waitFor({state:'hidden'});
  await page.evaluate(()=>{window.nativeState.active=false;});
  await page.clock.setFixedTime(new Date(Date.parse(due)+1000));
  await sleep(1500);
  assert.equal((await shows()).length,0,'Background/inactive tab cannot send or consume reminder');
  await page.getByTitle(/^Reminder:/).waitFor();
  await context.setOffline(true);
  await page.evaluate(()=>{window.nativeState.active=true;window.dispatchEvent(new Event('notizen-resume'));});
  await reset();
  let messages=await shows();assert.equal(messages.length,1);
  assert.deepEqual(messages[0],{version:1,type:'SHOW_NOTIFICATION',notificationId:`${user}:${id}:${due}`,title:'Notizen reminder',body:'Native offline reminder',noteId:id});
  await page.reload();await reset();
  assert.equal((await shows()).length,0,'Offline reload cannot send completed reminder again');
  await context.setOffline(false);await synced(page);
  console.log('PASS: native permission, inactive suppression, foreground catch-up, exact payload, offline reset without acknowledgment and reload deduplication');

  await page.evaluate(()=>{window.nativeState.permission='denied';window.dispatchEvent(new Event('focus'));});
  due=await schedule();await persisted(due);
  await page.getByText('Notifications are blocked.',{exact:false}).waitFor();
  await page.clock.setFixedTime(new Date(Date.parse(due)+1000));await reset();
  assert.equal((await shows()).length,1,'Permission-blocked native trigger still resets without acknowledgment');
  await page.evaluate(()=>window.dispatchEvent(new Event('notizen-resume')));await sleep(1300);
  assert.equal((await shows()).length,1,'No retries');
  console.log('PASS: blocked native notifications reset, with no retries or banner');

  due=await schedule();await persisted(due);
  page.once('dialog',d=>d.accept());await page.getByTitle(/^Reminder:/).click();await reset();
  assert.ok(await page.evaluate(()=>window.nativeMessages.some(m=>m.type==='CLOSE_NOTIFICATION')));
  await page.clock.setFixedTime(new Date(Date.parse(due)+1000));await sleep(1200);
  assert.equal((await shows()).length,1,'Canceled reminder cannot trigger');
  assert.deepEqual(errors,[]);
  console.log('PASS: cancellation uses native path and no JavaScript errors without Notification API');
} finally { await browser?.close();server.kill('SIGTERM');await db.end(); }
