/* Activation is derived from saved location records, never tour clicks. */
(function(root){
'use strict';
function derive(location,life){
 if(!location?.wallet||location.wallet.access_role==='payroll_editor')return null;
 const records=location.records||[],lifecycle=life?.records||[],docs=records.filter(r=>r.kind==='document');
 const ids=new Set(docs.map(d=>d.id));
 const named=!!location.wallet.name?.trim()&&location.wallet.name.trim().toLowerCase()!=='my wallet';
 const goal=lifecycle.some(r=>r.kind==='readiness_profile');
 const reviewed=lifecycle.some(r=>r.kind==='readiness_evidence'&&r.data?.status==='attached'&&r.data.document_ids?.some(id=>ids.has(id)));
 const done=[named,goal,docs.length>0,reviewed],index=done.findIndex(x=>!x);
 return {done,index,complete:index===-1,count:done.filter(Boolean).length,documents:docs.length};
}
if(typeof module==='object'&&module.exports)module.exports={derive};
if(typeof document==='undefined')return;
root.FranActivation={derive};
const main=document.querySelector('#view-wallet .main');if(!main)return;
const guide=document.createElement('section');guide.id='activation-guide';guide.setAttribute('aria-label','Wallet setup progress');main.prepend(guide);
let context=null,life=null,items=[],last=null;
const labels=['Name your location','Choose your goal','Add your first record','Review its coverage'];
const descriptions=['Keep this unit’s documents and finances together under a name you recognize.','Tell Fran what you are preparing for. Your document plan will adapt.','Upload one statement, lease or franchise agreement. It stays private.','Confirm what your document covers. Fran will track its next review date.'];
const targets=['dashboard','readiness','dataroom','readiness'];
const buttons=['Name my location','Choose my goal','Add a private record','Review my record'];
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function move(index){if(index===0){openWalletModal('rename');return;}switchTab(targets[index]);if(index===3){const item=items.find(r=>r.candidates?.length&&r.audience!=='private')||items.find(r=>r.audience!=='private'&&context.records.some(d=>d.kind==='document'&&d.data?.category===r.category))||items.find(r=>r.audience!=='private');if(item){const full=document.getElementById('ready-toggle');if(!document.getElementById('ready-item-'+item.id)&&full)full.click();const panel=document.getElementById('ready-item-'+item.id);if(panel){panel.open=true;panel.scrollIntoView({block:'start',behavior:'instant'});}}}}
function render(){
 const state=derive(context,life);if(!state){guide.replaceChildren();return;}
 guide.innerHTML=`<div class="activation-top"><strong>${state.complete?'Your wallet is activated':'Set up your wallet'} <span>${state.count} / 4</span></strong><span>${state.complete?'Keep records current as your business changes.':'Your progress is saved. Pick up here anytime.'}</span>${!state.complete?`<button type="button" class="btn btn-primary" data-activation-step="${state.index}">${buttons[state.index]} →</button>`:''}</div>${state.complete?'<details class="activation-finished"><summary>Review completed setup</summary>':''}<ol class="activation-steps">${labels.map((label,i)=>`<li class="${state.done[i]?'done':state.index===i?'current':''}"><button type="button" data-activation-step="${i}" ${state.index===i?'aria-current="step"':''}><span aria-hidden="true">${state.done[i]?'✓':i+1}</span>${label}</button></li>`).join('')}</ol>${state.complete?'</details>':''}`;
 guide.querySelectorAll('[data-activation-step]').forEach(b=>b.onclick=()=>move(Number(b.dataset.activationStep)));
 const host=document.getElementById('fw-readiness');if(host&&!state.complete){host.innerHTML=`<div class="fw-shell ready-intro"><p class="concierge-caption">Step ${state.index+1} of 4 · ${escape(context.wallet.name)}</p><h2>${labels[state.index]}</h2><p>${descriptions[state.index]}</p><div class="fw-actions"><button class="btn btn-primary" id="activation-continue">${buttons[state.index]}</button><button class="fw-link" id="activation-help">Get help with this</button></div><p class="fw-subtle">No account connection or payment required. You control what gets shared.</p></div>`;document.getElementById('activation-continue').onclick=()=>move(state.index);document.getElementById('activation-help').onclick=()=>switchTab('services');}
 if(state.complete&&!document.getElementById('activation-complete-note')){const note=document.createElement('p');note.id='activation-complete-note';note.className='fw-note';note.textContent='Setup complete: your location has a goal, a private record and a saved evidence review. This is a starting point, not full financing or exit readiness.';host?.prepend(note);}
 // Enum/count telemetry only; no financial values, names, filenames or notes.
 const key=context.wallet.id+':'+state.done.join('');if(last!==key){last=key;try{posthog.capture('wallet_activation_progress',{completed_steps:state.count,next_step:state.complete?'complete':String(state.index+1),activated:state.complete});}catch(_){}}
}
window.addEventListener('fran:activation-context',e=>{context=e.detail.location;life=e.detail.life;items=e.detail.items||[];render();});
window.addEventListener('fran:location',e=>{if(!e.detail||e.detail.wallet?.id!==context?.wallet.id){context=null;life=null;items=[];guide.replaceChildren();}});
})(typeof window==='undefined'?globalThis:window);
