import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile, mkdir, unlink } from 'node:fs/promises';
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
const localFiles=[];
function wav() {
  const size=16000, b=Buffer.alloc(44+size*2);
  b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);
  b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(size*2,40);
  for(let i=0;i<size;i++)b.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/8000)*3000),44+i*2);
  return b;
}
try {
  await eventually(async()=>{try{return(await fetch(url)).ok;}catch{return false;}},'server startup');
  browser=await chromium.launch({headless:true});
  const context=await authenticatedContext();const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+'/notes');await synced(page);
  await newNote(page);await title(page,'Audio test');await synced(page);
  const id=new URL(page.url()).pathname.split('/')[2];
  await page.locator('[contenteditable=true]').first().fill('Existing note text');
  await page.getByLabel('Audio file',{exact:true}).setInputFiles({name:'voice <sample>.wav',mimeType:'audio/wav',buffer:wav()});
  await page.locator('audio').waitFor();
  const src=await page.locator('audio').getAttribute('src');
  localFiles.push('public/uploads/'+src.split('/').pop());
  const uploaded = await context.request.get(url+src);
  assert.equal(uploaded.status(),200,'uploaded file is served');
  await page.waitForFunction(()=>document.querySelector('audio')?.readyState>=1);
  assert.equal(await page.locator('audio').evaluate(a=>Math.round(a.duration)),2);
  await page.locator('audio').evaluate(a=>a.play());
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>0.1);
  await page.locator('audio').evaluate(a=>{a.pause();a.currentTime=1;});
  await page.waitForFunction(()=>Math.abs(document.querySelector('audio').currentTime-1)<0.1);
  await eventually(async()=> (await db.query('SELECT content FROM notes WHERE id=$1',[id])).rows[0].content.includes('<audio'),'audio reference persisted');
  await page.reload();await page.locator('audio').waitFor();
  assert.equal(await page.locator('figure').getAttribute('contenteditable'),'false');
  assert.equal(await page.locator('figcaption').innerText(),'voice <sample>.wav');
  assert.ok((await page.locator('[contenteditable=true]').first().innerText()).includes('Existing note text'));
  assert.equal(await page.locator('sample').count(),0);
  await page.locator('audio').evaluate(a=>a.play());
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>0.1);
  await page.locator('audio').evaluate(a=>a.pause());
  console.log('PASS: actual WAV upload, playback, seeking, persisted player after reload and safe filename');
  const range=await context.request.get(url+src,{headers:{Range:'bytes=0-43'}});
  assert.equal(range.status(),206);assert.equal((await range.body()).length,44);
  const invalid=await context.request.post(url+'/api/upload',{multipart:{kind:'audio',file:{name:'bad.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('<script>alert(1)</script>')}}});
  assert.equal(invalid.status(),400);
  const blocked=await context.request.post(url+'/api/upload',{headers:{Origin:'https://other.example'},multipart:{kind:'audio',file:{name:'test.wav',mimeType:'audio/wav',buffer:wav()}}});
  assert.equal(blocked.status(),403);
  const anonymous=await fetch(url+'/api/upload',{method:'POST'});assert.equal(anonymous.status,401);
  console.log('PASS: audio range delivery, authentication, origin checks and disguised-file rejection');
  await page.getByRole('button',{name:'Remove audio voice <sample>.wav'}).click();
  await eventually(async()=> !(await db.query('SELECT content FROM notes WHERE id=$1',[id])).rows[0].content.includes('<audio'),'removal persisted');
  await page.reload();assert.equal(await page.locator('audio').count(),0);
  await context.setOffline(true);await page.getByRole('button',{name:'Attach audio',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Connect to the internet to upload audio.'}).waitFor();
  await context.setOffline(false);
  await page.route('**/api/upload',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Upload failed. Please try again.'})}));
  await page.getByLabel('Audio file',{exact:true}).setInputFiles({name:'fail.wav',mimeType:'audio/wav',buffer:wav()});
  await page.getByRole('alert').filter({hasText:'Upload failed.'}).waitFor();
  assert.equal(await page.locator('audio').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: remove/reload, offline guidance and upload failure without broken attachment');
} finally {
  await browser?.close();server.kill('SIGTERM');await db.end();
  for(const file of localFiles)await unlink(file).catch(()=>{});
}
