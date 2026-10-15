import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
const encoder=new TextEncoder(),CHALLENGE_COOKIE='__Host-originates_passkey',SESSION_COOKIE='__Host-originates_session';
const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const sha=async s=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(s)));
const cookie=(n,v,age)=>`${n}=${v}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`;
const getCookie=(r,n)=>(r.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(n+'='))?.slice(n.length+1);
function json(v,status=200,cookies=[]){const h=new Headers({'Content-Type':'application/json; charset=utf-8'});for(const c of cookies)h.append('Set-Cookie',c);return new Response(JSON.stringify(v),{status,headers:h});}
const b64=v=>btoa(String.fromCharCode(...v));const bytes=v=>Uint8Array.from(atob(v),c=>c.charCodeAt(0));
export function validOrigin(r){return r.headers.get('Origin')===new URL(r.url).origin&&r.headers.get('Sec-Fetch-Site')!=='cross-site';}
export async function bodyJSON(r){if(!r.headers.get('Content-Type')?.startsWith('application/json'))throw Error('invalid');const text=await r.text();if(encoder.encode(text).length>32768)throw Error('invalid');return JSON.parse(text);}
export function normalizeEmail(value){if(typeof value!=='string')return null;const s=value.trim().toLowerCase();if(s.length>254||!/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]{1,64}@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z0-9-]{2,63}$/.test(s)||s.includes('..'))return null;return s;}
async function allowed(db,r){const now=Date.now(),key='passkey:'+await sha(r.headers.get('CF-Connecting-IP')||'local');const x=await db.prepare('INSERT INTO rate_limits(key,hits,resets) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN resets<=? THEN 1 ELSE hits+1 END,resets=CASE WHEN resets<=? THEN excluded.resets ELSE resets END RETURNING hits').bind(key,now+900000,now,now).first();return x.hits<=30;}
export function createPasskeyHandler({verifyRegistration=verifyRegistrationResponse,verifyAuthentication=verifyAuthenticationResponse}={}){return async function passkeyRoute(request,env){
 if(request.method!=='POST')return json({error:'仅支持 POST 请求。'},405);
 if(!validOrigin(request))return json({error:'请求来源不被允许。'},403);
 const db=env.DB;if(!db)return json({error:'账户存储暂不可用。'},503);
 let body;try{body=await bodyJSON(request);}catch{return json({error:'请求格式无效或内容过长。'},400);}
 const {origin,hostname:rpID,pathname:path}=new URL(request.url);
 if(path==='/api/passkey/options'){
  if(!await allowed(db,request))return json({error:'尝试过于频繁，请在 15 分钟后重试。'},429);
  const email=normalizeEmail(body.email),flow=body.mode;if(!email||!['register','login'].includes(flow))return json({error:'请输入有效邮箱地址，并选择注册或登录。'},400);
  const existing=await db.prepare('SELECT id FROM email_accounts WHERE email=?').bind(email).first();
  if(flow==='register'&&existing)return json({error:'此邮箱已注册。请使用原通行密钥登录；邮箱和 GitHub 账户不会自动合并。'},409);
  const userId=existing?.id||(flow==='register'?crypto.randomUUID():null);let options;
  if(flow==='register')options=await generateRegistrationOptions({rpName:'Originates Robotics',rpID,userID:encoder.encode(userId),userName:email,attestationType:'none',supportedAlgorithmIDs:[-7,-257],authenticatorSelection:{residentKey:'required',userVerification:'required'},timeout:60000});
  else {const rows=existing?await db.prepare('SELECT id,transports FROM passkeys WHERE account_id=? AND rp_id=?').bind(userId,rpID).all():{results:[]};options=await generateAuthenticationOptions({rpID,userVerification:'required',timeout:60000,allowCredentials:rows.results.length?rows.results.map(k=>({id:k.id,transports:JSON.parse(k.transports)})):[{id:random(),transports:[]}]});}
  const nonce=random();await db.prepare('INSERT INTO webauthn_challenges(hash,challenge,email,account_id,flow,rp_id,origin,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(await sha(nonce),options.challenge,email,userId,flow,rpID,origin,Date.now()+600000).run();
  return json({options},200,[cookie(CHALLENGE_COOKIE,nonce,600)]);
 }
 if(path==='/api/passkey/verify'){
  const nonce=getCookie(request,CHALLENGE_COOKIE),clear=cookie(CHALLENGE_COOKIE,'',0),fail=(error,status=400)=>json({error},status,[clear]);
  if(!/^[a-f0-9]{64}$/.test(nonce||''))return fail('注册或登录请求已失效，请重新开始。');
  const saved=await db.prepare('DELETE FROM webauthn_challenges WHERE hash=? RETURNING *').bind(await sha(nonce)).first();
  if(!saved||saved.expires_at<=Date.now()||saved.origin!==origin||saved.rp_id!==rpID)return fail('注册或登录请求已失效，请重新开始。');
  const credential=body.credential;if(!credential||typeof credential.id!=='string'||credential.id.length>2048||credential.type!=='public-key')return fail('通行密钥响应无效。');
  let userId=saved.account_id;
  try{
   if(saved.flow==='register'){
    const result=await verifyRegistration({response:credential,expectedChallenge:saved.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true});
    if(!result.verified||!result.registrationInfo)return fail('无法验证通行密钥。');
    if(await db.prepare('SELECT id FROM email_accounts WHERE email=?').bind(saved.email).first())return fail('此邮箱已注册，请返回登录。',409);
    const k=result.registrationInfo.credential,now=Date.now();await db.batch([db.prepare('INSERT INTO email_accounts(id,email,created_at) VALUES(?,?,?)').bind(userId,saved.email,now),db.prepare('INSERT INTO passkeys(id,account_id,public_key,counter,transports,rp_id,created_at) VALUES(?,?,?,?,?,?,?)').bind(k.id,userId,b64(k.publicKey),k.counter,JSON.stringify(k.transports||[]),rpID,now)]);
   }else{
    const k=await db.prepare('SELECT * FROM passkeys WHERE id=? AND account_id=? AND rp_id=?').bind(credential.id,userId,rpID).first();if(!k)return fail('无法登录。请使用创建此邮箱账户时保存的通行密钥。',401);
    const result=await verifyAuthentication({response:credential,expectedChallenge:saved.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,credential:{id:k.id,publicKey:bytes(k.public_key),counter:k.counter,transports:JSON.parse(k.transports)}});
    if(!result.verified)return fail('无法验证通行密钥。',401);
    const updated=await db.prepare('UPDATE passkeys SET counter=? WHERE id=? AND counter=?').bind(result.authenticationInfo.newCounter,k.id,k.counter).run();if(!updated.meta?.changes)return fail('通行密钥状态已变化，请重新登录。',409);
   }
  }catch{return fail('无法验证通行密钥，请重新开始。',400);}
  const previous=getCookie(request,SESSION_COOKIE);if(/^[a-f0-9]{64}$/.test(previous||''))await db.batch([db.prepare('DELETE FROM sessions WHERE hash=?').bind(await sha(previous)),db.prepare('DELETE FROM email_sessions WHERE hash=?').bind(await sha(previous))]);
  const token=random();await db.prepare('INSERT INTO email_sessions(hash,account_id,expires_at) VALUES(?,?,?)').bind(await sha(token),userId,Date.now()+7*86400000).run();return json({ok:true},200,[clear,cookie(SESSION_COOKIE,token,7*86400)]);
 }
 return json({error:'接口不存在。'},404);
};}
export default createPasskeyHandler();
