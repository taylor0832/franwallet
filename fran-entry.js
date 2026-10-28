/* Entity intent only in durable browser storage. No names, email, tokens or URLs are stored here.
 * Same-browser OTP/reload recovery; another browser/device asks again instead of guessing.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root?.document){root.FranEntry=api.browser(root);}})(typeof window==='undefined'?null:window,()=>{
'use strict';const choices=Object.freeze({new:'Start a new entity',existing:'I already have an entity',unsure:'I’m not sure yet'}),TTL=30*86400000;
const isIntent=x=>typeof x==='string'&&Object.prototype.hasOwnProperty.call(choices,x);
const isUuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const safeKeys=(f,allowed)=>f&&typeof f==='object'&&!Array.isArray(f)&&Object.keys(f).every(k=>allowed.includes(k));
function routeContext(search='',hash=''){
 const q=new URLSearchParams(search),h=new URLSearchParams(String(hash).replace(/^#/,''));
 // Inspect key presence, never retain callback values, tokens or the URL.
 if(['service_return','service_canceled','qbo','gusto','plaid','oauth_state_id','team_wallet','invite','invitation','billing','billing_wallet','service_view','location','wallet'].some(k=>q.has(k)))return {kind:'return'};
 if(['code','state','error','error_code','access_token','refresh_token','token','token_hash','type'].some(k=>q.has(k)||h.has(k)))return {kind:'auth'};
 if(q.has('view')&&q.get('view')&&q.get('view')!=='dashboard')return {kind:'destination'};
 return {kind:'home'};
}
function entryDecision({signedIn=false,needsFirstLocation=false,hasIntent=false,paused=false,search='',hash=''}={}){
 if(!signedIn)return 'signin';
 if(routeContext(search,hash).kind!=='home')return 'defer';
 if(hasIntent&&paused)return 'offer';
 return needsFirstLocation||hasIntent?'start':'normal';
}
function store(storage,uuid,now=()=>Date.now()){
 const key=m=>'fran_entry_v1:'+m,read=k=>{try{return JSON.parse(storage.getItem(k)||'null')}catch{return null}},write=(k,v)=>{storage.setItem(k,JSON.stringify(v));if(storage.getItem(k)!==JSON.stringify(v))throw Error('Setup recovery storage is unavailable.');return v;};
 const valid=f=>safeKeys(f,['v','id','intent','createdAt'])&&f.v===1&&isIntent(f.intent)&&isUuid(f.id)&&Number.isFinite(f.createdAt)&&f.createdAt>0&&now()-f.createdAt>=0&&now()-f.createdAt<TTL;
 function pending(){const f=read(key('pending'));return valid(f)?{v:1,id:f.id,intent:f.intent,createdAt:f.createdAt}:null;}
 function choose(intent){if(!isIntent(intent))throw Error('Choose your entity starting point.');const old=pending();return write(key('pending'),old?.intent===intent?old:{v:1,id:uuid(),intent,createdAt:now()});}
 function get(member){const f=read(key(member));if(!safeKeys(f,['v','id','intent','createdAt','member','walletId','phase','paused'])||f.v!==1||f.member!==member||!isUuid(f.id)||!isUuid(f.walletId)||!Number.isFinite(f.createdAt)||f.createdAt<=0||!['draft','creating','complete'].includes(f.phase)||!(isIntent(f.intent)||f.intent===''&&f.phase==='draft')||f.paused!==undefined&&typeof f.paused!=='boolean')return null;return {v:1,id:f.id,intent:f.intent,createdAt:f.createdAt,member:f.member,walletId:f.walletId,phase:f.phase,paused:f.paused===true};}
 function update(member,id,patch){const f=get(member);if(!f||f.id!==id)throw Error('This setup changed. Reload your saved progress.');return write(key(member),{...f,...patch});}
 function claim(member){if(!member)throw Error('Sign in before creating a wallet.');let f=get(member);const p=pending();if(f&&f.phase!=='complete'){if(p&&p.id!==f.id){if(f.phase==='draft')f=update(member,f.id,{intent:p.intent});storage.removeItem(key('pending'));}return update(member,f.id,{paused:false});}f={v:1,id:p?.id||uuid(),intent:p?.intent||'',createdAt:p?.createdAt||now(),member,walletId:uuid(),phase:'draft',paused:false};write(key(member),f);storage.removeItem(key('pending'));return f;}
 function pause(member){let f=get(member);if(!f&&pending())f=claim(member);if(!f||f.phase==='complete')return f;storage.removeItem(key('pending'));return update(member,f.id,{paused:true});}
 return {pending,choose,get,claim,pause,hasIntent:member=>!!pending()||!!(get(member)&&get(member).phase!=='complete'),setIntent:(m,id,intent)=>{if(!isIntent(intent))throw Error('Choose your entity starting point.');if(get(m)?.phase!=='draft')throw Error('Recover the saved wallet before changing its entity intent.');return update(m,id,{intent});},creating:(m,id)=>update(m,id,{phase:'creating'}),complete:(m,id)=>update(m,id,{phase:'complete'})};
}

async function createOnce({state,member,flowId,db,call,name,operatingState='',brand='',entity,profile,setup,lock}){
 if(!lock)throw Error('This browser cannot safely coordinate wallet creation. Use a browser with Web Locks support.');
 return lock('fran-wallet-create:'+member,async()=>{
  const f=state.get(member);if(!f||f.id!==flowId||!isIntent(f.intent))throw Error('Resume the entity choice before creating a wallet.');state.creating(member,flowId);
  const lookup=async()=>{const r=await db.from('wallets').select().eq('id',f.walletId).eq('member_id',member).maybeSingle();if(r.error)throw Error('Wallet creation could not be confirmed. Resume this same setup.');return r.data;};
  let wallet=await lookup();if(!wallet){const r=await db.from('wallets').insert({id:f.walletId,member_id:member,name,state:operatingState||null,brand:brand||null}).select().single();wallet=r.data;if(r.error||!wallet)wallet=await lookup();if(!wallet)throw Error('Wallet creation could not be confirmed. Resume this same setup.');}
  if(wallet.member_id!==member)throw Error('Wallet ownership could not be confirmed.');
  const snapshot=await call('load',{},wallet.id);if(!Array.isArray(snapshot.records))throw Error('Saved setup could not be confirmed. Resume this same setup.');const records=snapshot.records;
  // Existing records win on recovery. Never delete a wallet or overwrite its saved legal/profile/setup data.
  if(!records.some(r=>r.kind==='entity'))await call('save',{kind:'entity',request_id:'entry-'+f.id,data:{...entity,onboarding_draft:true,stage:f.intent==='existing'?'existing':'planning'}},wallet.id);
  if(!records.some(r=>r.kind==='readiness_profile'))await call('readiness_profile',{data:profile},wallet.id);
  const existing=records.find(r=>r.kind==='setup');const setupData=existing?.data||{...setup,formed:{new:'no',existing:'yes',unsure:'unsure'}[f.intent]};
  if(!existing)await call('save',{kind:'setup',request_id:'entry-'+f.id,data:setupData},wallet.id);
  state.complete(member,flowId);return {wallet,setup:setupData};
 });
}
function browser(w){let storage;try{storage=w.localStorage}catch{storage={getItem:()=>null,setItem:()=>{throw Error('Browser storage is required to recover setup safely.');},removeItem:()=>{}}}const state=store(storage,()=>w.crypto.randomUUID());let dialog;const hiddenForPage=new Set(),returnPriority=new Set();
const coordinated=(member,fn)=>w.navigator.locks?w.navigator.locks.request('fran-wallet-create:'+member,fn):Promise.reject(Error('This browser needs Web Locks support to safely recover setup.'));

 function renderChoice(host,redirect){host.innerHTML='<h2>Your business starts here</h2><p>Choose where you are today. Creating a wallet never forms a legal entity.</p><div class="entry-choices">'+Object.entries(choices).map(([k,v])=>'<button type="button" class="btn btn-primary" data-entry-intent="'+k+'">'+v+'</button>').join('')+'</div><p data-entry-status role="status"></p>';host.querySelectorAll('[data-entry-intent]').forEach(b=>{b.onclick=()=>{try{state.choose(b.dataset.entryIntent);host.querySelector('[data-entry-status]').textContent='Saved: '+choices[b.dataset.entryIntent]+'. Continue with your email below.';host.querySelectorAll('[data-entry-intent]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));if(redirect)w.location.href='wallet.html';}catch(e){host.querySelector('[data-entry-status]').textContent=e.message;}}});const picked=state.pending();if(picked)host.querySelector('[data-entry-status]').textContent='Saved starting point: '+choices[picked.intent]+'.';}
 function openChoice(){if(!dialog){dialog=w.document.createElement('dialog');dialog.setAttribute('aria-label','Choose your entity starting point');dialog.innerHTML='<button type="button" data-entry-close>Close</button><section></section>';dialog.querySelector('[data-entry-close]').onclick=()=>dialog.close();w.document.body.append(dialog);renderChoice(dialog.querySelector('section'),true);}dialog.showModal();}
 function renderResume(member){const old=w.document.getElementById('fran-entry-resume');old?.remove();if(!state.hasIntent(member)||hiddenForPage.has(member))return;const main=w.document.querySelector('#view-wallet .main');if(!main)return;const box=w.document.createElement('section');box.id='fran-entry-resume';box.setAttribute('aria-label','Saved wallet setup');box.innerHTML='<p role="status">Your unfinished wallet setup is saved. Finish your current task first, or resume when you are ready.</p><div><button type="button" class="btn btn-ghost" data-entry-resume>Resume wallet setup</button><button type="button" class="btn btn-ghost" data-entry-later>Keep setup for later</button></div>';main.prepend(box);
 box.querySelector('[data-entry-resume]').onclick=async()=>{try{if(!state.hasIntent(member))return renderResume(member);box.querySelectorAll('button').forEach(b=>b.disabled=true);await coordinated(member,()=>state.claim(member));box.remove();w.openWalletModal?.('create');}catch{box.querySelector('[role=status]').textContent='Saved setup could not resume safely. Refresh and try again.';box.querySelectorAll('button').forEach(b=>b.disabled=false);}};
 box.querySelector('[data-entry-later]').onclick=async()=>{try{await coordinated(member,()=>state.pause(member));hiddenForPage.add(member);box.remove();}catch{box.querySelector('[role=status]').textContent='Setup is still saved. This browser could not pause its reminder.';}};
 }
 function afterSignIn(member,needsFirstLocation){let action=entryDecision({signedIn:!!member,needsFirstLocation,hasIntent:state.hasIntent(member),paused:state.get(member)?.paused===true,search:w.location.search,hash:w.location.hash});if(action==='defer'&&member)returnPriority.add(member);if(action==='start'&&returnPriority.has(member))action='offer';if(action==='start')w.document.getElementById('fran-entry-resume')?.remove();else if(member)renderResume(member);return action;}
 function pause(member){return coordinated(member,()=>state.pause(member)).then(()=>renderResume(member)).catch(()=>{});}
 function mount(){const main=w.document.querySelector('.signin-main');if(main){const box=w.document.createElement('section');box.id='fran-entry-choice';box.setAttribute('aria-label','Set up a business wallet');main.querySelector('#signin-form').before(box);renderChoice(box,false);const note=w.document.createElement('p');note.textContent='Already use Fran? Sign in below to return to your saved wallets. Selecting a starting point above begins a new wallet setup.';box.after(note);}}
 if(w.document.readyState==='loading')w.document.addEventListener('DOMContentLoaded',mount);else mount();
 return {...state,claim:member=>{if(!w.navigator.locks)return Promise.reject(Error('This browser needs Web Locks support to safely recover setup.'));return w.navigator.locks.request('fran-wallet-create:'+member,()=>state.claim(member));},setIntent:(member,id,intent)=>w.navigator.locks.request('fran-wallet-create:'+member,()=>state.setIntent(member,id,intent)),openChoice,afterSignIn,renderResume,pause,routeContext,createWalletOnce:opts=>createOnce({...opts,state,lock:w.navigator.locks?.request.bind(w.navigator.locks)}),labels:choices};
}
return {store,createOnce,browser,choices,routeContext,entryDecision};});
