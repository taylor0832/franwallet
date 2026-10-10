/* Optional, account-wide setup reminders. Never auto-enroll a customer. */
(()=>{'use strict';
let owner=null,pref=null,loaded=false,loading=false,busy=false,context=null,complete=false;
async function api(action,values={}){
 const {data:{session}}=await sb.auth.getSession();if(!session)throw Error('Please sign in again.');
 const r=await fetch(SUPABASE_URL+'/functions/v1/onboarding',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({action,...values}),signal:AbortSignal.timeout(20000)});
 const data=await r.json();if(!r.ok)throw Error(data.error||'Please retry.');return data;
}
async function metrics(){
 if(ME?.email!=='taylor@coverpanda.co'||document.getElementById('setup-funnel'))return;
 const host=document.getElementById('page-admin');if(!host)return;
 const section=document.createElement('section');section.id='setup-funnel';section.className='fw-shell';host.append(section);
 const refresh=async()=>{
  section.innerHTML='<h2>Signup to activation</h2><p role="status">Loading saved outcomes…</p>';
  try{const data=await api('metrics');if(ME?.email!=='taylor@coverpanda.co'){section.remove();return;}
   const rows=[['Locations',data.locations],['Location named',data.named],['Goal saved',data.goal_saved],['First document saved',data.first_document],['Evidence reviewed · activated',data.activated],['New locations in 7 days',data.new_locations_7d],['Those new locations activated',data.new_locations_7d_activated],['Setup reminders enabled',data.reminders_enabled],['Emails accepted by Resend',data.reminders_accepted],['Email send failures',data.reminder_failures]];
   section.innerHTML='<h2>Signup to activation</h2><p>Current saved outcomes, excluding test accounts. Each activation stage includes the earlier steps. These counts are not a measured conversion rate.</p><table class="fw-table"><thead><tr><th>Outcome</th><th>Locations or emails</th></tr></thead><tbody>'+rows.map(([label,value])=>'<tr><td>'+label+'</td><td>'+Number(value||0)+'</td></tr>').join('')+'</tbody></table><p class="fw-subtle">Email acceptance is not confirmed inbox delivery.</p><button type="button" class="btn btn-ghost">Refresh outcomes</button>';
  }catch{section.innerHTML='<h2>Signup to activation</h2><p role="alert">Could not load outcomes.</p><button type="button" class="btn btn-ghost">Retry</button>';}
  section.querySelector('button')?.addEventListener('click',refresh);
 };await refresh();
}
function render(){
 document.getElementById('setup-reminders')?.remove();
 const guide=document.getElementById('activation-guide');if(!guide||!context||!loaded)return;
 const active=!!pref?.enabled,forThis=pref?.wallet_id===context.wallet.id;
 const section=document.createElement('details');section.id='setup-reminders';section.className='activation-finished';
 section.innerHTML=`<summary>${complete?'Setup email preferences':active?'Setup reminders are on':'Picking this up later?'}</summary><p>${complete?'Setup is complete for this location, so it will not receive unfinished-setup reminders.':'Get a short email with your next unfinished step after one day and three days. At most two reminders during your first week; they stop when setup is complete.'}</p>${active&&!forThis?'<p>Your reminders currently follow another location. Enabling them here will move that focus to this location.</p>':''}<label class="setup-reminder-choice"><input type="checkbox" id="setup-reminder-check" ${active&&forThis?'checked':''}> Email me setup reminders for this location</label><button class="btn btn-ghost" id="setup-reminder-save" type="button" ${busy?'disabled':''}>${busy?'Saving…':'Save email preference'}</button><p class="fw-subtle">Optional. Sign-in and account-security emails are separate. You can stop reminders here or from any reminder email.</p><p id="setup-reminder-status" role="status"></p>`;
 guide.append(section);
 section.querySelector('button').onclick=async()=>{
  if(busy)return;busy=true;const button=section.querySelector('button'),status=section.querySelector('#setup-reminder-status'),wallet=context.wallet.id,member=owner,enabled=section.querySelector('input').checked;
  button.disabled=true;section.querySelector('input').disabled=true;button.textContent='Saving…';status.textContent='';
  try{await api('save',{wallet_id:wallet,enabled});if(owner!==member)return;pref={...pref,enabled,wallet_id:wallet};section.querySelector('summary').textContent=enabled?'Setup reminders are on':'Picking this up later?';status.textContent=enabled?'Saved. Reminders will follow your unfinished setup and stop when you finish.':'Saved. Setup reminders are off.';}
  catch(e){status.textContent=e.message;status.setAttribute('role','alert');}
  finally{busy=false;button.disabled=false;section.querySelector('input').disabled=false;button.textContent='Save email preference';}
 };
}
window.addEventListener('fran:activation-context',async e=>{
 context=e.detail.location;complete=!!window.FranActivation?.derive(context,e.detail.life)?.complete;
 if(!context||context.wallet?.access_role==='payroll_editor'){document.getElementById('setup-reminders')?.remove();return;}
 const id=ME?.id;if(owner!==id){owner=id;pref=null;loaded=false;loading=false;}
 if(!loaded&&!loading){loading=true;try{const data=await api('load');if(owner!==id)return;pref=data.preference;loaded=data.configured;}catch{}finally{if(owner===id)loading=false;}}
 render();metrics();
});
window.addEventListener('fran:location',e=>{if(!e.detail){document.getElementById('setup-funnel')?.remove();owner=null;context=null;loaded=false;pref=null;document.getElementById('setup-reminders')?.remove();}});
// Codes work when the email is opened on a different device.
let verifying=false;
document.getElementById('signin-code-form')?.addEventListener('submit',async e=>{
 e.preventDefault();if(verifying)return;const code=document.getElementById('signin-code'),button=document.getElementById('signin-verify'),status=document.getElementById('signin-code-status');
 if(!/^[0-9]{8}$/.test(code.value.trim())){status.textContent='Enter the 8-digit code from your newest email.';return;}
 verifying=true;button.disabled=true;button.textContent='Opening…';status.textContent='';
 try{const {data,error}=await sb.auth.verifyOtp({email:document.getElementById('signin-address').textContent,token:code.value.trim(),type:'email'});if(error||!data.session)throw Error();code.value='';await boot(data.session);}
 catch{status.textContent='That code is expired or could not be verified. Try the newest code, or request a fresh email.';status.setAttribute('role','alert');}
 finally{verifying=false;button.disabled=false;button.textContent='Open my wallet';}
});
// Recovery from expired or already-used links; never echo URL error text.
const authError=new URLSearchParams(location.hash.slice(1)).get('error_code')||new URLSearchParams(location.search).get('error_code');
if(authError){const error=document.getElementById('signin-err');error.textContent='This sign-in link has expired or was already used. Enter your email below for a fresh link. Your saved wallet is still there.';error.classList.add('show');history.replaceState(null,'',location.pathname);}
document.getElementById('signin-change')?.addEventListener('click',()=>{
 document.getElementById('signin-ok').classList.remove('show');document.getElementById('signin-form').style.display='';document.getElementById('signin-email').focus();
});
})();
