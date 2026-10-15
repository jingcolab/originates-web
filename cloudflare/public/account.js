'use strict';const TYPE_LABELS={"机械臂": "Robot arm", "移动机器人": "Mobile robot", "具身智能": "Embodied AI", "其他机器人": "Other robotics"},STAGE_LABELS={"构想": "Concept", "开发中": "In development", "实验验证": "Validation", "已归档": "Archived"};
const $=id=>document.getElementById(id);let projects=[],selected=null,dirty=false;const message=$('message');
async function api(path,options={}){const r=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});if(r.status===401){location.assign('/login');throw Error('Your session has expired.');}const j=await r.json();if(!r.ok)throw Error(j.error||'Request failed. Please try again.');return j;}
function renderList(){const list=$('project-list');list.replaceChildren();for(const p of projects){const b=document.createElement('button');b.type='button';b.className='project-item';b.setAttribute('aria-pressed',String(p.id===selected));const name=document.createElement('span');name.textContent=p.name;const meta=document.createElement('small');meta.textContent=(TYPE_LABELS[p.type]||p.type)+' · '+(STAGE_LABELS[p.status]||p.status);b.append(name,meta);b.onclick=()=>openProject(p);list.append(b);}if(!projects.length){const p=document.createElement('p');p.className='hint';p.textContent='No projects yet. Start with an idea.';list.append(p);}}
function openProject(p=null){selected=p?.id||null;dirty=false;$('empty').hidden=true;$('editor').hidden=false;$('editor-title').textContent=p?'Project notes':'New robotics project';$('project-name').value=p?.name||'';$('project-type').value=p?.type||'机械臂';$('project-status').value=p?.status||'构想';$('project-notes').value=p?.notes||'';$('delete-project').hidden=!p;$('save-status').textContent=p?'Last saved: '+new Date(p.updatedAt).toLocaleString('en-US'):'Add your details, then select Save project.';$('prompt').hidden=true;$('copy-prompt').hidden=true;message.textContent='';renderList();}
function formData(){return {name:$('project-name').value.trim(),type:$('project-type').value,status:$('project-status').value,notes:$('project-notes').value};}
for(const id of ['new-project','empty-new'])$(id).onclick=()=>openProject();$('editor').addEventListener('input',()=>{dirty=true;$('save-status').textContent='You have unsaved changes.';});window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
$('editor').onsubmit=async e=>{e.preventDefault();const b=$('save-project');b.disabled=true;message.textContent='';try{const {project}=await api(selected?'/api/projects/'+selected:'/api/projects',{method:selected?'PUT':'POST',body:JSON.stringify(formData())});const n=projects.findIndex(p=>p.id===project.id);if(n>=0)projects[n]=project;else projects.unshift(project);openProject(project);$('save-status').textContent='Saved to your account.';}catch(e){message.textContent=e.message;}finally{b.disabled=false;}};
$('export-project').onclick=()=>{if(!selected||dirty){message.textContent='Save the project before exporting Markdown.';return;}const a=document.createElement('a');a.href='/api/projects/'+selected+'/export';a.download='robot-project.md';document.body.append(a);a.click();a.remove();};
$('make-prompt').onclick=()=>{const p=formData();$('prompt').textContent=`You are a careful robotics development collaborator. Help structure the following physical robotics project. Do not directly control real hardware.

Project: ${p.name||'Untitled'}
Focus: ${TYPE_LABELS[p.type]||p.type}
Stage: ${STAGE_LABELS[p.status]||p.status}
Notes:
${p.notes||'No notes yet. Ask for the key requirements first.'}

Please provide:
1. Hardware, sensor, environment, and task assumptions to clarify.
2. Suggested perception, planning, and control module boundaries.
3. Minimal simulation checks and acceptance criteria.
4. Emergency-stop, joint-limit, collision, and human-supervision checks before hardware testing.
5. Uncertainties and information you need from me.

Do not invent hardware specifications, claim code has run, or produce actions to send to a real robot without review.`;$('prompt').hidden=false;$('copy-prompt').hidden=false;};$('copy-prompt').onclick=async()=>{try{await navigator.clipboard.writeText($('prompt').textContent);$('copy-prompt').textContent='Copied';}catch{message.textContent='Clipboard access is unavailable. Select and copy the prompt manually.';}};
$('delete-project').onclick=()=>$('delete-dialog').showModal();$('cancel-delete').onclick=()=>$('delete-dialog').close();$('confirm-delete').onclick=async()=>{const b=$('confirm-delete');b.disabled=true;try{await api('/api/projects/'+selected,{method:'DELETE'});projects=projects.filter(p=>p.id!==selected);selected=null;dirty=false;$('editor').hidden=true;$('empty').hidden=false;$('delete-dialog').close();renderList();}catch(e){message.textContent=e.message;$('delete-dialog').close();}finally{b.disabled=false;}};
$('logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'});dirty=false;location.assign('/login');}catch(e){message.textContent=e.message;}};
(async()=>{try{const {user}=await api('/api/me');$('identity').textContent=user.name||user.email||user.login;$('account-note').textContent=user.authMethod==='email'?'Email passkey account · Email ownership is unverified · Keep your passkey safe':'GitHub account · @'+user.login;({projects}=await api('/api/projects'));renderList();}catch(e){message.textContent=e.message;}})();
