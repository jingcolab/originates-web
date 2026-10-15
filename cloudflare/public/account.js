const message=document.querySelector('#message');
fetch('/api/me',{credentials:'same-origin'}).then(async r=>{
  if(r.status===401){location.replace('/login');return;}
  if(!r.ok)throw Error('Unable to load your account. Please refresh.');
  const {user}=await r.json();document.querySelector('#email').textContent=user.name||user.login;document.querySelector('#identity').textContent='@'+user.login+(user.email?' · '+user.email:'');
  const created=document.querySelector('#created');created.dateTime=new Date(user.createdAt).toISOString();created.textContent=new Date(user.createdAt).toLocaleDateString();
  document.querySelector('#profile').hidden=false;message.textContent='';
}).catch(()=>{message.textContent='Connection failed. Please refresh to load your account.';message.className='message error';});
document.querySelector('#logout').addEventListener('click',async function(){
  this.disabled=true;
  try{const r=await fetch('/api/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error();location.replace('/login');}
  catch{message.textContent='Unable to log out. Please try again.';message.className='message error';this.disabled=false;}
});
