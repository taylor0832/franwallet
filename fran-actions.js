/* Explicit saved next-step editor. No notifications or access changes. */
(()=>{
'use strict';
const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={open:'Open',in_progress:'In progress',deferred:'Deferred',resolved:'Resolved'};
let state=null,epoch=0;
async function call(input,wallet){
 const {data:{session}}=await sb.auth.getSession();if(!session)throw Error('Sign in again to continue.');
 const response=await fetch(SUPABASE_URL+'/functions/v1/wallet-actions',{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({...input,wallet_id:wallet}),signal:AbortSignal.timeout(30000)});
 const data=await response.json();if(!response.ok){const error=Error(data.error||'Could not save. Your draft is still here.');error.status=response.status;throw error;}return data;
}
async function mount(host,priority){
 if(!state?.wallet||state.wallet.access_role)return;
 const wallet=state.wallet.id,ticket=epoch,box=document.createElement('section');box.className='fran-action-editor';box.innerHTML='<p role="status">Loading saved next step…</p>';host.append(box);
 try{
  const listed=await call({action:'list'},wallet);if(ticket!==epoch||!box.isConnected)return;
  const existing=(listed.actions||[]).find(r=>r.priority_key===priority.id);
  const result=existing?await call({action:'load',id:existing.id},wallet):{action:{id:crypto.randomUUID(),revision:0,title:priority.title,priority_key:priority.id,status:'open',source_ids:(state.records||[]).some(r=>r.id===priority.recordId)?[priority.recordId]:[]},history:[],members:listed.members||[]};
  if(ticket===epoch&&box.isConnected)editor(box,result,wallet,ticket);
 }catch(e){if(ticket===epoch&&box.isConnected){box.textContent=e.message;const button=document.createElement('button');button.type='button';button.textContent='Try loading again';button.onclick=()=>{box.remove();mount(host,priority)};box.append(button)}}
}
async function list(host){
 if(!state?.wallet||state.wallet.access_role)return;
 host.dataset.franActionList='';
 const wallet=state.wallet.id,ticket=epoch;
 host.innerHTML='<p role="status">Loading saved next steps…</p>';
 try{
  const result=await call({action:'list'},wallet);if(ticket!==epoch||!host.isConnected)return;
  const actions=result.actions||[];
  host.innerHTML='<p>Decisions and follow-ups saved to this Wallet. Review current evidence before acting.</p>'+(actions.length?actions.map(row=>'<article class="fran-saved-action"><h3>'+E(row.title)+'</h3><p>'+E(labels[row.status])+(row.due_on?' · Due '+E(row.due_on):'')+(row.deferred_until?' · Revisit '+E(row.deferred_until):'')+'</p>'+(row.source_changed?'<p>Supporting evidence changed or is missing. Review again.</p>':row.needs_attention?'<p>Needs your attention</p>':'')+'<button type="button" data-open-action="'+E(row.id)+'">Review saved step</button></article>').join(''):'<p>No saved steps yet. Open a priority and save what you want to do next.</p>');
  host.querySelectorAll('[data-open-action]').forEach(button=>button.onclick=async()=>{
   button.disabled=true;try{const loaded=await call({action:'load',id:button.dataset.openAction},wallet);if(ticket!==epoch||!host.isConnected)return;host.replaceChildren();const back=document.createElement('button');back.type='button';back.textContent='Back to saved steps';back.onclick=()=>list(host);host.append(back);const box=document.createElement('section');box.className='fran-action-editor';host.append(box);editor(box,loaded,wallet,ticket);back.focus();}catch(e){if(ticket===epoch&&host.isConnected){let error=host.querySelector('[data-list-error]');if(!error){error=document.createElement('p');error.dataset.listError='';error.setAttribute('role','alert');host.append(error);}error.textContent=e.message;}}finally{button.disabled=false;}
  });
 }catch(e){if(ticket!==epoch||!host.isConnected)return;host.textContent=e.message;const retry=document.createElement('button');retry.type='button';retry.textContent='Try loading again';retry.onclick=()=>list(host);host.append(retry);}
}
function editor(box,result,wallet,ticket){
 const row=result.action,roster=result.members||[],sources=state.records||[],missing=(row.source_ids||[]).filter(id=>!sources.some(r=>r.id===id)),unavailable=row.assignee_id&&!roster.some(m=>m.id===row.assignee_id);
 let request=null,busy=false;
 box.innerHTML='<h3>Save your next step</h3><p>A saved decision is not verification of the underlying records.</p>'+
 (row.source_changed?'<p role="status">Supporting evidence changed or is missing. Review it before updating this decision.</p>':'')+
 '<form><label>Next step<input name="title" maxlength="140" required value="'+E(row.title)+'"></label><div class="fran-action-fields">'+
 '<label>Status<select name="status">'+Object.entries(labels).map(([key,label])=>'<option value="'+key+'" '+(key===row.status?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
 '<label>Responsible person<select name="assignee_id"><option value="">Unassigned</option>'+(unavailable?'<option value="unavailable" selected disabled>Previous member unavailable — choose a person or Unassigned</option>':'')+roster.map(m=>'<option value="'+E(m.id)+'" '+(m.id===row.assignee_id?'selected':'')+'>'+E(m.label)+'</option>').join('')+'</select></label>'+
 '<label>Due date<input name="due_on" type="date" value="'+E(row.due_on||'')+'"></label><label data-return-date>Revisit on<input name="deferred_until" type="date" value="'+E(row.deferred_until||'')+'"></label></div>'+
 '<label>Decision, next step, or reason<textarea name="note" maxlength="1000" placeholder="What will happen next? What did you check?">'+E(row.note||'')+'</textarea></label>'+
 '<details><summary>Supporting records</summary><p>Select up to 20 saved records to flag this action when they change. Connected feeds are not monitored by this action.</p>'+
 sources.map(r=>'<label class="fran-action-check"><input type="checkbox" name="source_ids" value="'+E(r.id)+'" '+((row.source_ids||[]).includes(r.id)?'checked':'')+'>'+E(r.data?.name||r.data?.title||r.kind+' record')+'</label>').join('')+
 '</details>'+(missing.length?'<label><input type="checkbox" name="ack_missing" required> Remove '+missing.length+' unavailable supporting record(s) from this decision when saving.</label>':'')+'<p>Assignment does not notify this person or change their access.</p><button type="submit">Save next step</button><p role="status" data-action-status></p><button type="button" data-action-reload hidden>Reload saved version (replaces this draft)</button></form>'+
 '<details class="fran-action-history"><summary>Decision history</summary>'+history(result.history||[],roster)+'</details>';
 const form=box.querySelector('form'),status=box.querySelector('[data-action-status]'),current=()=>ticket===epoch&&state?.wallet?.id===wallet&&box.isConnected;
 function fields(){const deferred=form.elements.status.value==='deferred';box.querySelector('[data-return-date]').hidden=!deferred;form.elements.deferred_until.required=deferred;form.elements.note.required=['resolved','deferred'].includes(form.elements.status.value);}fields();form.elements.status.onchange=fields;
 box.querySelector('[data-action-reload]').onclick=async()=>{if(busy||!current())return;try{const fresh=await call({action:'load',id:row.id},wallet);if(current())editor(box,fresh,wallet,ticket);}catch(e){if(current())status.textContent=e.message;}};
 form.onsubmit=async e=>{
  e.preventDefault();if(busy||!current())return;
  if(form.elements.assignee_id.value==='unavailable'){status.textContent='Choose a responsible person or Unassigned before saving.';form.elements.assignee_id.focus();return;}
  const fd=new FormData(form),payload={action:'save',id:row.id,revision:row.revision,title:fd.get('title'),priority_key:row.priority_key,status:fd.get('status'),assignee_id:fd.get('assignee_id')||null,due_on:fd.get('due_on')||null,deferred_until:fd.get('status')==='deferred'?fd.get('deferred_until')||null:null,note:fd.get('note'),source_ids:fd.getAll('source_ids')};
  const key=JSON.stringify(payload);if(!request||request.key!==key)request={key,id:crypto.randomUUID()};payload.request_id=request.id;
  busy=true;const controls=[...form.querySelectorAll('input,select,textarea,button')],disabled=controls.map(el=>el.disabled);controls.forEach(el=>el.disabled=true);status.setAttribute('role','status');status.textContent='Saving…';
  try{
   const saved=await call(payload,wallet);if(!current())return;row.revision=saved.action.revision;request=null;status.textContent='Saved to this Wallet. No message was sent.';
   dispatchEvent(new CustomEvent('fran:action-saved',{detail:{wallet_id:wallet,action:saved.action}}));
   // Refresh history separately; failure must not erase a successful save or draft.
   try{const fresh=await call({action:'load',id:row.id},wallet);if(current())box.querySelector('.fran-action-history').innerHTML='<summary>Decision history</summary>'+history(fresh.history||[],fresh.members||roster);}catch(_){}
  }catch(e){if(current()){status.textContent=e.message;status.setAttribute('role','alert');if(e.status===409)box.querySelector('[data-action-reload]').hidden=false;}}
  finally{busy=false;controls.forEach((el,i)=>el.disabled=disabled[i]);}
 };
}
function history(events,roster){return events.length?events.map(event=>'<article><strong>'+E(labels[event.snapshot.status]||event.snapshot.status)+'</strong><small>'+E(roster.find(m=>m.id===event.actor_id)?.label||'Former Wallet member')+' · '+E(new Date(event.created_at).toLocaleString())+'</small><p>'+E(event.snapshot.note||'Next step saved')+'</p></article>').join(''):'<p>No saved decisions yet.</p>';}
window.FRAN_ACTIONS={mount,list};
window.addEventListener('fran:location',e=>{const changed=state?.wallet?.id!==e.detail?.wallet?.id||state?.wallet?.access_role!==e.detail?.wallet?.access_role;state=e.detail;if(changed||!state?.wallet){epoch++;document.querySelectorAll('.fran-action-editor').forEach(box=>box.remove());document.querySelectorAll('[data-fran-action-list]').forEach(host=>{host.replaceChildren();delete host.dataset.franActionList;});}});
})();
