const form=document.querySelector('#auth-form');
const message=document.querySelector('#message');
const toggle=document.querySelector('#switch');
const submit=document.querySelector('#submit');
let register=false;
function show(text,error=false){message.textContent=text;message.className='message '+(error?'error':'success');}
function setMode(value){register=value;document.querySelector('#title').textContent=value?'Create your account.':'Welcome back.';document.querySelector('#intro').textContent=value?'Start with a secure Originates account.':'Log in to manage your Originates account.';submit.textContent=value?'Create account':'Log in';toggle.textContent=value?'Already registered? Log in':'New here? Create an account';document.querySelector('#password').autocomplete=value?'new-password':'current-password';show('');}
toggle.addEventListener('click',()=>setMode(!register));
form.addEventListener('submit',async e=>{
  e.preventDefault();if(submit.disabled)return;
  const wasRegister=register;submit.disabled=true;toggle.disabled=true;submit.textContent='Please wait…';show('');
  try{
    const response=await fetch(wasRegister?'/api/register':'/api/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.email.value,password:form.password.value})});
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'Unable to sign in. Please try again.');
    if(wasRegister){setMode(false);form.password.value='';show(data.message);form.password.focus();}
    else {form.password.value='';location.replace('/app');}
  }catch(error){show(error.message==='Failed to fetch'?'Connection failed. Check your network and try again.':error.message,true);}
  finally{submit.disabled=false;toggle.disabled=false;submit.textContent=register?'Create account':'Log in';}
});
fetch('/api/me',{credentials:'same-origin'}).then(r=>{if(r.ok)location.replace('/app');}).catch(()=>{});
