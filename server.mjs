import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const derive = promisify(scryptCallback);
const scrypt = (password, salt, length) => derive(password, salt, length, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === 'production';
if (production && !process.env.APP_ORIGIN) throw new Error('APP_ORIGIN is required in production');
const origin = new URL(process.env.APP_ORIGIN || `http://localhost:${port}`).origin;
if (production && !origin.startsWith('https://')) throw new Error('Production APP_ORIGIN must use HTTPS');
const dir = process.env.DATA_DIR || join(root, 'data');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(join(dir, 'originates.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, hits INTEGER NOT NULL, resets INTEGER NOT NULL);`);
const ttl = 7 * 86400000;
const digest = token => createHash('sha256').update(token).digest('hex');
const cookieName = production ? '__Host-originates_session' : 'originates_session';
const cookie = (value, age) => `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${production ? '; Secure' : ''}`;
function session(req) {
  const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare('SELECT users.id,users.email,users.created_at,sessions.expires_at FROM sessions JOIN users ON users.id=sessions.user_id WHERE hash=? AND expires_at>?').get(digest(token), Date.now());
}
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
function limit(key, max) {
  const now = Date.now();
  db.prepare('INSERT INTO limits(key,hits,resets) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN resets<=? THEN 1 ELSE hits+1 END,resets=CASE WHEN resets<=? THEN excluded.resets ELSE resets END').run(key, now + 900000, now, now);
  return db.prepare('SELECT hits FROM limits WHERE key=?').get(key).hits <= max;
}
async function body(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw Object.assign(new Error('Expected JSON'), {status:415});
  let text = '';
  for await (const chunk of req) { text += chunk.toString(); if (Buffer.byteLength(text) > 8192) throw Object.assign(new Error('Request too large'), {status:413}); }
  try { const b = JSON.parse(text); if (!b || Array.isArray(b) || typeof b !== 'object') throw Error(); return b; }
  catch { throw Object.assign(new Error('Invalid JSON'), {status:400}); }
}
const dummySalt = randomBytes(16).toString('hex');
const dummyHash = Buffer.from(await scrypt('invalid-password-for-timing', dummySalt, 64)).toString('hex');
const dummy = `${dummySalt}:${dummyHash}`;
async function passwordHash(password) { const salt = randomBytes(16).toString('hex'); return salt + ':' + Buffer.from(await scrypt(password,salt,64)).toString('hex'); }
async function passwordMatches(password, stored) { const [salt, hash] = stored.split(':'); return timingSafeEqual(Buffer.from(await scrypt(password,salt,64)),Buffer.from(hash,'hex')); }
// Bound memory-hard password jobs; reject excess work instead of exhausting memory.
let authJobs = 0;
async function authenticate(req, res, path) {
  const ip = req.socket.remoteAddress || 'unknown'; // Deliberately do not trust spoofable proxy headers.
  if (!limit('ip:'+ip, 100)) return json(res,429,{error:'Too many attempts. Please try again in 15 minutes.'});
  const b = await body(req);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = b.password;
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 12 || password.length > 128) return json(res,400,{error:'Enter a valid email and a password of 12–128 characters.'});
  if (!limit('email:'+digest(email), 20)) return json(res,429,{error:'Too many attempts. Please try again in 15 minutes.'});
  const existing = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (path === '/api/register') {
    const hash = await passwordHash(password);
    // Same response for new/existing accounts to avoid disclosing membership.
    db.prepare('INSERT OR IGNORE INTO users(id,email,password,created_at) VALUES(?,?,?,?)').run(randomBytes(16).toString('hex'),email,hash,Date.now());
    return json(res,200,{message:'If this address was available, your account has been created. You can now log in. If you already have an account, use your existing password.'});
  }
  const valid = await passwordMatches(password, existing?.password || dummy);
  if (!existing || !valid) return json(res,401,{error:'Email or password is incorrect.'});
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token), existing.id, Date.now()+ttl);
  res.setHeader('Set-Cookie',cookie(token,ttl/1000));
  json(res,200,{user:{email:existing.email}});
}
const server = http.createServer(async(req,res)=> {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if (production) res.setHeader('Strict-Transport-Security','max-age=31536000');
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    if(path.startsWith('/api/')) {
      if(req.method==='GET' && path==='/api/health') return json(res,200,{ok:true});
      if(req.method==='GET' && path==='/api/me') { const u=session(req); return u ? json(res,200,{user:{email:u.email,createdAt:u.created_at}}) : json(res,401,{error:'Please log in.'}); }
      if(req.method!=='POST') return json(res,405,{error:'Method not allowed.'});
      if(req.headers.origin !== origin || req.headers['sec-fetch-site']==='cross-site') return json(res,403,{error:'Request origin is not allowed.'});
      if(path==='/api/register' || path==='/api/login') {
        if(authJobs>=4) return json(res,503,{error:'Server busy. Please try again shortly.'});
        authJobs++; try { return await authenticate(req,res,path); } finally {authJobs--;}
      }
      if(path==='/api/logout') {
        const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
        if(token) db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token));
        res.setHeader('Set-Cookie',cookie('',0)); return json(res,200,{ok:true});
      }
      return json(res,404,{error:'Not found.'});
    }
    if(req.method!=='GET' && req.method!=='HEAD') {res.writeHead(405);return res.end();}
    if(path==='/app' && !session(req)) {res.writeHead(302,{Location:'/login'});return res.end();}
    const files={'/':'index.html','/login':'login.html','/app':'app.html','/auth.js':'auth.js','/account.js':'account.js','/account.css':'account.css'};
    if(!files[path]) {res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Page not found');}
    const file=files[path];
    const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
    res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});
    res.end(req.method==='HEAD'?undefined:readFileSync(join(root,'public',file)));
  } catch(e) { if(!res.headersSent) json(res,e.status||500,{error:e.status?e.message:'Something went wrong. Please try again.'}); else res.end(); }
});
server.requestTimeout=15000; server.headersTimeout=10000;
const cleanup=setInterval(()=>{db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now()); db.prepare('DELETE FROM limits WHERE resets<=?').run(Date.now());},3600000);cleanup.unref();
server.listen(port,'0.0.0.0',()=>console.log(`Originates listening on port ${port}`));
for(const sig of ['SIGTERM','SIGINT']) process.on(sig,()=>{clearInterval(cleanup);server.close(()=>{db.close();process.exit(0);});});
