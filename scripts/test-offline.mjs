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
async function synced(page) { await page.getByTestId('sync-status').filter({hasText:'Synchronized'}).waitFor({timeout:30000}); }
async function newNote(page) {
  const previous=page.url();
  await page.getByTitle('New Note',{exact:true}).click();
  await page.waitForURL(value => value.href !== previous);
  await page.getByPlaceholder('Untitled').waitFor();
}
async function title(page,value) {await page.getByPlaceholder('Untitled').fill(value);}
async function body(page,value) {await page.locator('[contenteditable]').fill(value);}
async function localTitle(page,value) { await page.waitForFunction(async title=>{
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('notizen-offline');r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
  const rows=await new Promise(resolve=>{const r=db.transaction('notes').objectStore('notes').getAll();r.onsuccess=()=>resolve(r.result);});db.close();return rows.some(n=>n.title===title);
},value); }
try {
  await eventually(async()=>{try{return(await fetch(url)).ok;}catch{return false;}},'server startup');
  browser=await chromium.launch({headless:true});
  const c=await authenticatedContext(); let page=await c.newPage();
  const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto(url+'/notes'); await synced(page);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await newNote(page);
  await title(page,'Offline integration');await body(page,'Original text');await synced(page);
  const noteId=new URL(page.url()).pathname.split('/')[2];
  await c.setOffline(true);
  await page.getByTestId('sync-status').filter({hasText:'No internet'}).waitFor();
  await title(page,'Edited in airplane mode');await body(page,'Persistent offline draft');
  await localTitle(page,'Edited in airplane mode');
  await page.reload();
  await page.getByPlaceholder('Untitled').filter({}).waitFor();
  assert.equal(await page.getByPlaceholder('Untitled').inputValue(),'Edited in airplane mode');
  assert.equal(await page.locator('[contenteditable]').innerText(),'Persistent offline draft');
  console.log('PASS: offline edit survives deep-link reload');
  await newNote(page);
  await title(page,'Created without internet');await body(page,'New offline body');await localTitle(page,'Created without internet');
  const newId=new URL(page.url()).pathname.split('/')[2];
  await page.close();page=await c.newPage();
  await page.goto(url+`/notes/${newId}`);
  await page.getByPlaceholder('Untitled').waitFor();
  assert.equal(await page.getByPlaceholder('Untitled').inputValue(),'Created without internet');
  console.log('PASS: offline create survives closing and reopening the tab');
  await c.setOffline(false);await synced(page);
  assert.equal((await db.query('SELECT content FROM notes WHERE id=$1',[newId])).rows[0].content,'New offline body');
  assert.equal((await db.query('SELECT title FROM notes WHERE id=$1',[noteId])).rows[0].title,'Edited in airplane mode');
  console.log('PASS: reconnect syncs creates and updates');
  const device2=await authenticatedContext();const p2=await device2.newPage();await p2.goto(url+`/notes/${newId}`);await synced(p2);
  await c.setOffline(true);await body(page,'device one draft');await localTitle(page,'Created without internet');await sleep(300);
  await body(p2,'device two version');await synced(p2);
  await eventually(async () => (await db.query('SELECT content FROM notes WHERE id=$1',[newId])).rows[0].content === 'device two version', 'second device committed before reconnect');
  await c.setOffline(false);await page.getByRole('button',{name:'Keep both',exact:true}).waitFor({timeout:30000});
  await page.getByRole('button',{name:'Keep both',exact:true}).click();await synced(page);
  const versions=(await db.query('SELECT content FROM notes WHERE user_id=$1 AND deleted_at IS NULL',[user])).rows.map(r=>r.content);
  assert.ok(versions.includes('device one draft'));assert.ok(versions.includes('device two version'));
  console.log('PASS: two-device conflict preserves both versions');
  // A session expiry never discards drafts; replay resumes after the same user signs in again.
  await c.setOffline(true);await title(page,'Draft with expired session');await localTitle(page,'Draft with expired session');
  await c.clearCookies();await c.setOffline(false);
  await page.getByTestId('sync-status').filter({hasText:'Sign in to sync'}).waitFor({timeout:30000});
  assert.equal(await page.getByPlaceholder('Untitled').inputValue(),'Draft with expired session');
  const token=await encode({token:{id:user,sub:user,name:'Offline Test'},secret,salt:'authjs.session-token',maxAge:3600});
  await c.addCookies([{name:'authjs.session-token',value:token,url,httpOnly:true,sameSite:'Lax'}]);
  await page.evaluate(()=>window.dispatchEvent(new Event('notizen-resume')));await synced(page);
  console.log('PASS: expired authentication preserves pending edits and resume retries');
  // Legacy endpoint deletion creates a tombstone that a second device can download.
  const deleteId=new URL(page.url()).pathname.split('/')[2];
  await c.setOffline(true);page.once('dialog',d=>d.accept());
  await page.locator('[class*="noteItem"]').filter({has:page.locator('[class*="noteTitle"]',{hasText:'Draft with expired session'})}).getByTitle('Delete note').click();
  await c.setOffline(false);await synced(page);
  assert.ok((await db.query('SELECT deleted_at FROM notes WHERE id=$1',[deleteId])).rows[0].deleted_at);
  console.log('PASS: offline deletion reaches the server as a tombstone');
  const foreign=await authenticatedContext(other);const pf=await foreign.newPage();await pf.goto(url+'/notes');await synced(pf);
  assert.equal(await pf.getByText('Created without internet',{exact:true}).count(),0);
  const denied=await pf.evaluate(async ({id,userId})=>{
    const r=await fetch('/api/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountId:userId,operations:[]})});return r.status;
  },{id:newId,userId:user});assert.equal(denied,403);
  console.log('PASS: account isolation and replay ownership validation');
  // Simulate a server commit whose acknowledgement never reaches the browser.
  let interrupted=false;
  await page.route('**/api/sync',async route=>{
    if (route.request().method()==='POST' && !interrupted) {
      interrupted=true;
      await route.fetch();
      await route.abort('connectionreset');
    } else await route.continue();
  });
  await newNote(page);await title(page,'Lost response retry');
  await eventually(async()=>interrupted,'interrupted upload');
  await page.evaluate(()=>window.dispatchEvent(new Event('notizen-resume')));await synced(page);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM notes WHERE user_id=$1 AND title=$2',[user,'Lost response retry'])).rows[0].count,1);
  await page.unroute('**/api/sync');
  console.log('PASS: lost acknowledgement retry creates no duplicate');

  await mkdir('/tmp/notizen-offline-artifacts',{recursive:true});
  await c.setOffline(true);await page.screenshot({path:'/tmp/notizen-offline-artifacts/offline.png'});
  await c.setOffline(false);await synced(page);await page.screenshot({path:'/tmp/notizen-offline-artifacts/synchronized.png'});
  await page.getByTitle('Sign out',{exact:true}).click();
  await page.waitForURL(url+'/');
  await page.goto(url+'/notes');
  await page.getByText('Sign in online once', {exact:false}).waitFor();
  assert.equal(await page.getByText('Lost response retry',{exact:true}).count(),0);
  assert.deepEqual(pageErrors,[]);
  console.log('PASS: no browser runtime errors; screenshots saved');
} finally {
  await browser?.close();server.kill('SIGTERM');await db.end();
}
