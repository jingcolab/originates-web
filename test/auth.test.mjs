import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'originates-test-'));
const base='http://localhost:3197';
let child;
function start(){child=spawn(process.execPath,['server.mjs'],{env:{...process.env,NODE_ENV:'test',PORT:'3197',APP_ORIGIN:base,DATA_DIR:dir},stdio:'pipe'});}
async function ready(){for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Server did not start');}
async function stop(){await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});}
async function post(path,data,headers={}){return fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});}
const account={email:'test@example.com',password:'test-only-password-1234'};
let token;
before(async()=>{start();await ready();});after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
test('protected routes reject unauthenticated visitors',async()=>{assert.equal((await fetch(base+'/api/me')).status,401);const r=await fetch(base+'/app',{redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/login');});
test('registration validates password and email',async()=>{assert.equal((await post('/api/register',{...account,password:'short'})).status,400);assert.equal((await post('/api/register',{...account,email:'bad'})).status,400);});
test('registration creates persistent account without disclosing duplicates',async()=>{const a=await post('/api/register',account);assert.equal(a.status,200);assert.deepEqual(await a.json(),await(await post('/api/register',account)).json());});
test('wrong password and unknown account produce same failure',async()=>{const a=await post('/api/login',{...account,password:'wrong-password-1234'});const b=await post('/api/login',{...account,email:'missing@example.com'});assert.equal(a.status,401);assert.equal(b.status,401);assert.deepEqual(await a.json(),await b.json());});
test('login normalizes email and sets HttpOnly SameSite cookie',async()=>{const r=await post('/api/login',{...account,email:' TEST@example.com '});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);token=cookie.split(';')[0];const me=await fetch(base+'/api/me',{headers:{Cookie:token}});assert.equal(me.status,200);assert.equal((await me.json()).user.email,account.email);assert.equal((await fetch(base+'/app',{headers:{Cookie:token}})).status,200);});
test('accounts and sessions survive server restart',async()=>{await stop();start();await ready();assert.equal((await fetch(base+'/api/me',{headers:{Cookie:token}})).status,200);assert.equal((await post('/api/login',account)).status,200);});
test('cross-origin and missing-origin writes are blocked',async()=>{assert.equal((await post('/api/logout',{}, {Origin:'https://evil.example',Cookie:token})).status,403);const r=await fetch(base+'/api/logout',{method:'POST',headers:{Cookie:token}});assert.equal(r.status,403);assert.equal((await fetch(base+'/api/me',{headers:{Cookie:token}})).status,200);});
test('malformed JSON, oversized body and wrong content type rejected',async()=>{let r=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{'});assert.equal(r.status,400);r=await post('/api/login',{x:'a'.repeat(9000)});assert.equal(r.status,413);r=await post('/api/login',account,{'Content-Type':'text/plain'});assert.equal(r.status,415);});
test('private files are not served, security headers are present',async()=>{for(const path of ['/server.mjs','/data/originates.sqlite','/.env','/app.html'])assert.equal((await fetch(base+path)).status,404);const r=await fetch(base+'/login');assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(r.headers.get('cache-control'),'no-store');});
test('logout invalidates session server-side',async()=>{const r=await post('/api/logout',{}, {Cookie:token});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await fetch(base+'/api/me',{headers:{Cookie:token}})).status,401);});
test('forged session does not authenticate',async()=>{assert.equal((await fetch(base+'/api/me',{headers:{Cookie:'originates_session='+ 'a'.repeat(64)}})).status,401);});
test('login attempts are rate limited',async()=>{let response;for(let i=0;i<22;i++)response=await post('/api/login',{email:'rate@example.com',password:'wrong-password-1234'});assert.equal(response.status,429);});

test('passwords and session tokens are not stored in plaintext; expired sessions rejected',async()=>{
  const r=await post('/api/login',account);const raw=r.headers.get('set-cookie').split(';')[0].split('=')[1];
  const db=new DatabaseSync(join(dir,'originates.sqlite'));
  try{const user=db.prepare('SELECT password FROM users WHERE email=?').get(account.email);assert.notEqual(user.password,account.password);assert.match(user.password,/^[a-f0-9]{32}:[a-f0-9]{128}$/);assert.equal(db.prepare('SELECT hash FROM sessions WHERE hash=?').get(raw),undefined);db.prepare('UPDATE sessions SET expires_at=0 WHERE hash=?').run(createHash('sha256').update(raw).digest('hex'));}
  finally{db.close();}
  assert.equal((await fetch(base+'/api/me',{headers:{Cookie:'originates_session='+raw}})).status,401);
});
test('production uses Secure Host cookie and HTTPS headers',async()=>{
  const prod=spawn(process.execPath,['server.mjs'],{env:{...process.env,NODE_ENV:'production',PORT:'3198',APP_ORIGIN:'https://originates.dev',DATA_DIR:join(dir,'prod')},stdio:'pipe'});
  try{
    let available=false;for(let i=0;i<100;i++){try{if((await fetch('http://localhost:3198/api/health')).ok){available=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(available);
    const send=path=>fetch('http://localhost:3198'+path,{method:'POST',headers:{Origin:'https://originates.dev','Content-Type':'application/json'},body:JSON.stringify(account)});
    assert.equal((await send('/api/register')).status,200);const r=await send('/api/login');assert.equal(r.status,200);const c=r.headers.get('set-cookie');assert.match(c,/^__Host-originates_session=/);assert.match(c,/; Secure/);assert.match(c,/; HttpOnly/);assert.match(r.headers.get('strict-transport-security'),/max-age=/);
  }finally{await new Promise(resolve=>{prod.once('exit',resolve);prod.kill('SIGTERM');});}
});
