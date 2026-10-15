import { STATIC_ASSETS } from './assets.mjs';
const DAY = 86400000;
const SESSION_COOKIE = '__Host-originates_session';
const STATE_COOKIE = '__Host-originates_oauth';
const encoder = new TextEncoder();
function random() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), x=>x.toString(16).padStart(2,'0')).join(''); }
async function sha(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),x=>x.toString(16).padStart(2,'0')).join(''); }
async function challenge(value) { return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'); }
function getCookie(request,name) { return (request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1); }
function cookie(name,value,age) { return `${name}=${value}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`; }
function equal(a,b) { if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0; }
function json(data,status=200) { return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8'}}); }
function redirect(path,cookies=[]) { const h=new Headers({Location:path});for(const c of cookies)h.append('Set-Cookie',c);return new Response(null,{status:302,headers:h}); }
function secure(response) {
  const h=new Headers(response.headers);
  h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','no-referrer');h.set('X-Frame-Options','DENY');
  h.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  h.set('Cache-Control','no-store');h.set('Strict-Transport-Security','max-age=31536000');h.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  return new Response(response.body,{status:response.status,headers:h});
}
async function currentUser(request,db) {
  const token=getCookie(request,SESSION_COOKIE);if(!/^[a-f0-9]{64}$/.test(token||''))return null;
  return db.prepare('SELECT users.id,users.github_login,users.email,users.name,users.created_at FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires_at>?').bind(await sha(token),Date.now()).first();
}
async function rateLimit(db,request) {
  const key='oauth:'+await sha(request.headers.get('CF-Connecting-IP')||'local');const now=Date.now();
  const r=await db.prepare('INSERT INTO rate_limits(key,hits,resets) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN resets<=? THEN 1 ELSE hits+1 END,resets=CASE WHEN resets<=? THEN excluded.resets ELSE resets END RETURNING hits').bind(key,now+900000,now,now).first();
  return r.hits<=30;
}
export function createWorker({fetcher=globalThis.fetch,assets=STATIC_ASSETS}={}) {
  async function route(request,env) {
    const url=new URL(request.url),path=url.pathname;
    const configuredOrigin=env.APP_ORIGIN;
    if(!configuredOrigin||!/^https:\/\/[^/]+$/.test(configuredOrigin))return json({error:'Application origin has not been configured.'},503);
    const origin=url.origin;
    if(![configuredOrigin,env.PREVIEW_ORIGIN].includes(origin))return json({error:'This deployment is not the configured application origin.'},421);
    const db=env.DB;
    const configured=!!(db&&env.GITHUB_CLIENT_ID&&env.GITHUB_CLIENT_SECRET);
    if(path==='/api/health'&&request.method==='GET') {
      try { if(!db)throw Error();await db.prepare('SELECT id FROM users LIMIT 1').first();return json({ok:true,authentication:configured?'github':'not-configured',build:'cloudflare-free-v1'}); }
      catch {return json({ok:false,error:'Database is not ready.'},503);}
    }
    if(path==='/auth/github'&&request.method==='GET') {
      if(!configured)return redirect('/login?error=not_configured');
      if(!await rateLimit(db,request))return json({error:'Too many sign-in attempts. Try again in 15 minutes.'},429);
      const state=random(),verifier=random();
      await db.prepare('INSERT INTO oauth_states(hash,verifier,expires_at) VALUES(?,?,?)').bind(await sha(state),verifier,Date.now()+600000).run();
      const u=new URL('https://github.com/login/oauth/authorize');u.search=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,redirect_uri:origin+'/auth/github/callback',scope:'read:user user:email',state,code_challenge:await challenge(verifier),code_challenge_method:'S256'}).toString();
      return redirect(u.toString(),[cookie(STATE_COOKIE,state,600)]);
    }
    if(path==='/auth/github/callback'&&request.method==='GET') {
      const clear=cookie(STATE_COOKIE,'',0),state=url.searchParams.get('state'),code=url.searchParams.get('code');
      const fail=reason=>redirect('/login?error='+reason,[clear]);
      if(!configured)return fail('not_configured');
      if(!/^[a-f0-9]{64}$/.test(state||'')||!equal(state,getCookie(request,STATE_COOKIE)))return fail('invalid_state');
      const saved=await db.prepare('DELETE FROM oauth_states WHERE hash=? RETURNING verifier,expires_at').bind(await sha(state)).first();
      if(!saved||saved.expires_at<=Date.now())return fail('expired');
      if(url.searchParams.has('error'))return fail('cancelled');
      if(!code||code.length>1024)return fail('invalid_callback');
      try {
        const r=await fetcher('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,redirect_uri:origin+'/auth/github/callback',code_verifier:saved.verifier}),signal:AbortSignal.timeout(10000)});
        const token=await r.json();if(!r.ok||typeof token.access_token!=='string')return fail('provider');
        const headers={Authorization:'Bearer '+token.access_token,Accept:'application/vnd.github+json','User-Agent':'Originates-Login','X-GitHub-Api-Version':'2022-11-28'};
        const ur=await fetcher('https://api.github.com/user',{headers,signal:AbortSignal.timeout(10000)});const profile=await ur.json();
        if(!ur.ok||!Number.isSafeInteger(profile.id)||typeof profile.login!=='string')return fail('provider');
        let email=null;
        const er=await fetcher('https://api.github.com/user/emails',{headers,signal:AbortSignal.timeout(10000)});
        if(er.ok){const all=await er.json();if(Array.isArray(all))email=(all.find(e=>e.primary&&e.verified)||all.find(e=>e.verified))?.email||null;}
        const now=Date.now();
        const user=await db.prepare('INSERT INTO users(id,github_id,github_login,email,name,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(github_id) DO UPDATE SET github_login=excluded.github_login,email=excluded.email,name=excluded.name,updated_at=excluded.updated_at RETURNING id').bind(crypto.randomUUID(),String(profile.id),profile.login,email,typeof profile.name==='string'?profile.name:null,now,now).first();
        const session=random();const previous=getCookie(request,SESSION_COOKIE);
        if(/^[a-f0-9]{64}$/.test(previous||''))await db.prepare('DELETE FROM sessions WHERE hash=?').bind(await sha(previous)).run();
        await db.prepare('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha(session),user.id,now+7*DAY).run();
        // The GitHub token is deliberately not stored; this app needs no repository access.
        return redirect('/app',[clear,cookie(SESSION_COOKIE,session,7*86400)]);
      }catch {return fail('provider');}
    }
    if(path==='/api/me'&&request.method==='GET') {
      if(!db)return json({error:'Account storage is not ready.'},503);
      const u=await currentUser(request,db);return u?json({user:{email:u.email,login:u.github_login,name:u.name,createdAt:u.created_at}}):json({error:'Please log in.'},401);
    }
    if(path==='/api/logout'&&request.method==='POST') {
      if(request.headers.get('Origin')!==origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'Request origin is not allowed.'},403);
      const token=getCookie(request,SESSION_COOKIE);
      if(db&&/^[a-f0-9]{64}$/.test(token||''))await db.prepare('DELETE FROM sessions WHERE hash=?').bind(await sha(token)).run();
      const response=json({ok:true});response.headers.append('Set-Cookie',cookie(SESSION_COOKIE,'',0));return response;
    }
    if(path.startsWith('/api/')||path.startsWith('/auth/'))return json({error:'Not found or method not allowed.'},404);
    if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'Method not allowed.'},405);
    if(path==='/app') {if(!db||!await currentUser(request,db))return redirect('/login');}
    const asset=assets[path];if(!asset)return new Response('Page not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    return new Response(request.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type+'; charset=utf-8'}});
  }
  return {
    async fetch(request,env) {try{return secure(await route(request,env));}catch {return secure(json({error:'Service temporarily unavailable. Please try again.'},503));}},
    async scheduled(event,env,ctx) {const now=Date.now();await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now),env.DB.prepare('DELETE FROM oauth_states WHERE expires_at<=?').bind(now),env.DB.prepare('DELETE FROM rate_limits WHERE resets<=?').bind(now)]);}
  };
}
export default createWorker();
