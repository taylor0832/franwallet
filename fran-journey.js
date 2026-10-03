/* Set up with Fran: the first-run journey for a single location.
   One steering question at a time on the left; the Wallet assembling itself on the right.
   Creation reuses the existing location form and save path (validation, rollback, goal save).
   Uploads, provider invites and partner invites happen inside the conversation through the same
   endpoints as their dedicated screens. Provider authorization still happens on the provider's own
   screen, and the journey picks up again on return. "Saved" comes only from server-backed records;
   everything else is labeled as started, invited, requested or later. */
(()=>{'use strict'
const $=id=>document.getElementById(id),E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const reduce=()=>matchMedia('(prefers-reduced-motion: reduce)').matches
const wait=ms=>new Promise(r=>setTimeout(r,reduce()?0:ms))
const metric=(n,p)=>{try{window.posthog?.capture(n,p)}catch(_){}}
const memberId=()=>typeof ME!=='undefined'&&ME?.id||''
const actions=()=>window.FRAN_SETUP_ACTIONS,journeyApi=()=>window.FRAN_SETUP_JOURNEY
const ICON={
 entity:'<path d="M4 21V5l8-3 8 3v16"/><path d="M9 21v-5h6v5M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01"/>',
 lease:'<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
 banking:'<path d="M3 9 12 4l9 5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
 accounting:'<path d="M4 19V5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2Zm0 0a2 2 0 0 0 2 2h12"/><path d="M8 8h6M8 12h6"/>',
 payroll:'<circle cx="9" cy="8" r="3"/><path d="M3 20c.7-3.4 3-5 6-5s5.3 1.6 6 5"/><path d="M16 4.5a3 3 0 0 1 0 6M18 15c1.8.6 2.8 2.2 3 5"/>',
 insurance:'<path d="M12 3 5 6v5c0 4.4 2.9 8.3 7 10 4.1-1.7 7-5.6 7-10V6l-7-3Z"/>',
 check:'<path d="m5 12 4 4 10-10"/>',upload:'<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>',link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',people:'<circle cx="9" cy="8" r="3"/><path d="M3 20c.7-3.4 3-5 6-5s5.3 1.6 6 5M17 11v6M14 14h6"/>'}
const svg=n=>'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+(ICON[n]||'')+'</svg>'

/* ---------- the six parts of a Wallet ---------- */
const SLOTS={
 entity:{name:'Company',noun:'company',hub:'company',topic:'company'},
 lease:{name:'Lease',noun:'lease',hub:'files'},
 banking:{name:'Bank',noun:'bank account',hub:'banking',topic:'bank'},
 accounting:{name:'Books',noun:'books',hub:'books',topic:'qbo'},
 payroll:{name:'Payroll',noun:'payroll',hub:'payroll',topic:'payroll'},
 insurance:{name:'Insurance',noun:'insurance',hub:'insurance',topic:'insurance'}}
const UNLOCKS=[
 {name:'Ask your Wallet',needs:['any']},{name:'Monthly numbers',needs:['accounting']},{name:'Cash view',needs:['banking']},
 {name:'Labor planning',needs:['payroll']},{name:'Renewal calendar',needs:['lease','insurance'],any:true},{name:'Data room',needs:['entity','lease']}]
/* The card always shows the six parts in one stable order; the plan only decides which question comes next. */
const CANON=['entity','lease','banking','accounting','payroll','insurance']
const HUBKEY={entity:'company',lease:'lease',banking:'banking',accounting:'books',payroll:'payroll',insurance:'insurance'}
const ORDERS={
 preopening:['entity','lease','banking','insurance','accounting','payroll'],
 maintain:['accounting','banking','payroll','insurance','lease','entity'],
 financing:['accounting','banking','lease','entity','insurance','payroll'],
 exit:['lease','entity','accounting','banking','insurance','payroll']}
const WHY={
 preopening:{entity:'Your bank, landlord and payroll provider will all ask for it.',lease:'Rent, term and renewal dates drive your opening budget.',banking:'Keeps business money separate from day one.',insurance:'Landlords and franchisors often ask for proof before you open.',accounting:'Start clean books before the first sale.',payroll:'Ready before your first hire.'},
 operating:{accounting:'Your monthly numbers, with the reporting period on each one.',banking:'Cash and activity, dated.',payroll:'Your largest controllable cost.',insurance:'Coverage limits and renewal dates in one place.',lease:'Rent, term and renewal dates.',entity:'Owners, EIN and filings lenders will ask for.'}}

/* ---------- state ----------
   Owner choices (later, started, invited, requested, do-it-yourself) are kept on the server as one
   validated `setup` record per location, so they follow the owner to any device. The server copy is
   authoritative; this session's edits that are not yet saved sit on top until the save succeeds. Clocks
   are never compared. "Saved" is never stored: it is always read from records. */
let loc=null,life=null,dialog=null,phase=null,draft={},stepKey=null,busy=false,server=null,persistTimer=null,pending=null,lastPut=0
const key=()=>'fran_journey:'+memberId()+':'+(loc?.wallet?.id||'new')
const CHOICES=['later','started','invited','requested','diy']
function local(){try{return JSON.parse(localStorage.getItem(key())||'{}')}catch(_){return {}}}
function fromServer(d){const o={slots:d.parts||{},finished:!!d.finished};for(const k of ['order','stage','formed','people','last'])if(d[k]&&(!Array.isArray(d[k])||d[k].length))o[k]=d[k];return o}
function store(){const l=local();if(!server)return {...l,...(pending||{})};return {...l,...fromServer(server.data||{}),...(pending||{})}}
function save(p){pending={...(pending||{}),...p};const next={...store(),ts:Date.now()};try{localStorage.setItem(key(),JSON.stringify(next))}catch(_){}if(loc?.wallet&&owned()){clearTimeout(persistTimer);persistTimer=setTimeout(persist,400)}}
async function api(fn,action,body){const {data:{session}}=await sb.auth.getSession();if(!session)throw Error('Please sign in again.')
 const r=await fetch(SUPABASE_URL+'/functions/v1/'+fn,{method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify({action,wallet_id:loc.wallet.id,...body})})
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'That didn’t go through. Please try again.');return d}
async function persist(){const s=store(),w=loc?.wallet;if(!w||!owned()||typeof sb==='undefined')return
 const data={parts:Object.fromEntries(Object.entries(s.slots||{}).filter(([,v])=>CHOICES.includes(v))),order:s.order||[],stage:s.stage||'',formed:s.formed||'',people:s.people||'',last:s.last||'',finished:!!s.finished}
 const sent=pending;try{await api('lifecycle','save',{kind:'setup',request_id:'setup',data});if(loc?.wallet?.id!==w.id)return;server={data,updated_at:new Date().toISOString()};lastPut=Date.now();if(pending===sent)pending=null}catch(_){/* Unsaved edits stay on top of the server copy; the next change retries. */}}
function mark(slot,status){const s=store();save({slots:{...(s.slots||{}),[slot]:status}});renderWallet()}
const owned=()=>!!loc?.wallet&&!loc.wallet.access_role
function leaseSaved(){return (life?.records||[]).some(r=>r.kind==='lease')||(loc?.records||[]).some(r=>r.kind==='document'&&/lease/i.test([r.data?.category,r.data?.document_type,r.data?.name].join(' ')))}
function saved(slot){if(slot==='lease')return leaseSaved();const t=SLOTS[slot].topic;return !!journeyApi()?.catalog?.().find(x=>x.id===t)?.saved}
function profile(){return actions()?.profile?.()||null}
function stage(){const s=store();return s.stage||((life?.records||[]).find(r=>r.kind==='entity')?.data?.operating_status==='preopening'?'preopening':profile()?.stage)||'operating'}
function order(){const s=store();if(s.order)return s.order;return stage()==='preopening'?ORDERS.preopening:ORDERS[profile()?.goal]||ORDERS.maintain}
function status(slot){if(saved(slot))return 'saved';return store().slots?.[slot]||'empty'}
const LABEL={saved:'Saved',started:'In progress',invited:'Invite created',requested:'Help requested',later:'Later',empty:'Not started',diy:'On your list'}
function readyCount(){return Object.keys(SLOTS).filter(saved).length}
/* Invited, requested and do-it-yourself parts are with someone already; they wait on the list rather than being asked again. */
const PARKED=['later','invited','requested','diy']
/* A company with a name but no EIN or owners is still worth one question: its papers fill those in. Asked once. */
function entityThin(){const d=(life?.records||[]).find(r=>r.kind==='entity')?.data||{};return !(d.ein&&(d.owners||[]).length)}
const due=s=>!saved(s)?!PARKED.includes(status(s)):s==='entity'&&entityThin()&&!store().slots?.entity
function nextSlot(from){const o=order(),start=from?o.indexOf(from)+1:0;return o.slice(start).find(due)||null}

/* ---------- shell ---------- */
function shell(){if(dialog)return dialog
dialog=document.createElement('dialog');dialog.id='fran-journey';dialog.className='fj';dialog.setAttribute('aria-label','Set up your Wallet with Fran')
dialog.innerHTML='<div class="fj-top"><span class="fj-brand"><b>F.</b> Set up with Fran</span><span class="fj-phase" data-fj-phase></span><button type="button" class="fj-exit" data-fj-exit>Save & exit</button></div><div class="fj-main"><section class="fj-chat"><div class="fj-log" role="log" aria-live="polite" aria-label="Setup conversation"></div><div class="fj-turn" data-fj-turn></div></section><aside class="fj-wallet" aria-label="Your Wallet, as it comes together"></aside></div>'
dialog.addEventListener('cancel',e=>{if(phase==='create'&&busy)e.preventDefault()})
dialog.addEventListener('close',()=>{showPill();renderHome();metric('journey_closed',{phase,ready:loc?readyCount():0})})
dialog.querySelector('[data-fj-exit]').onclick=()=>{if(phase==='create'&&!loc?.wallet){if(!confirm('Leave setup? Your location hasn’t been created yet.'))return}dialog.close()}
document.body.append(dialog);return dialog}
const log=()=>dialog.querySelector('.fj-log'),turn=()=>dialog.querySelector('[data-fj-turn]')
function setPhase(t){dialog.querySelector('[data-fj-phase]').textContent=t}
async function say(html,{lead=false}={}){const m=document.createElement('div');m.className='fj-msg fran'+(lead?' lead':'');m.innerHTML='<span class="fj-avatar" aria-hidden="true">F.</span><div class="fj-bubble"><span class="fj-typing" aria-hidden="true"><i></i><i></i><i></i></span></div>';log().append(m);scroll()
await wait(420);m.querySelector('.fj-bubble').innerHTML=html;scroll();await wait(120)}
function you(text){const m=document.createElement('div');m.className='fj-msg you';m.innerHTML='<div class="fj-bubble">'+E(text)+'</div>';log().append(m);scroll()}
function scroll(){const l=dialog.querySelector('.fj-chat');requestAnimationFrame(()=>l.scrollTo({top:l.scrollHeight,behavior:reduce()?'auto':'smooth'}))}
function clearTurn(){turn().innerHTML=''}
/* A turn is one question: choices (cards) and/or an input. Resolves with the picked value. */
function ask({choices=[],input=null,skip=null,note=''}){return new Promise(resolve=>{const t=turn();t.innerHTML=''
 if(input){const f=document.createElement('form');f.className='fj-input';f.innerHTML=(input.label?'<label for="fj-in">'+E(input.label)+'</label>':'')+'<div>'+(input.options?'<select id="fj-in" required><option value="">'+E(input.placeholder||'Choose')+'</option>'+input.options.map(o=>'<option value="'+E(o[0])+'">'+E(o[1])+'</option>').join('')+'</select>':'<input id="fj-in" type="'+(input.type||'text')+'" autocomplete="'+(input.type==='email'?'email':'off')+'" '+(input.required===false?'':'required ')+'maxlength="'+(input.type==='email'?254:80)+'" placeholder="'+E(input.placeholder||'')+'" value="'+E(input.value||'')+'">')+'<button type="submit">'+E(input.button||'Continue')+' →</button></div>'+(input.hint?'<small>'+E(input.hint)+'</small>':'')
  f.onsubmit=e=>{e.preventDefault();const el=f.querySelector('#fj-in'),v=el.value.trim();if(input.required!==false&&!v){el.focus();return}const shown=input.options?(input.options.find(o=>o[0]===v)||[])[1]:v;if(shown)you(shown);clearTurn();resolve(v)}
  t.append(f);if(input.live)f.querySelector('#fj-in').oninput=e=>input.live(e.target.value)}
 if(choices.length){const g=document.createElement('div');g.className='fj-choices'+(choices.length>3?' grid':'');g.setAttribute('role','group')
  g.innerHTML=choices.map((c,i)=>'<button type="button" class="fj-choice'+(c.primary?' primary':'')+(c.commit?' commit':'')+'" data-i="'+i+'">'+(c.icon?'<span class="fj-ci">'+svg(c.icon)+'</span>':'')+'<span><strong>'+E(c.label)+'</strong>'+(c.sub?'<small>'+E(c.sub)+'</small>':'')+'</span>'+(c.tag?'<em>'+E(c.tag)+'</em>':'')+'</button>').join('')
  g.querySelectorAll('button').forEach(b=>b.onclick=()=>{const c=choices[b.dataset.i];if(c.echo!==false)you(c.label);clearTurn();resolve(c.value??c.label)});t.append(g)}
 if(note){const n=document.createElement('p');n.className='fj-note';n.innerHTML=note;t.append(n)}
 if(skip){const s=document.createElement('button');s.type='button';s.className='fj-skip';s.textContent=skip.label;s.onclick=()=>{you(skip.label);clearTurn();resolve(skip.value)};t.append(s)}
 requestAnimationFrame(()=>(t.querySelector('#fj-in')||t.querySelector('.fj-choice.primary')||t.querySelector('.fj-choice'))?.focus({preventScroll:true}));scroll()})}

/* ---------- the Wallet card ---------- */
function renderWallet(){if(!dialog)return
const w=dialog.querySelector('.fj-wallet'),name=loc?.wallet?.name||draft.name||'Your location',sub=[draft.brand||loc?.wallet?.brand,loc?.wallet?.state||draft.state].filter(Boolean).join(' · ')
const o=CANON
const rows=o.map(s=>{const st=loc?status(s):(s==='entity'&&draft.legal?'pending':'empty'),cur=s===stepKey
 return '<li class="fj-slot" data-state="'+st+'"'+(cur?' aria-current="step"':'')+'><span class="fj-slot-icon">'+svg(st==='saved'?'check':s)+'</span><span class="fj-slot-name">'+E(SLOTS[s].name)+'</span><span class="fj-slot-state">'+E(cur&&st==='empty'?'Up next':st==='pending'?'Ready to save':LABEL[st]||'')+'</span></li>'}).join('')
const have=s=>loc&&(s==='any'?Object.keys(SLOTS).some(saved):saved(s))
const unlocks=UNLOCKS.map(u=>{const on=u.any?u.needs.some(have):u.needs.every(have);return '<span class="fj-unlock'+(on?' on':'')+'">'+(on?'✓ ':'')+E(u.name)+'</span>'}).join('')
const n=loc?readyCount():0
w.innerHTML='<div class="fj-card'+(draft.name||loc?' named':'')+'"><div class="fj-card-head"><span class="fj-card-mark">FRAN WALLET</span><span class="fj-card-count">'+n+' of 6</span></div><h2>'+E(name)+'</h2><p>'+E(sub||'Name your location to begin')+'</p><div class="fj-meter" aria-hidden="true"><i style="width:'+Math.round(n/6*100)+'%"></i></div><ol class="fj-slots">'+rows+'</ol></div><div class="fj-unlocks"><small>WHAT YOUR WALLET UNLOCKS</small><div>'+unlocks+'</div></div><p class="fj-trust">Private to this location. Connections are read-only. Nothing is sent or shared without your say-so.</p>'}

/* ---------- phase A: create the location in conversation ---------- */
async function create(){phase='create';shell();log().innerHTML='';clearTurn();draft={};stepKey=null;setPhase('Step 1 of 2 · Your location');renderWallet();if(!dialog.open)dialog.showModal()
metric('journey_started',{phase:'create'})
await say('<strong>Welcome to your Wallet.</strong> I’m Fran. Together we’ll bring your company, lease, bank, books, payroll and insurance into one place, so you always know where things stand and what to do next.',{lead:true})
await say('It takes about two minutes to start. You can finish the rest at your own pace, and I’ll keep your place.')
await say('First, what do you call this location?')
draft.name=await ask({input:{placeholder:'For example, Crumbl · Eastlake',button:'Continue',hint:'A store name or nickname is perfect. The legal name can come later.',live:v=>{draft.name=v;renderWallet()}}});renderWallet()
await say('Which franchise brand is it?')
draft.brand=await ask({input:{placeholder:'For example, Crumbl',required:false,button:'Continue'},skip:{label:'Skip',value:''}});renderWallet()
await say('Where is '+E(draft.name)+' today?')
draft.stage=await ask({choices:[{label:'Getting ready to open',sub:'Signing, building out or hiring',value:'preopening',icon:'lease'},{label:'Open and operating',sub:'Already serving customers',value:'operating',icon:'accounting'}]});renderWallet()
await say('Which state will it operate in?')
draft.state=await ask({input:{options:STATES(),placeholder:'Choose a state',button:'Continue'}});renderWallet()
await say('Has the company that will own it been formed yet, like an LLC or corporation?')
const formed=await ask({choices:[{label:'Yes, it’s formed',value:'yes',sub:'I know the legal name'},{label:'Not yet',value:'no',sub:'I’ll help you plan it'},{label:'Not sure',value:'unsure'}]})
if(formed==='yes'){await say('What’s the legal name?');draft.legal=await ask({input:{placeholder:'For example, Eastlake Cookies LLC',required:false,button:'Save name'},skip:{label:'I’ll add it later',value:''}});draft.entityType=/\bllc\b/i.test(draft.legal||'')?'LLC':/\binc\b|corp/i.test(draft.legal||'')?'Corporation':''}
draft.formed=formed;renderWallet()
await say('Last question. What’s the next big milestone for '+E(draft.name)+'? I’ll put the right things first.')
draft.goal=await ask({choices:draft.stage==='preopening'?[{label:'Opening day',sub:'Get every piece in place to open',value:'maintain',primary:true},{label:'Financing the build-out',sub:'Lender-ready from the start',value:'financing'}]:[{label:'Clearer monthly numbers',sub:'Know cash, profit and labor',value:'maintain',primary:true},{label:'Financing or refinancing',sub:'Lender-ready records',value:'financing'},{label:'Selling someday',sub:'Buyer-ready records',value:'exit'}]});renderWallet()
const plan=draft.stage==='preopening'?ORDERS.preopening:ORDERS[draft.goal]||ORDERS.maintain,why=WHY[draft.stage==='preopening'?'preopening':'operating']
await say('Here’s your plan. Most owners do it in this order:<ol class="fj-plan">'+plan.map(s=>'<li><strong>'+E(SLOTS[s].name)+'</strong><span>'+E(why[s])+'</span></li>').join('')+'</ol>For each one you can connect it, upload it, invite the person who already has it, or have CoverPanda set it up.')
const go=await ask({choices:[{label:'Create '+draft.name+'’s Wallet',value:'go',primary:true,commit:true,echo:false}],note:'Free to start. Nothing connects, uploads or sends without your OK.'})
if(go!=='go')return
await createWallet(plan)}
function STATES(){const codes=typeof STATE_CODES!=='undefined'?STATE_CODES:[];return codes.map(c=>[c,c])}
async function createWallet(plan){busy=true;setPhase('Creating your Wallet');const t=turn();t.innerHTML='<ul class="fj-building" aria-live="polite"><li data-b="1">Creating '+E(draft.name)+'</li><li data-b="2">Saving the company profile</li><li data-b="3">Building your plan</li></ul>'
const form=$('wallet-form');try{window.FRAN_JOURNEY_ORIGINAL_OPEN?.('create');$('wallet-modal').classList.add('hidden')
 form.elements.wallet_name.value=draft.name;form.elements.state.value=draft.state;form.elements.operating_status.value=draft.stage;if(form.elements.brand)form.elements.brand.value=draft.brand||''
 if(form.elements.legal_name)form.elements.legal_name.value=draft.legal||'';if(form.elements.entity_type&&draft.entityType)form.elements.entity_type.value=draft.entityType
 const radio=form.querySelector('[name=onboarding_goal][value="'+draft.goal+'"]');if(radio)radio.checked=true
 const before=(typeof WALLETS!=='undefined'?WALLETS.length:0);WMODE='create';WSTEP=3
 t.querySelector('[data-b="1"]').classList.add('on');pendingPlan={plan,stage:draft.stage,formed:draft.formed}
 await submitWalletModal()
 $('wallet-modal').classList.add('hidden')
 if((typeof WALLETS!=='undefined'?WALLETS.length:0)<=before){throw new Error($('wallet-modal-error')?.textContent||'We couldn’t create the location.')}
 t.querySelectorAll('li').forEach(li=>li.classList.add('on','done'))
}catch(e){busy=false;pendingPlan=null;t.innerHTML='';await say('That didn’t save: '+E(e.message||'please try again')+' Your answers are still here.');const r=await ask({choices:[{label:'Try again',value:'retry',primary:true}]});if(r==='retry')return createWallet(plan);return}
busy=false}
let pendingPlan=null

/* ---------- phase B: the six parts, one at a time ---------- */
async function afterCreate(){const p=pendingPlan;pendingPlan=null;if(!p)return
save({order:p.plan,stage:p.stage,formed:p.formed})
phase='slots';document.querySelectorAll('#view-wallet .main>.notice.ok').forEach(n=>n.remove());renderWallet();setPhase('Step 2 of 2 · Fill your Wallet')
await say('<strong>'+E(loc.wallet.name)+' is live.</strong> '+(saved('entity')?'Your company name is already in. ':'')+'Let’s fill it in, one piece at a time. You can do most of it right here.')
metric('journey_wallet_created',{stage:p.stage})
await runSlots()}
async function resume(trigger='button'){if(!owned())return false
if(pendingPlan||(dialog?.open&&phase))return true
shell();phase='slots';$('fran-connectors')?.close();if(!dialog.open){log().innerHTML='';clearTurn();dialog.showModal()}
setPhase('Fill your Wallet · '+readyCount()+' of 6 saved');renderWallet();metric('journey_resumed',{trigger,ready:readyCount()})
const last=store().last
if(last&&saved(last))await say('<strong>✓ '+E(SLOTS[last].name)+' is saved.</strong> '+(readyCount()<6?'Nice. On to the next one.':'That was the last one.'))
else if(last&&store().slots?.[last]==='started')await say(trigger==='return'?'Welcome back. '+E(SLOTS[last].name)+' isn’t showing as saved yet. If you finished on the provider’s screen it can take a moment; otherwise we can try another way.':'Welcome back. '+E(SLOTS[last].name)+' isn’t showing as saved yet. Want to finish it, or move on?')
else await say('Welcome back to '+E(loc.wallet.name)+'. '+readyCount()+' of 6 parts are saved. Let’s keep going.')
await runSlots(last&&store().slots?.[last]==='started'&&!saved(last)?last:null);return true}
async function runSlots(retry){let s=retry||nextSlot()
while(s){stepKey=s;save({current:s});renderWallet();let r;do{r=await slot(s)}while(r==='back');if(r==='left')return;s=nextSlot(s)||nextSlot()}
stepKey=null;renderWallet();await people();await finish()}
function leave(slot,status,fn){mark(slot,status);save({last:slot});window.FRAN_HUB?.quiet?.(SLOTS[slot].hub,8000);metric('journey_handoff',{slot,status});dialog.close();setTimeout(fn,60);return 'left'}
const help=service=>()=>dispatchEvent(new CustomEvent('fran:service-profile',{detail:{service}}))
async function laterOrNext(s,reason){mark(s,'later');renderWallet();await say('No problem. I’ll keep '+E(SLOTS[s].noun)+' on your list'+(reason?' '+reason:'')+'.');return 'next'}
const sleep=ms=>new Promise(r=>setTimeout(r,ms))

/* Upload inside the conversation: same signed-upload endpoints as Data rooms, explicit consent first. */
function filePicker(label){return new Promise(resolve=>{const t=turn(),name=loc.wallet.name
 t.innerHTML='<form class="fj-drop"><label class="fj-dropzone"><input type="file" accept=".pdf,.png,.jpg,.jpeg,.heic,.csv,.xlsx,.xls,.txt,.doc,.docx"><span class="fj-ci">'+svg('upload')+'</span><strong>'+E(label)+'</strong><small>Drop it here or choose a file · PDF, photo, spreadsheet or text · up to 25 MB</small><em data-file></em></label><label class="fj-consent"><input type="checkbox"> Store it privately with '+E(name)+' and let Fran read it. Nothing is shared.</label><div class="fj-drop-actions"><button type="submit" class="fj-go" disabled>Upload</button><button type="button" class="fj-skip" data-back>Choose another way</button></div><p class="fj-err" role="alert"></p></form>'
 const f=t.querySelector('form'),input=f.querySelector('input[type=file]'),consent=f.querySelector('.fj-consent input'),go=f.querySelector('.fj-go'),zone=f.querySelector('.fj-dropzone'),err=f.querySelector('.fj-err')
 let file=null;const sync=()=>{go.disabled=!(file&&consent.checked)}
 const take=x=>{err.textContent='';if(!x)return;if(x.size>25*1024*1024){file=null;err.textContent='That file is over 25 MB. Choose a smaller one.';sync();return}file=x;f.querySelector('[data-file]').textContent=x.name;zone.classList.add('has-file');sync()}
 input.onchange=()=>take(input.files[0]);consent.onchange=sync
 zone.ondragover=e=>{e.preventDefault();zone.classList.add('over')};zone.ondragleave=()=>zone.classList.remove('over');zone.ondrop=e=>{e.preventDefault();zone.classList.remove('over');take(e.dataTransfer.files[0])}
 f.onsubmit=e=>{e.preventDefault();if(file&&consent.checked){clearTurn();resolve(file)}}
 f.querySelector('[data-back]').onclick=()=>{clearTurn();resolve(null)}
 requestAnimationFrame(()=>input.focus({preventScroll:true}));scroll()})}
function progress(text){turn().innerHTML='<p class="fj-progress" role="status"><span class="fj-spin" aria-hidden="true"></span>'+E(text)+'</p>';scroll()}
async function uploadFlow(s,category,label,hint,{track=true}={}){for(;;){const file=await filePicker(label);if(!file)return 'back'
 const reading=hint&&window.FranDetails?window.FranDetails.readFile(file,hint):null
 progress('Saving '+file.name+' privately…')
 try{const signed=await api('location','upload_url',{name:file.name,size:file.size,category});const {error}=await sb.storage.from('location-docs').uploadToSignedUrl(signed.path,signed.token,file,{contentType:file.type||'application/octet-stream'});if(error)throw Error(error.message);await api('location','finish_upload',{...signed,name:file.name,category})}
 catch(e){clearTurn();await say('That upload didn’t finish ('+E(e.message)+'). Nothing was saved. Let’s try again.');continue}
 you('Uploaded '+file.name);if(track){mark(s,'started');save({last:s})}window.FRAN_HUB?.quiet?.(SLOTS[s].hub,5000);metric('journey_inline',{slot:s,action:'upload',hint:hint||''})
 const r=reading?await reading:null
 if(r&&r.kind&&r.found>=2){await details(s,file,r);return 'next'}
 await reward(s,file.name);return 'next'}}
/* The magic moment: what the document says, ready to check and save into the Wallet. */
async function details(s,file,r){progress('Reading '+file.name+'…');try{await window.refreshLocation?.(true)}catch(_){}const docId=findDoc(file.name)?.id||'';clearTurn()
 await say('I read <strong>'+E(file.name)+'</strong>. Here’s what I found. Check it, fix anything that’s off, and save it to your Wallet.')
 const saved=await window.FranDetails.review(turn(),r.kind,r.fields,{fileName:file.name,docId});clearTurn();renderWallet();renderHome();showPill()
 if(!saved){await say('No problem. The file is saved privately; you can add these details anytime from '+(r.kind==='loan'?'Finance → Debt schedule':'Company')+'.');return}
 metric('journey_first_value',{slot:s,type:r.kind,saved:true});await say('<strong>✓ Saved to your Wallet.</strong> '+window.FranDetails.summary(saved))
 if(saved.kind==='entity'&&(saved.owners||[]).length>1){await say('The papers name '+saved.owners.length+' owners. Want to invite the others so they can see this location too?');await window.FranDetails.inviteOwners(turn(),saved.owners);clearTurn()}
 if(s!=='banking'&&saved&&isSaved(s))await say('<strong>✓ '+E(SLOTS[s].name)+' is saved.</strong>')}
const isSaved=x=>saved(x)
/* The first-value moment: show only what was actually read from the file, with its source. */
const TYPE={lease:'Lease',insurance_policy:'Insurance policy',tax_return:'Tax return',bank_statement:'Bank statement',operating_agreement:'Operating agreement',articles_of_organization:'Articles of organization',franchise_agreement:'Franchise agreement'}
const money=v=>Number.isFinite(Number(v))&&v!==null&&v!==''?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(v)):''
function findDoc(name){return (loc?.records||[]).filter(r=>r.kind==='document'&&r.data?.name===name).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0]||null}
const READING=['queued','pending','processing','extracting']
const readDone=d=>!!(d&&(d.document_type||d.summary||d.ingestion&&d.ingestion.status&&!READING.includes(d.ingestion.status)))
function facts(d){const rows=[],ing=d.ingestion||{};const add=(k,v)=>{if(v)rows.push('<div><dt>'+E(k)+'</dt><dd>'+E(v)+'</dd></div>')}
 add('Document',TYPE[d.document_type]||(d.document_type?String(d.document_type).replace(/_/g,' '):''))
 add('Signature',d.signature_status);add('Carrier',d.carrier);add('Policy number',d.policy_number)
 if(d.effective||d.expiration)add('Term',[d.effective,d.expiration].filter(Boolean).join(' to '))
 add('Annual premium',money(d.annual_premium));add('General liability (each occurrence)',money(d.general_liability_each_occurrence))
 if(!d.document_type&&ing.suggested_category)add('Looks like',ing.suggested_category)
 if(Number.isFinite(ing.total_units)&&ing.total_units>0)add('Readable',ing.readable_units+' of '+ing.total_units+' page'+(ing.total_units===1?'':'s'))
 if(ing.status==='failed')add('Status','I couldn’t read the text. The original is saved.')
 return (rows.length?'<dl class="fj-facts">'+rows.join('')+'</dl>':'')+(d.summary?'<p class="fj-found">'+E(d.summary)+'</p>':'')+(ing.note?'<p class="fj-why">'+E(ing.note)+'</p>':'')}
async function reward(s,name){await say('Got it. <strong>'+E(name)+'</strong> is saved privately with '+E(loc.wallet.name)+'. Give me a moment to read it.')
 progress('Reading '+name+'…');let doc=null;const until=Date.now()+(reduce()?20000:45000)
 while(Date.now()<until){try{await window.refreshLocation?.(true)}catch(_){}doc=findDoc(name);if(readDone(doc?.data))break;await sleep(3500)}
 clearTurn();renderWallet();showPill();renderHome()
 const found=readDone(doc?.data)
 if(found){metric('journey_first_value',{slot:s,type:doc.data.document_type||doc.data.ingestion?.suggested_category||'text'});await say((doc.data.ingestion?.status==='failed'?'I saved '+E(name)+', but couldn’t read its text:':'Here’s what I found in '+E(name)+':')+facts(doc.data)+'<small class="fj-why">Read from your file today. Check anything important against the original in Data rooms.</small>')}
 else await say('I’m still reading '+E(name)+'. Nothing is lost: it’s in Data rooms now, and '+E(SLOTS[s].name.toLowerCase())+' turns to Saved here as soon as I can confirm what it is.')
 if(saved(s))await say('<strong>✓ '+E(SLOTS[s].name)+' is saved.</strong>')}

/* Invite the provider who already has it: a private link for one email and this location only. The owner sends it. */
const CAN={accounting:'connect QuickBooks and add financial reports',payroll:'add payroll reports',insurance:'add policy documents',entity:'add company documents'}
async function linkTurn(url,extra){return new Promise(resolve=>{const t=turn();t.innerHTML='<div class="fj-link"><span class="fj-ci">'+svg('link')+'</span><input readonly aria-label="Invitation link" value="'+E(url)+'"><button type="button" data-copy>Copy link</button></div>'+(extra||'')+'<div class="fj-drop-actions"><button type="button" class="fj-go" data-done>Continue</button></div><p class="fj-err" role="status"></p>'
 const st=t.querySelector('.fj-err');t.querySelector('[data-copy]').onclick=async e=>{try{await navigator.clipboard.writeText(url);e.target.textContent='Copied';st.textContent='Link copied. Send it by text or email.'}catch(_){t.querySelector('input').select();st.textContent='Select the link and copy it.'}}
 t.querySelectorAll('[data-extra]').forEach(b=>b.onclick=()=>resolve(b.dataset.extra));t.querySelector('[data-done]').onclick=()=>{clearTurn();resolve('done')};requestAnimationFrame(()=>t.querySelector('[data-copy]').focus({preventScroll:true}));scroll()})}
async function inviteFlow(s,scope,who){await say('Who’s your '+E(who)+'? I’ll make a private link that only works when they sign in with that email. They can '+E(CAN[scope])+' for '+E(loc.wallet.name)+' only, and can’t see your other files, balances or shared rooms. You send it yourself.')
 for(;;){const email=(await ask({input:{type:'email',placeholder:'name@firm.com',button:'Create invite link'},skip:{label:'Choose another way',value:''}})).toLowerCase();if(!email)return 'back'
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){await say('That doesn’t look like an email address. Try again?');continue}
  progress('Creating the invite…')
  try{const d=await api('contributors','create',{scope,email});clearTurn();mark(s,'invited');save({last:s});metric('journey_inline',{slot:s,action:'invite'})
   await say('Your invite for <strong>'+E(email)+'</strong> is ready. It lasts 30 days. Copy it and send it however you like.');await linkTurn(d.url);renderWallet();return 'next'}
  catch(e){clearTurn();await say('I couldn’t create that invite ('+E(e.message)+').')}}}
/* Provider authorization stays on the provider’s screen; say exactly what happens first. */
const PROVIDER={qbo:['QuickBooks','accounting reports and company details you authorize','create, edit or pay anything'],bank:['Plaid','only the accounts, balances and activity you approve','move money or see your bank login'],payroll:['Gusto','payroll summaries and labor totals','run or change payroll']}
async function connectFlow(s,connector){const [p,reads,cant]=PROVIDER[connector]
 await say('You’ll approve read-only access on '+E(p)+'’s own screen. Fran can read '+E(reads)+'; it can’t '+E(cant)+'. When you’re done, I’ll pick up right here.')
 const c=await ask({choices:[{label:'Continue to '+p,value:'go',primary:true},{label:'Choose another way',value:'back'}]});if(c!=='go')return 'back'
 save({awaiting:s});return leave(s,'started',()=>actions()?.run?.(connector))}

async function slot(s){const n=loc.wallet.name,st=loc.wallet.state||'your state',pre=stage()==='preopening',payrollManual=actions()?.connectorHealth?.('payroll')?.state==='manual'
const head=(t,why)=>say('<span class="fj-step">'+svg(s)+E(SLOTS[s].name)+'</span>'+t+(why?'<small class="fj-why">'+E(why)+'</small>':''))
const W=WHY[pre?'preopening':'operating'][s]
if(s==='entity'){
 if(store().formed==='no'&&!saved('entity')&&store().slots?.entity!=='diy'){await head('The company comes first. Want CoverPanda to form it, or will you do it yourself?',W)
  const c=await ask({choices:[{label:'Form it with CoverPanda',sub:'See formation and registered agent options',value:'cp',primary:true,icon:'entity'},{label:'I’ll do it myself',sub:'I’ll give you the three steps',value:'diy'},{label:'My attorney is handling it',sub:'Invite them to add the documents, free',value:'att',icon:'people',tag:'Free'}],skip:{label:'Later',value:'later'}})
  if(c==='cp')return leave(s,'requested',help('entity'))
  if(c==='att')return inviteFlow(s,'entity','attorney')
  if(c==='diy'){mark(s,'diy');await say('Here’s the short version:<ol class="fj-plan"><li><strong>File with '+E(st)+'</strong><span>Articles of organization with the Secretary of State.</span></li><li><strong>Get your EIN</strong><span>Free from the IRS at irs.gov. It takes minutes online.</span></li><li><strong>Bring them here</strong><span>Upload them and I’ll read the details.</span></li></ol>');const d=await ask({choices:[{label:'I have them now',value:'up',primary:true,icon:'upload'},{label:'Continue setup',value:'next'}]});if(d==='up'){const r=await uploadFlow(s,'Other','Upload your articles, operating agreement or EIN letter','entity');if(r!=='back')return r}return 'next'}
  return laterOrNext(s,'for when it’s formed')}
 await head(saved('entity')?'Your company name is saved. Add the formation papers or EIN letter and I’ll fill in the EIN, state and owners.':'Let’s add the company behind '+E(n)+'.',W)
 const c=await ask({choices:[{label:'Upload formation documents',sub:'I’ll read the legal name, EIN, state and owners',value:'up',primary:true,icon:'upload'},{label:'Type the details',sub:'Legal name, EIN and owners',value:'type'},{label:'Invite my attorney',sub:'They add it for you',value:'att',icon:'people',tag:'Free'}],skip:{label:saved('entity')?'Good for now':'Later',value:'later'}})
 if(c==='up')return uploadFlow(s,'Other','Upload your articles, operating agreement or EIN letter','entity');if(c==='type')return leave(s,'started',()=>{window.switchTab?.('entity');setTimeout(()=>{const f=$('life-entity-form');f?.scrollIntoView({block:'start'});f?.querySelector('input,select')?.focus()},150)});if(c==='att')return inviteFlow(s,'entity','attorney')
 if(saved('entity')){mark(s,'later');return 'next'}return laterOrNext(s)}
if(s==='lease'){await head('Where are you on the lease for '+E(n)+'?',W)
 const c=await ask({choices:[{label:'It’s signed',sub:'I’ll read the landlord, dates, base rent and CAM',value:'signed',primary:true,icon:'upload'},{label:'Still negotiating',sub:'Upload the LOI or draft',value:'loi'},...(pre?[{label:'Still looking for a site',value:'site'}]:[])],skip:{label:'Later',value:'later'}})
 if(c==='signed')return uploadFlow(s,'Lease','Upload your signed lease','lease');if(c==='loi')return uploadFlow(s,'Lease','Upload the LOI or draft lease','lease')
 return laterOrNext(s,c==='site'?'for when you have a site':'')}
if(s==='banking'){const r=await bankStep();if(r==='next'&&!store().loan_asked)await loans();return r}
return slotRest(s)}
/* Loans live with the bank step: read the note and build the schedule. Asked once; never counts as a Wallet part on its own. */
async function loans(){save({loan_asked:true});await say('<span class="fj-step">'+svg('banking')+'Loans</span>Is there a loan on '+E(loc.wallet.name)+', like an SBA, bank or equipment loan?<small class="fj-why">Upload the note and I’ll read the lender, your contact, the amount, rate and term, and build the month-by-month schedule.</small>')
 const c=await ask({choices:[{label:'Yes, upload the loan document',sub:'Promissory note or loan agreement',value:'up',primary:true,icon:'upload'},{label:'No loans',value:'none'}],skip:{label:'Later',value:'later'}})
 if(c==='up'){const r=await uploadFlow('banking','Debt & lending','Upload your promissory note or loan agreement','loan',{track:false});if(r==='back')return loans()}
 else if(c==='none')await say('Got it. No loans to track.')}
async function bankStep(){const s='banking',n=loc.wallet.name,pre=stage()==='preopening',W=WHY[pre?'preopening':'operating'][s],head=(t,why)=>say('<span class="fj-step">'+svg(s)+E(SLOTS[s].name)+'</span>'+t+(why?'<small class="fj-why">'+E(why)+'</small>':''))
{await head('Does the business have its own bank account yet?',W)
 const c=await ask({choices:[{label:'Yes, connect it',sub:'Read-only through Plaid. Fran can’t move money.',value:'plaid',primary:true,icon:'banking'},{label:'Yes, I’ll upload a statement',value:'stmt',icon:'upload'},{label:'Not yet',sub:'I’ll help you get one',value:'no'}],skip:{label:'Later',value:'later'}})
 if(c==='plaid')return connectFlow(s,'bank');if(c==='stmt'){const r=await uploadFlow(s,'Financial statements','Upload a recent bank statement');if(r==='next')await say('Connecting the account through Plaid keeps balances current. You can do that anytime from Finance.');return r}
 if(c==='no'){await say('You’ll need your formation documents and EIN to open one.'+(saved('entity')?'':' That’s why the company comes first.'));const d=await ask({choices:[{label:'Help me choose a bank',sub:'Prepares an editable request. Nothing is applied for.',value:'help',primary:true},{label:'I’ll open one myself',value:'diy'}]});if(d==='help')return leave(s,'requested',()=>journeyApi()?.draft?.('bank'));mark(s,'diy');return 'next'}
 return laterOrNext(s)}}
async function slotRest(s){const n=loc.wallet.name,st=loc.wallet.state||'your state',pre=stage()==='preopening',payrollManual=actions()?.connectorHealth?.('payroll')?.state==='manual'
const head=(t,why)=>say('<span class="fj-step">'+svg(s)+E(SLOTS[s].name)+'</span>'+t+(why?'<small class="fj-why">'+E(why)+'</small>':''))
const W=WHY[pre?'preopening':'operating'][s]
if(s==='accounting'){const qboLive=window.FRAN_HUB?.qboLive?.()!==false;await head('Who keeps the books for '+E(n)+'?',W)
 const c=await ask({choices:[{label:'I use QuickBooks',sub:qboLive?'Connect it in about a minute':'Upload a P&L from QuickBooks for now',value:'qbo',primary:true,icon:'accounting'},{label:'My accountant or bookkeeper',sub:'Invite them to connect it for you',value:'inv',icon:'people',tag:'Free'},{label:'No one yet',sub:'See CoverPanda bookkeeping or other options',value:'none'},{label:'Spreadsheets or other software',sub:'Upload a recent P&L',value:'up'}],skip:{label:'Later',value:'later'}})
 if(c==='qbo')return qboLive?connectFlow(s,'qbo'):uploadFlow(s,'Financial statements','Upload a recent P&L from QuickBooks')
 if(c==='inv')return inviteFlow(s,'accounting','accountant or bookkeeper');if(c==='up')return uploadFlow(s,'Financial statements','Upload a recent P&L')
 if(c==='none')return leave(s,'requested',help('books'));return laterOrNext(s)}
if(s==='payroll'){await head(pre?'Will you have employees on payroll soon?':'How do you run payroll today?',W)
 const c=await ask({choices:[{label:'Gusto',sub:payrollManual?'Import a Gusto report now. Live connection isn’t enabled yet.':'Connect it, read-only',value:'gusto',primary:true,icon:'payroll'},{label:'Another provider',sub:'ADP, Paychex, Square, Toast…',value:'other'},{label:pre?'Not yet. Help me set it up':'I need a payroll provider',sub:'See CoverPanda payroll options',value:'help'}],skip:{label:pre?'Later, before my first hire':'Later',value:'later'}})
 if(c==='gusto')return payrollManual?leave(s,'started',()=>actions()?.alternative?.('payroll')):connectFlow(s,'payroll')
 if(c==='other'){const d=await ask({choices:[{label:'Import a payroll report',sub:'Opens the payroll import, which reads pay periods and totals',value:'imp',primary:true},{label:'Invite my payroll provider',sub:'They add reports for you',value:'inv',icon:'people',tag:'Free'},{label:'Back',value:'back'}]});if(d==='imp')return leave(s,'started',()=>actions()?.alternative?.('payroll'));if(d==='inv')return inviteFlow(s,'payroll','payroll provider');return 'back'}
 if(c==='help')return leave(s,'requested',help('payroll'));return laterOrNext(s,pre?'for before your first hire':'')}
if(s==='insurance'){await head('Is '+E(n)+' insured yet?',W)
 const c=await ask({choices:[{label:'Yes, I have a policy',sub:'Upload the declarations page; I’ll read limits and dates',value:'up',primary:true,icon:'upload'},{label:'My agent has it',sub:'Invite them to add policies',value:'inv',icon:'people',tag:'Free'},{label:'Not yet',sub:'Get coverage options from CoverPanda',value:'help'}],skip:{label:'Later',value:'later'}})
 if(c==='up')return uploadFlow(s,'Legal & insurance','Upload your policy or declarations page');if(c==='inv')return inviteFlow(s,'insurance','insurance agent');if(c==='help')return leave(s,'requested',help('insurance'))
 return laterOrNext(s)}
return 'next'}

/* Your people: add a business partner inside the conversation. Adding them grants nothing until they
   sign in with that email; the invitation goes out only when the owner copies it or presses Send. */
async function people(){if(store().people)return;stepKey=null;renderWallet()
await say('<span class="fj-step">'+svg('people')+'Your people</span>Does anyone else own or run '+E(loc.wallet.name)+' with you?<small class="fj-why">Partners can manage this location’s connections, records, documents and sharing. They don’t see your other locations.</small>')
for(;;){const c=await ask({choices:[{label:'Invite a business partner',sub:'Add them by email',value:'inv',primary:true,icon:'people'},{label:'Just me for now',value:'solo'}]})
 if(c==='solo'){save({people:'solo'});return}
 const email=(await ask({input:{type:'email',placeholder:'partner@example.com',button:'Add partner'},skip:{label:'Back',value:''}})).toLowerCase();if(!email)continue
 if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){await say('That doesn’t look like an email address.');continue}
 progress('Adding '+email+'…')
 try{await api('location','grant_team',{email});clearTurn();save({people:'inv'});metric('journey_inline',{slot:'people',action:'partner'})
  await say('<strong>'+E(email)+'</strong> is added. They’ll get access when they sign in with that email. How do you want to send the invitation?')
  const url='https://franwallet.com/wallet.html?team_wallet='+encodeURIComponent(loc.wallet.id)
  const r=await linkTurn(url,'<div class="fj-drop-actions"><button type="button" class="fj-choice-mini" data-extra="email">Email the invitation to '+E(email)+'</button></div>')
  if(r==='email'){progress('Sending…');try{await api('location','send_team_invite',{email,invite_id:crypto.randomUUID()});clearTurn();await say('Invitation email sent to '+E(email)+'.')}catch(e){clearTurn();await say('The email didn’t send ('+E(e.message)+'). You can copy the link instead.');await linkTurn(url)}}
  return}catch(e){clearTurn();await say('I couldn’t add that partner ('+E(e.message)+').')}}}
async function finish(){const s=Object.keys(SLOTS),done=s.filter(saved),open=s.filter(x=>!saved(x))
setPhase('Your Wallet is set up')
await say('<strong>'+E(loc.wallet.name)+'’s Wallet is set up.</strong> '+(done.length?done.length+' of 6 parts are saved.':'Nothing is saved yet, and that’s fine.')+(open.length?' The rest are on your list on Home, on any device.':' Every part is in.')+'<ul class="fj-summary">'+s.map(x=>'<li data-state="'+status(x)+'">'+svg(saved(x)?'check':x)+'<span>'+E(SLOTS[x].name)+'</span><em>'+E(LABEL[status(x)])+'</em></li>').join('')+'</ul>')
await say('Your Wallet is free. <strong>Location Pro</strong> adds written answers from Fran about your records, and CoverPanda can run your books, payroll or insurance for you. You don’t need either to keep going.')
save({finished:true});metric('journey_finished',{ready:done.length})
const waiting=s.filter(x=>['later','started','diy'].includes(status(x)))
const c=await ask({choices:[{label:'Open my Wallet',value:'home',primary:true,echo:false},...(waiting.length?[{label:'Work on what’s left',sub:waiting.map(x=>SLOTS[x].name).join(', '),value:'more'}]:[]),{label:'Ask Fran a question',value:'ask',echo:false}]})
if(c==='more'){const st=store(),slots={...(st.slots||{})};waiting.forEach(x=>delete slots[x]);save({slots,finished:false});return runSlots()}
dialog.close();window.switchTab?.(c==='ask'?'ask':'dashboard')}

/* ---------- the resume pill ---------- */
function showPill(){let p=$('fran-journey-pill');const need=!!loc&&owned()&&readyCount()<6
if(!need){if(p)p.hidden=true;return}
if(!p){p=document.createElement('button');p.type='button';p.id='fran-journey-pill';p.className='fj-pill';p.onclick=()=>resume('pill');document.body.append(p)}
const next=nextSlot(),n=readyCount()
p.innerHTML='<span class="fj-pill-mark" aria-hidden="true">F.</span><span><strong>'+E(loc.wallet.name)+' · '+n+' of 6 ready</strong><small>'+(next?'Next: '+E(SLOTS[next].name):'Review what’s left')+'</small></span><span class="fj-pill-ring" style="--p:'+Math.round(n/6*100)+'" aria-hidden="true"></span><b aria-hidden="true">Continue →</b>'
p.setAttribute('aria-label','Continue setting up '+loc.wallet.name+', '+n+' of 6 ready'+(next?', next '+SLOTS[next].name:''))
p.hidden=!!dialog?.open}

/* ---------- Home: the same six parts, with the next step first ---------- */
function renderHome(){const dash=$('page-dashboard');let h=$('fj-home')
if(!dash||!loc||!owned()||!profile()){h?.remove();document.body.classList.remove('fj-home-on');return}
if(!h){h=document.createElement('section');h.id='fj-home';h.className='fj-home'}
const anchor=dash.querySelector('.main-hdr');if(anchor){if(anchor.nextElementSibling!==h)anchor.after(h)}else if(dash.firstElementChild!==h)dash.prepend(h)
const n=readyCount(),next=nextSlot(),why=WHY[stage()==='preopening'?'preopening':'operating']
document.body.classList.add('fj-home-on')
const title=n===6?E(loc.wallet.name)+' is fully set up.':next?'Next up: '+E(next==='accounting'?'your books':'your '+SLOTS[next].noun)+'.':'Pick up what’s left for '+E(loc.wallet.name)+'.'
const sub=n===6?'Every part is in. Fran will flag anything that goes out of date.':next?why[next]:'Everything else is on your list, invited, or with CoverPanda.'
h.innerHTML='<div class="fj-home-head"><div><small>YOUR WALLET · '+n+' OF 6 SAVED</small><h2>'+title+'</h2><p>'+E(sub)+'</p></div>'+(n<6?'<button type="button" class="fj-home-go" data-fj-continue>Continue with Fran →</button>':'')+'</div><div class="fj-meter light" aria-hidden="true"><i style="width:'+Math.round(n/6*100)+'%"></i></div><ol class="fj-home-grid">'+CANON.map(x=>{const st=status(x);return '<li data-state="'+st+'"'+(x===next?' data-next':'')+'><button type="button" data-fj-area="'+x+'"><span class="fj-slot-icon">'+svg(st==='saved'?'check':x)+'</span><span><strong>'+E(SLOTS[x].name)+'</strong><small>'+E(x===next&&st!=='saved'?'Up next':LABEL[st])+'</small></span></button></li>'}).join('')+'</ol>'
h.querySelector('[data-fj-continue]')?.addEventListener('click',()=>resume('home'))
h.querySelectorAll('[data-fj-area]').forEach(b=>b.onclick=()=>window.FRAN_HUB?.openArea?.(HUBKEY[b.dataset.fjArea],'home_tile'))}
/* ---------- wiring ---------- */
const orig=window.openWalletModal
if(orig){window.FRAN_JOURNEY_ORIGINAL_OPEN=orig
 window.openWalletModal=function(mode,...a){if((mode||'create')==='create'&&typeof WALLETS!=='undefined'&&!WALLETS.length&&!busy)return create();return orig.call(this,mode,...a)}}
window.addEventListener('fran:location',e=>{const prev=loc?.wallet?.id;loc=e.detail;if(prev!==loc?.wallet?.id){life=null;server=null;pending=null;lastPut=0}if(prev&&prev!==loc?.wallet?.id&&dialog?.open&&phase!=='create')dialog.close();renderWallet();showPill();renderHome()})
window.addEventListener('fran:readiness',e=>{if(e.detail?.location?.wallet?.id!==loc?.wallet?.id)return;life=e.detail.life;/* A refresh fetched just before our own save lands can carry the previous copy; keep what we just wrote. */const row=(life?.records||[]).find(r=>r.kind==='setup');if(row&&!(server&&Date.now()-lastPut<15000))server={data:row.data||{},updated_at:row.updated_at||row.created_at};renderWallet();showPill();renderHome()
 /* Back from a provider’s authorization screen: continue the conversation once per return. */
 const waiting=store().awaiting;if(waiting&&owned()&&!dialog?.open&&!pendingPlan){save({awaiting:''});setTimeout(()=>resume('return'),300)}})
/* Continue once this wallet's data arrives; if the refresh is slow, continue with the wallet just created and let the data fill in. */
window.addEventListener('fran:onboarding-created',e=>{if(!pendingPlan)return;const id=e.detail?.wallet_id,started=Date.now();const go=()=>{if(loc?.wallet?.id===id)return afterCreate();const w=typeof WALLETS!=='undefined'&&WALLETS.find(x=>x.id===id);if(w&&Date.now()-started>2500){loc={wallet:w,records:[],books:[],banks:[]};return afterCreate()}setTimeout(go,120)};go()})
window.addEventListener('fran:connector-result',()=>setTimeout(showPill,200))
const FROM_HUB={company:'entity',lease:'lease',banking:'banking',books:'accounting',payroll:'payroll',insurance:'insurance'},NOTE={connect:'started',file:'started',drive:'started',primary:'started',invite:'invited',help:'requested'}
window.FRAN_JOURNEY={create,resume,saved,note:(hubKey,action)=>{const slot=FROM_HUB[hubKey];if(!slot||!loc||!NOTE[action]||saved(slot))return;mark(slot,NOTE[action]);save({last:slot});renderHome();showPill()},ready:()=>loc?readyCount():0,refresh:()=>{renderWallet();showPill();renderHome()},active:()=>!!dialog?.open||!!pendingPlan,state:()=>store(),
 /* An owned wallet that still has parts to fill opens here (once per session) instead of the generic guide. */
 autoResume:()=>{if(pendingPlan||dialog?.open)return true;if(!owned()||readyCount()>=6||store().finished)return false;resume('auto');return true}}
})()
