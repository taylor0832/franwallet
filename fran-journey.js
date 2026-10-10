/* Set up with Fran: the first-run journey for a single location.
   One steering question at a time on the left; the Wallet assembling itself on the right.
   Creation reuses the existing location form and save path (validation, rollback, goal save).
   Uploads, provider invites and partner invites happen inside the conversation through the same
   endpoints as their dedicated screens. Provider authorization still happens on the provider's own
   screen, and the journey picks up again on return. "Saved" comes only from server-backed records;
   everything else is labeled as started, invited, exploring, draft prepared or later. "Help requested"
   appears only once a consented service request is saved. */
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
 check:'<path d="m5 12 4 4 10-10"/>',drive:'<path d="M8 4h8l6 10-4 6H6l-4-6 6-10Z"/><path d="m8 4 6 10H2M16 4l-6 10M22 14H10"/>',upload:'<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>',link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',people:'<circle cx="9" cy="8" r="3"/><path d="M3 20c.7-3.4 3-5 6-5s5.3 1.6 6 5M17 11v6M14 14h6"/>'}
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
 maintain:['entity','accounting','banking','payroll','insurance','lease'],
 financing:['entity','accounting','banking','lease','insurance','payroll'],
 exit:['entity','lease','accounting','banking','insurance','payroll']}
const WHY={
 preopening:{entity:'Your bank, landlord and payroll provider will all ask for it.',lease:'Rent, term and renewal dates drive your opening budget.',banking:'Keeps business money separate from day one.',insurance:'Landlords and franchisors often ask for proof before you open.',accounting:'Start clean books before the first sale.',payroll:'Ready before your first hire.'},
 operating:{accounting:'Your monthly numbers, with the reporting period on each one.',banking:'Cash and activity, dated.',payroll:'Your largest controllable cost.',insurance:'Coverage limits and renewal dates in one place.',lease:'Rent, term and renewal dates.',entity:'Owners, EIN and filings lenders will ask for.'}}

/* ---------- state ----------
   Owner choices (later, started, invited, exploring, drafted, do-it-yourself) are kept on the server as one
   validated `setup` record per location, so they follow the owner to any device. The server copy is
   authoritative; this session's edits that are not yet saved sit on top until the save succeeds. Clocks
   are never compared. "Saved" is never stored: it is always read from records. */
let loc=null,life=null,dialog=null,phase=null,draft={},stepKey=null,busy=false,server=null,persistTimer=null,pending=null,lastPut=0
const key=()=>'fran_journey:'+memberId()+':'+(loc?.wallet?.id||'new')
/* "requested" is never stored: it is read from a consented service request the owner actually saved.
   Opening a service profile is "exploring"; preparing an editable request is "drafted". */
const CHOICES=['later','started','invited','exploring','drafted','diy']
const LEASE_TYPES=[['lease','Signed lease'],['loi_signed','Signed letter of intent (LOI)'],['draft','Draft lease or unsigned LOI'],['other','Something else']]
const LEASE_COUNTS=['lease','loi_signed']
/* Older copies may hold "requested" from before a request was required; read them as exploring. */
const legacy=slots=>Object.fromEntries(Object.entries(slots||{}).map(([k,v])=>[k,v==='requested'?'exploring':v]))
function local(){try{const l=JSON.parse(localStorage.getItem(key())||'{}');if(l.slots)l.slots=legacy(l.slots);return l}catch(_){return {}}}
function fromServer(d){const o={slots:legacy(d.parts),finished:!!d.finished};for(const k of ['order','stage','formed','people','last','lease_doc'])if(d[k]&&(!Array.isArray(d[k])||d[k].length))o[k]=d[k];return o}
function store(){const l=local();if(!server)return {...l,...(pending||{})};return {...l,...fromServer(server.data||{}),...(pending||{})}}
function save(p){pending={...(pending||{}),...p};const next={...store(),ts:Date.now()};try{localStorage.setItem(key(),JSON.stringify(next))}catch(_){}if(loc?.wallet&&owned()){clearTimeout(persistTimer);persistTimer=setTimeout(persist,400)}}
async function api(fn,action,body){const {data:{session}}=await sb.auth.getSession();if(!session)throw Error('Please sign in again.')
 const r=await fetch(SUPABASE_URL+'/functions/v1/'+fn,{method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify({action,wallet_id:loc.wallet.id,...body})})
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(d.error||'That didn’t go through. Please try again.'),{status:r.status});return d}
async function persist(){const s=store(),w=loc?.wallet;if(!w||!owned()||typeof sb==='undefined')return
 const data={parts:Object.fromEntries(Object.entries(s.slots||{}).filter(([,v])=>CHOICES.includes(v))),order:s.order||[],stage:s.stage||'',formed:s.formed||'',people:s.people||'',last:s.last||'',finished:!!s.finished,...(s.lease_doc?{lease_doc:s.lease_doc}:{})}
 const sent=pending;try{await api('lifecycle','save',{kind:'setup',request_id:'setup',data});if(loc?.wallet?.id!==w.id)return;server={data,updated_at:new Date().toISOString()};lastPut=Date.now();if(pending===sent)pending=null}catch(_){/* Unsaved edits stay on top of the server copy; the next change retries. */}}
function mark(slot,status){const s=store();save({slots:{...(s.slots||{}),[slot]:status}});renderWallet()}
const owned=()=>!!loc?.wallet&&!loc.wallet.access_role
/* A lease counts when the owner confirmed lease terms, or confirmed on upload that the file is a signed lease or
   signed LOI and that file is still in the location. A lease document already on file also counts (see recorded()),
   unless the owner said on upload that it is a draft or unsigned. */
function leaseSaved(){if((life?.records||[]).some(r=>r.kind==='lease'))return true;const d=store().lease_doc
 return !!(d&&LEASE_COUNTS.includes(d.type)&&(loc?.records||[]).some(r=>r.kind==='document'&&(d.id&&r.id?r.id===d.id:r.data?.name===d.name)))}
/* A consented request the owner saved: a service request for this part, or a consented formation-help review. */
const SERVICE_FOR={entity:['entity','legal'],accounting:['books'],payroll:['payroll'],insurance:['insurance'],banking:['support']}
function requestSaved(slot){if(slot==='entity'&&(life?.records||[]).some(r=>r.kind==='entity'&&r.data?.stage==='formation_help'&&r.data?.consent===true))return true
 return (loc?.records||[]).some(r=>r.kind==='service'&&r.data?.consent===true&&(SERVICE_FOR[slot]||[]).includes(r.data?.service)&&(slot!=='banking'||/\bbank/i.test(r.data?.note||'')))}
/* A part is saved when a record for it exists: a connection, an owner-entered record, or a document on file that is
   that record (a signed lease, a policy, a P&L, a bank statement, formation papers). A lease the owner marked as a
   draft or unsigned LOI on upload never counts. */
const docs=()=>(loc?.records||[]).filter(r=>r.kind==='document'&&r.data)
const draftLease=r=>{const d=store().lease_doc;return !!d&&!LEASE_COUNTS.includes(d.type)&&(d.id&&r.id?r.id===d.id:r.data.name===d.name)}
const EVIDENCE={
 lease:r=>!draftLease(r)&&!/\b(draft|unsigned|template)\b/i.test(r.data.name||'')&&(r.data.category==='Lease'||/^(lease|loi_signed)$/.test(r.data.document_type||'')||/\blease\b|\bLOI\b|letter of intent/i.test(r.data.name||'')),
 insurance:r=>r.data.category==='Insurance'||/^insurance_/.test(r.data.document_type||'')||/insurance|\bcoi\b|declarations page|certificate of liability/i.test(r.data.name||''),
 accounting:r=>/profit|balance_sheet|income_statement|financial_statement/.test(r.data.document_type||'')||/\bp&l\b|profit (and|&) loss|balance sheet|income statement/i.test(r.data.name||''),
 banking:r=>/bank_statement/.test(r.data.document_type||'')||/bank statement|checking statement/i.test(r.data.name||''),
 payroll:r=>/payroll/.test(r.data.document_type||'')||/payroll (register|summary|journal|report)/i.test(r.data.name||''),
 entity:r=>/articles|operating_agreement|ein_letter|formation/.test(r.data.document_type||'')||/articles of (organization|incorporation)|operating agreement|\bEIN\b|\bCP ?575\b|certificate of formation/i.test(r.data.name||'')}
function recorded(slot){const R=loc?.records||[]
 if(slot==='accounting'&&loc?.books?.length)return true
 if(slot==='banking'&&loc?.banks?.length)return true
 if(slot==='payroll'&&R.some(r=>r.kind==='payroll'))return true
 if(slot==='insurance'&&R.some(r=>r.kind==='insurance'))return true
 if(slot==='entity'&&(life?.records||[]).some(r=>r.kind==='entity'&&(r.data?.legal_name||r.data?.name||r.data?.ein)))return true
 return docs().some(EVIDENCE[slot]||(()=>false))}
function saved(slot){if(slot==='lease'?leaseSaved():!!journeyApi()?.catalog?.().find(x=>x.id===SLOTS[slot].topic)?.saved)return true;return recorded(slot)}
function profile(){return actions()?.profile?.()||null}
function stage(){const s=store();return s.stage||((life?.records||[]).find(r=>r.kind==='entity')?.data?.operating_status==='preopening'?'preopening':profile()?.stage)||'operating'}
/* The company always comes first: every other part (bank, books, payroll) asks for it. */
function order(){const s=store(),o=s.order||(stage()==='preopening'?ORDERS.preopening:ORDERS[profile()?.goal]||ORDERS.maintain);return ['entity',...o.filter(x=>x!=='entity')]}
function status(slot){if(saved(slot))return 'saved';if(requestSaved(slot))return 'requested';const v=store().slots?.[slot]||'empty';return v==='requested'?'exploring':v}
const LABEL={saved:'Saved',started:'In progress',invited:'Invite created',requested:'Help requested',exploring:'Exploring options',drafted:'Draft prepared',later:'Later',empty:'Not started',diy:'On your list'}
function readyCount(){return Object.keys(SLOTS).filter(saved).length}
/* Invited, requested, explored, drafted and do-it-yourself parts already have a path; they wait on the list rather than being asked again. */
const PARKED=['later','invited','requested','exploring','drafted','diy']
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
let said=0
async function say(html,{lead=false}={}){const m=document.createElement('div');m.className='fj-msg fran'+(lead?' lead':'');m.innerHTML='<span class="fj-avatar" aria-hidden="true">F.</span><div class="fj-bubble" id="fj-q-'+(++said)+'"><span class="fj-typing" aria-hidden="true"><i></i><i></i><i></i></span></div>';log().append(m);scroll()
await wait(420);m.querySelector('.fj-bubble').innerHTML=html;scroll();await wait(120)}
function you(text){const m=document.createElement('div');m.className='fj-msg you';m.innerHTML='<div class="fj-bubble">'+E(text)+'</div>';log().append(m);scroll()}
function scroll(){const l=dialog.querySelector('.fj-chat');requestAnimationFrame(()=>l.scrollTo({top:l.scrollHeight,behavior:reduce()?'auto':'smooth'}))}
function clearTurn(){turn().innerHTML=''}
/* The question a turn answers: the latest thing Fran said. Inputs and choice groups are named by it. */
const question=()=>{const q=[...log().querySelectorAll('.fj-msg.fran .fj-bubble[id]')].pop();return q?q.id:''}
/* A turn is one question: choices (cards) and/or an input. Resolves with the picked value. */
function ask({choices=[],input=null,skip=null,note=''}){return new Promise(resolve=>{const t=turn();t.innerHTML='';const q=question(),named=q?' aria-labelledby="'+q+'"':''
 if(input){const f=document.createElement('form');f.className='fj-input';const by=input.label?'':named;f.innerHTML=(input.label?'<label for="fj-in">'+E(input.label)+'</label>':'')+'<div>'+(input.options?'<select id="fj-in" required'+by+'><option value="">'+E(input.placeholder||'Choose')+'</option>'+input.options.map(o=>'<option value="'+E(o[0])+'">'+E(o[1])+'</option>').join('')+'</select>':'<input id="fj-in"'+by+(input.hint?' aria-describedby="fj-in-hint"':'')+' type="'+(input.type||'text')+'" autocomplete="'+(input.type==='email'?'email':'off')+'" '+(input.required===false?'':'required ')+'maxlength="'+(input.type==='email'?254:80)+'" placeholder="'+E(input.placeholder||'')+'" value="'+E(input.value||'')+'">')+'<button type="submit">'+E(input.button||'Continue')+' →</button></div>'+(input.hint?'<small id="fj-in-hint">'+E(input.hint)+'</small>':'')
  f.onsubmit=e=>{e.preventDefault();const el=f.querySelector('#fj-in'),v=el.value.trim();if(input.required!==false&&!v){el.focus();return}const shown=input.options?(input.options.find(o=>o[0]===v)||[])[1]:v;if(shown)you(shown);clearTurn();resolve(v)}
  t.append(f);if(input.live)f.querySelector('#fj-in').oninput=e=>input.live(e.target.value)}
 if(choices.length){const g=document.createElement('div');g.className='fj-choices'+(choices.length>3?' grid':'');g.setAttribute('role','group');if(q)g.setAttribute('aria-labelledby',q);else g.setAttribute('aria-label','Choose an answer')
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

/* ---------- phase A: create the location in conversation ----------
   Answers given before the Wallet exists are kept for this browser session only, so a reload doesn't lose them.
   They are cleared as soon as the Wallet is created. */
const draftKey=()=>'fran_journey_draft:'+(memberId()||'signed-out')
function keepDraft(){try{sessionStorage.setItem(draftKey(),JSON.stringify(draft))}catch(_){}}
function priorDraft(){try{const d=JSON.parse(sessionStorage.getItem(draftKey())||'null');return d&&typeof d==='object'&&!Array.isArray(d)&&typeof d.name==='string'&&d.name.trim()?d:null}catch(_){return null}}
function dropDraft(){try{sessionStorage.removeItem(draftKey())}catch(_){}}
async function create(){phase='create';shell();log().innerHTML='';clearTurn();draft={};stepKey=null;setPhase('Launch your business · Your starting point');renderWallet();if(!dialog.open)dialog.showModal()
metric('journey_started',{phase:'create'})
const prior=priorDraft()
await say('<strong>Your next chapter starts here.</strong> I’m Fran, your guide from business setup toward opening day. If your brand, broker or advisor sent you here, this is where you turn that handoff into a practical plan. We’ll start with where you are today—not a list of accounts you must connect.',{lead:true})
await say('First we’ll name your location, confirm what already exists and choose your next milestone. No legal entity, site or documents yet? That’s OK. Your wallet keeps the next steps, records and people together. Creating a wallet does not form a company or notify the person who referred you.')
if(prior){await say('Welcome back. I kept the answers you gave earlier in this browser session for <strong>'+E(prior.name)+'</strong>. Nothing has been created yet.')
 const c=await ask({choices:[{label:'Continue where I left off',value:'keep',primary:true},{label:'Start over',value:'reset'}]})
 if(c==='keep'){draft=prior;renderWallet()}else dropDraft()}
const has=k=>Object.prototype.hasOwnProperty.call(draft,k)
if(!has('name')){await say('First, what do you call this location?')
 const name=await ask({input:{placeholder:'For example, Crumbl · Eastlake',button:'Continue',hint:'A store name or nickname is perfect. The legal name can come later.',live:v=>{draft.name=v;renderWallet()}}});draft.name=name;keepDraft();renderWallet()}
if(!has('brand')){await say('Which franchise brand is it?')
 draft.brand=await ask({input:{placeholder:'For example, Crumbl',required:false,button:'Continue'},skip:{label:'Skip',value:''}});keepDraft();renderWallet()}
if(!has('stage')){await say('Where is '+E(draft.name)+' today?')
 draft.stage=await ask({choices:[{label:'Getting ready to open',sub:'Signing, building out or hiring',value:'preopening',icon:'lease'},{label:'Open and operating',sub:'Already serving customers',value:'operating',icon:'accounting'}]});keepDraft();renderWallet()}
if(!has('state')){await say('Which state will it operate in?')
 draft.state=await ask({input:{options:STATES(),placeholder:'Choose a state',button:'Continue'}});keepDraft();renderWallet()}
if(!has('formed')){await say('Has the company that will own it been formed yet, like an LLC or corporation?')
 const formed=await ask({choices:[{label:'Yes, it’s formed',value:'yes',sub:'I know the legal name'},{label:'Not yet',value:'no',sub:'I’ll help you plan it'},{label:'Not sure',value:'unsure',sub:'We’ll sort it out together'}]})
 draft.formed=formed;keepDraft()}
if(draft.formed==='yes'&&!has('legal')){await say('What’s the legal name?');draft.legal=await ask({input:{placeholder:'For example, Eastlake Cookies LLC',required:false,button:'Save name'},skip:{label:'I’ll add it later',value:''}});keepDraft()}
draft.entityType=/\bllc\b/i.test(draft.legal||'')?'LLC':/\binc\b|corp/i.test(draft.legal||'')?'Corporation':'';renderWallet()
if(!has('goal')){await say('Last question. What’s the next big milestone for '+E(draft.name)+'? I’ll put the right things first.')
 draft.goal=await ask({choices:draft.stage==='preopening'?[{label:'Opening day',sub:'Get every piece in place to open',value:'maintain',primary:true},{label:'Financing the build-out',sub:'Organized for lenders from the start',value:'financing'}]:[{label:'Clearer monthly numbers',sub:'Know cash, profit and labor',value:'maintain',primary:true},{label:'Financing or refinancing',sub:'Records organized for lender review',value:'financing'},{label:'Selling someday',sub:'Records organized for a buyer’s review',value:'exit'}]});keepDraft();renderWallet()}
const plan=draft.stage==='preopening'?ORDERS.preopening:ORDERS[draft.goal]||ORDERS.maintain,why=WHY[draft.stage==='preopening'?'preopening':'operating']
await say('Here’s your plan. Most owners do it in this order:<ol class="fj-plan">'+plan.map(s=>'<li><strong>'+E(SLOTS[s].name)+'</strong><span>'+E(why[s])+'</span></li>').join('')+'</ol>This is a starting sequence, not your brand’s official opening checklist. We’ll adjust it as your site, funding and provider requirements become clear. You can add what you have, invite a helper or leave a step for later.')
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
 dropDraft();t.querySelectorAll('li').forEach(li=>li.classList.add('on','done'))
}catch(e){busy=false;pendingPlan=null;t.innerHTML='';await say('That didn’t save: '+E(e.message||'please try again')+' Your answers are still here.');const r=await ask({choices:[{label:'Try again',value:'retry',primary:true}]});if(r==='retry')return createWallet(plan);return}
busy=false}
let pendingPlan=null

/* ---------- phase B: the six parts, one at a time ---------- */
async function afterCreate(){const p=pendingPlan;pendingPlan=null;if(!p)return
save({order:p.plan,stage:p.stage,formed:p.formed})
phase='slots';document.querySelectorAll('#view-wallet .main>.notice.ok').forEach(n=>n.remove());renderWallet();setPhase(p.stage==='preopening'?'Launch your business · Your first next step':'Step 2 of 2 · Fill your Wallet')
await say('<strong>'+E(loc.wallet.name)+' is live.</strong> '+(saved('entity')?'Your company name is already in. ':'')+'Let’s fill it in, one piece at a time. You can do most of it right here.')
metric('journey_wallet_created',{stage:p.stage})
await runSlots()}
async function resume(trigger='button'){if(!owned())return false
if(pendingPlan||(dialog?.open&&phase))return true
shell();phase='slots';$('fran-connectors')?.close();if(!dialog.open){log().innerHTML='';clearTurn();dialog.showModal()}
setPhase('Fill your Wallet · '+readyCount()+' of 6 saved');renderWallet();metric('journey_resumed',{trigger,ready:readyCount()})
const last=store().last
if(await returned())return true
if(last&&saved(last))await say('<strong>✓ '+E(SLOTS[last].name)+' is saved.</strong> '+(readyCount()<6?'Nice. On to the next one.':'That was the last one.'))
else if(last&&store().slots?.[last]==='started')await say(trigger==='return'?'Welcome back. '+E(SLOTS[last].name)+' isn’t showing as saved yet. If you finished on the provider’s screen it can take a moment; otherwise we can try another way.':'Welcome back. '+E(SLOTS[last].name)+' isn’t showing as saved yet. Want to finish it, or move on?')
else{await say('Welcome back to <strong>'+E(loc.wallet.name)+'</strong>'+(loc.wallet.brand?' ('+E(loc.wallet.brand)+(loc.wallet.state?' · '+E(loc.wallet.state):'')+')':'')+'. '+(readyCount()?readyCount()+' of 6 parts are saved.':'Nothing is saved yet.')+' Where do you want to start?')
 const open=order().filter(x=>!saved(x)),first=nextSlot()||open[0]
 if(open.length>1){const pick=await ask({choices:open.map(x=>({label:SLOTS[x].name,sub:x===first?'Recommended: '+WHY[stage()==='preopening'?'preopening':'operating'][x]:LABEL[status(x)],value:x,primary:x===first,icon:x})),skip:{label:'Not now',value:''}});if(!pick){dialog.close();return true}await runSlots(pick);return true}}
await runSlots(last&&store().slots?.[last]==='started'&&!saved(last)?last:null);return true}
async function runSlots(retry){if(stage()==='operating'&&!store().gathered&&!retry){await gather();await vendors()}
let s=retry||nextSlot()
while(s){stepKey=s;save({current:s});renderWallet();let r;do{r=await slot(s)}while(r==='back');if(r==='left')return;s=nextSlot(s)||nextSlot()}
stepKey=null;renderWallet();if(!store().plan_asked)await planStep();await people();await finish()}
function leave(slot,status,fn){mark(slot,status);save({last:slot});window.FRAN_HUB?.quiet?.(SLOTS[slot].hub,8000);metric('journey_handoff',{slot,status});dialog.close();setTimeout(fn,60);return 'left'}
const help=service=>()=>dispatchEvent(new CustomEvent('fran:service-profile',{detail:{service}}))
const formationGuide=()=>{window.switchTab?.('entity');setTimeout(()=>{document.querySelector('#fw-entity [data-workspace=entity]')?.click();document.querySelector('.formation-concierge')?.scrollIntoView({block:'start'})},150)}
async function laterOrNext(s,reason){mark(s,'later');renderWallet();await say('No problem. I’ll keep '+E(SLOTS[s].noun)+' on your list'+(reason?' '+reason:'')+'.');return 'next'}
const sleep=ms=>new Promise(r=>setTimeout(r,ms))

/* Upload inside the conversation: same signed-upload endpoints as Data rooms, explicit consent first. */
function filePicker(label,{multiple=false,types=null}={}){return new Promise(resolve=>{const t=turn(),name=loc.wallet.name
 t.innerHTML='<form class="fj-drop"><label class="fj-dropzone"><input type="file"'+(multiple?' multiple':'')+' accept=".pdf,.png,.jpg,.jpeg,.heic,.csv,.xlsx,.xls,.txt,.doc,.docx,.pptx,.dwg"><span class="fj-ci">'+svg('upload')+'</span><strong>'+E(label)+'</strong><small>'+(multiple?'Drop them all here or choose files · PDFs, spreadsheets, photos, plans · up to 25 MB each':'Drop it here or choose a file · PDF, photo, spreadsheet or text · up to 25 MB')+'</small><em data-file></em></label>'+(types?'<fieldset class="fj-doctype"><legend>What is this document?</legend>'+types.map(([v,l])=>'<label><input type="radio" name="fj-doctype" value="'+E(v)+'"> '+E(l)+'</label>').join('')+'</fieldset>':'')+'<label class="fj-consent"><input type="checkbox"> Store it privately with '+E(name)+' and let Fran read it. Nothing is shared.</label><div class="fj-drop-actions"><button type="submit" class="fj-go" disabled>Upload</button><button type="button" class="fj-skip" data-back>Choose another way</button></div><p class="fj-err" role="alert"></p></form>'
 const f=t.querySelector('form'),input=f.querySelector('input[type=file]'),consent=f.querySelector('.fj-consent input'),go=f.querySelector('.fj-go'),zone=f.querySelector('.fj-dropzone'),err=f.querySelector('.fj-err')
 let file=null;const kind=()=>f.querySelector('[name=fj-doctype]:checked')?.value||'',sync=()=>{go.disabled=!(file&&consent.checked&&(!types||kind()))}
 f.querySelectorAll('[name=fj-doctype]').forEach(r=>r.onchange=sync)
 const take=list=>{err.textContent='';const all=[...(list||[])];if(!all.length)return;const big=all.filter(x=>x.size>25*1024*1024),ok=all.filter(x=>x.size<=25*1024*1024);if(big.length)err.textContent=big.map(x=>x.name).join(', ')+(big.length===1?' is':' are')+' over 25 MB and will be skipped.';if(!ok.length){file=null;sync();return}file=multiple?ok:ok[0];f.querySelector('[data-file]').textContent=multiple?ok.length+' file'+(ok.length===1?'':'s')+': '+ok.map(x=>x.name).join(', '):ok[0].name;zone.classList.add('has-file');sync()}
 input.onchange=()=>take(input.files);consent.onchange=sync
 zone.ondragover=e=>{e.preventDefault();zone.classList.add('over')};zone.ondragleave=()=>zone.classList.remove('over');zone.ondrop=e=>{e.preventDefault();zone.classList.remove('over');take(multiple?e.dataTransfer.files:[e.dataTransfer.files[0]])}
 f.onsubmit=e=>{e.preventDefault();if(file&&consent.checked&&(!types||kind())){if(types)file.fjType=kind();clearTurn();resolve(file)}}
 f.querySelector('[data-back]').onclick=()=>{clearTurn();resolve(null)}
 if(driveOn()){const b=document.createElement('button');b.type='button';b.className='fj-drive';b.innerHTML=svg('upload')+'<span>Choose from Google Drive</span>';zone.after(b);b.onclick=async()=>{if(types&&!kind()){err.textContent='Choose what kind of document this is first.';f.querySelector('[name=fj-doctype]')?.focus();return}if(!consent.checked){err.textContent='Check the box below first so Fran can save private copies.';consent.focus();return}const picked=kind();clearTurn();const got=await fromDrive();if(!got){resolve(await filePicker(label,{multiple}));return}if(!multiple&&got.length>1)await say('I’ll use '+E(got[0].name)+' for this step.');if(types&&got[0])got[0].fjType=picked;resolve(multiple?got:got[0])}}
 requestAnimationFrame(()=>input.focus({preventScroll:true}));scroll()})}
/* Google's picker opens on the page, under this dialog; step out of the dialog while it's open, then come back. */
let driving=false
const driveOn=()=>!!window.FRAN_DRIVE?.enabled?.(life?.drive)
async function fromDrive(){driving=true;try{window.FRAN_DRIVE.preload().catch(()=>{})}catch(_){}dialog.close();let r=null,err=null
 try{r=await window.FRAN_DRIVE.pick(life.drive,{onStatus:t=>{if(!dialog.open)dialog.showModal();progress(t)}})}catch(e){err=e}
 if(!dialog.open)dialog.showModal();driving=false;clearTurn()
 if(err){await say('Google Drive didn’t finish: '+E(err.message)+' You can try again, or download the files and drop them here.');return null}
 if(!r){await say('No files chosen from Drive.');return null}
 if(r.folderEmpty&&!r.files.length){await say('I couldn’t see inside that folder. In the picker, open the folder and select the files themselves.');return null}
 if(r.skipped.length)await say('I couldn’t copy '+r.skipped.length+' file'+(r.skipped.length===1?'':'s')+': '+r.skipped.map(x=>E(x.name)+' ('+E(x.reason)+')').join(', ')+'.')
 metric('journey_drive_picked',{files:r.files.length,skipped:r.skipped.length});return r.files.length?r.files:null}
function progress(text){turn().innerHTML='<p class="fj-progress" role="status"><span class="fj-spin" aria-hidden="true"></span>'+E(text)+'</p>';scroll()}
async function uploadFlow(s,category,label,hint,{track=true,types=null}={}){for(;;){const file=await filePicker(label,{types});if(!file)return 'back'
 const reading=hint&&window.FranDetails?window.FranDetails.readFile(file,hint):null
 progress('Saving '+file.name+' privately…')
 try{const signed=await api('location','upload_url',{name:file.name,size:file.size,category});const {error}=await sb.storage.from('location-docs').uploadToSignedUrl(signed.path,signed.token,file,{contentType:file.type||'application/octet-stream'});if(error)throw Error(error.message);await api('location','finish_upload',{...signed,name:file.name,category})}
 catch(e){clearTurn();await say('That upload didn’t finish ('+E(e.message)+'). Nothing was saved. Let’s try again.');continue}
 you('Uploaded '+file.name+(file.fjType?' ('+(LEASE_TYPES.find(x=>x[0]===file.fjType)||[,''])[1].toLowerCase()+')':''));if(track){mark(s,'started');save({last:s})}
 if(s==='lease'&&file.fjType){save({lease_doc:{name:String(file.name).slice(0,200),type:file.fjType}});renderWallet()}window.FRAN_HUB?.quiet?.(SLOTS[s].hub,5000);metric('journey_inline',{slot:s,action:'upload',hint:hint||''})
 const r=reading?await reading:null
 if(r&&r.kind&&r.found>=2)await details(s,file,r);else await reward(s,file.name)
 if(s==='lease'&&file.fjType&&!saved('lease'))await say('It’s saved privately with '+E(loc.wallet.name)+'. Lease turns to Saved when you add the signed lease or a signed LOI, or confirm the lease terms.')
 return 'next'}}
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
async function inviteFlow(s,scope,who){await say('What’s your '+E(who)+'’s email? They’ll be able to '+E(CAN[scope])+' for '+E(loc.wallet.name)+' only, and can’t see your other files, balances or shared rooms. You’ll see the email before anything is sent.')
 for(;;){const email=(await ask({input:{type:'email',placeholder:'name@firm.com',button:'Preview the invite'},skip:{label:'Choose another way',value:''}})).toLowerCase();if(!email)return 'back'
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){await say('That doesn’t look like an email address. Try again?');continue}
  progress('Creating the invite…')
  try{const d=await api('contributors','create',{scope,email});clearTurn();mark(s,'invited');save({last:s});metric('journey_inline',{slot:s,action:'invite'})
   if(window.FRAN_INVITE){const how=await window.FRAN_INVITE.open({call:(a,b)=>api('contributors',a,b),grantId:d.grant.id,url:d.url,email,scope,location:loc.wallet.name,who})
    await say(how==='sent'?'<strong>✓ Invitation sent to '+E(email)+'.</strong> It comes from Fran Wallet on your behalf, and replies go to you. I’ll show it here when they’ve added their part.':how==='copied'?'Message copied. Paste it into a text to '+E(email)+'. The link works for 30 days.':how==='mailto'?'Your email app has the invitation ready to send to '+E(email)+'.':'The invite for <strong>'+E(email)+'</strong> is saved. Send it anytime from '+E(SLOTS[s].name)+'.')
    if(how==='none'){const c=await ask({choices:[{label:'Send it now',value:'again',primary:true},{label:'Continue',value:'go'}]});if(c==='again'){const h2=await window.FRAN_INVITE.open({call:(a,b)=>api('contributors',a,b),grantId:d.grant.id,url:d.url,email,scope,location:loc.wallet.name,who});if(h2==='sent')await say('<strong>✓ Invitation sent to '+E(email)+'.</strong>')}}
    renderWallet();return 'next'}
   await say('Your invite for <strong>'+E(email)+'</strong> is ready. It lasts 30 days. Copy it and send it however you like.');await linkTurn(d.url);renderWallet();return 'next'}
  catch(e){clearTurn();await say('I couldn’t create that invite ('+E(e.message)+').')}}}
/* Provider authorization stays on the provider’s screen; say exactly what happens first. */
const PROVIDER={qbo:['QuickBooks','accounting reports and company details you authorize','create, edit or pay anything'],bank:['Plaid','only the accounts, balances and activity you approve','move money or see your bank login'],payroll:['Gusto','payroll summaries and labor totals','run or change payroll']}
async function connectFlow(s,connector){if(connector==='qbo'&&typeof window.qboCall==='function')return qboFlow(s);const [p,reads,cant]=PROVIDER[connector]
 await say('You’ll approve read-only access on '+E(p)+'’s own screen. Fran can read '+E(reads)+'; it can’t '+E(cant)+'. When you’re done, I’ll pick up right here.')
 const c=await ask({choices:[{label:'Continue to '+p,value:'go',primary:true},{label:'Choose another way',value:'back'}]});if(c!=='go')return 'back'
 save({awaiting:s});return leave(s,'started',()=>actions()?.run?.(connector))}

const QBO_RESULT={
 inuse:'That QuickBooks company is already connected under a different Fran Wallet login, so I didn’t move it. Sign in with that login to manage it, or connect a different company here.',
 moved:'QuickBooks is connected here. That company was attached to another of your locations before; it now belongs to this one.',
 error:'QuickBooks didn’t finish connecting. Nothing changed. You can try again.',
 closed:'The QuickBooks window closed before it finished. Nothing changed.'}
function qboButton(){return new Promise(resolve=>{const t=turn();t.innerHTML='<div class="fj-choices"><button type="button" class="fj-choice primary" data-go><span class="fj-ci">'+svg('accounting')+'</span><span><strong>Continue to QuickBooks</strong><small>Opens Intuit’s sign-in in a small window</small></span></button><button type="button" class="fj-choice" data-back><span><strong>Choose another way</strong></span></button></div>'
 /* The window opens inside the click itself so browsers don't block it. */
 t.querySelector('[data-go]').onclick=()=>{const pop=window.open('about:blank','fran_oauth','width=560,height=720');if(pop)try{pop.document.title='QuickBooks · Fran Wallet';pop.document.body.innerHTML='<p style="font:16px system-ui;color:#173b32;padding:32px">Opening QuickBooks…</p>'}catch(_){}you('Continue to QuickBooks');clearTurn();resolve({pop})}
 t.querySelector('[data-back]').onclick=()=>{clearTurn();resolve(null)};requestAnimationFrame(()=>t.querySelector('[data-go]').focus({preventScroll:true}));scroll()})}
function oauthResult(pop){return new Promise(resolve=>{let done=false;const finish=r=>{if(done)return;done=true;removeEventListener('message',on);clearInterval(timer);resolve(r)}
 const on=e=>{if(e.origin===location.origin&&e.data?.type==='fran-oauth'&&e.data.provider==='qbo')finish(e.data.result||'error')}
 addEventListener('message',on);const timer=setInterval(()=>{if(pop.closed)setTimeout(()=>finish('closed'),600)},500)})}
async function confirmBooks(){progress('QuickBooks is connected. Pulling your books…');for(let i=0;i<12&&!saved('accounting');i++){try{await window.refreshLocation?.(true)}catch(_){}if(!saved('accounting'))await sleep(1200)}try{window.renderQbo?.();window.renderOverview?.()}catch(_){}clearTurn();return saved('accounting')}
async function qboFlow(s){await say('You’ll approve read-only access on QuickBooks’ own screen, in a small window. Fran can read '+E(PROVIDER.qbo[1])+'; it can’t '+E(PROVIDER.qbo[2])+'. I’ll wait right here.')
 for(;;){const go=await qboButton();if(!go)return 'back';let url
  try{url=(await window.qboCall({action:'start'})).authorize_url}catch(e){go.pop?.close();await say('QuickBooks isn’t available right now ('+E(e.message)+'). You can upload a P&L instead and connect later.');const c=await ask({choices:[{label:'Upload a P&L',value:'up',primary:true,icon:'upload'},{label:'Choose another way',value:'back'}]});return c==='up'?uploadFlow(s,'Financial statements','Upload a recent P&L'):'back'}
  metric('journey_qbo_started',{popup:!!go.pop})
  if(!go.pop){save({awaiting:s,last:s});mark(s,'started');try{sessionStorage.setItem('fran_journey_return','accounting')}catch(_){}location.href=url;return 'left'}
  go.pop.location.href=url;mark(s,'started');save({last:s})
  turn().innerHTML='<p class="fj-progress" role="status"><span class="fj-spin" aria-hidden="true"></span>Waiting for QuickBooks. Finish in the window that opened.</p><button type="button" class="fj-skip" data-cancel>Cancel</button>';turn().querySelector('[data-cancel]').onclick=()=>{try{go.pop.close()}catch(_){}};scroll()
  const r=await oauthResult(go.pop);clearTurn();metric('journey_qbo_result',{result:r})
  if(r==='connected'||r==='moved'){if(r==='moved')await say(QBO_RESULT.moved);if(await confirmBooks()){await say('<strong>✓ Books saved.</strong> QuickBooks is connected to '+E(loc.wallet.name)+'.');renderWallet();return 'next'}
   await say('QuickBooks connected, and your books are still loading. I’ll keep going; they’ll appear on Accounting shortly.');return 'next'}
  await say(QBO_RESULT[r]||QBO_RESULT.error)
  const c=await ask({choices:[{label:r==='inuse'?'Connect a different company':'Try again',value:'again',primary:true,icon:'accounting'},{label:'Invite my accountant',sub:'They connect it for you',value:'inv',icon:'people',tag:'Free'},{label:'Upload a P&L instead',value:'up',icon:'upload'}],skip:{label:'Later',value:'later'}})
  if(c==='inv')return inviteFlow(s,'accounting','accountant or bookkeeper');if(c==='up')return uploadFlow(s,'Financial statements','Upload a recent P&L');if(c==='later')return laterOrNext(s)}}
/* Back from a same-tab redirect (popup blocked): say what happened, then carry on. */
async function returned(){const q=new URLSearchParams(location.search),r=q.get('qbo');let flag='';try{flag=sessionStorage.getItem('fran_journey_return')||'';sessionStorage.removeItem('fran_journey_return')}catch(_){}
 if(!r||flag!=='accounting')return false;history.replaceState(null,'',location.pathname+location.hash)
 if((r==='connected'||r==='moved')&&await confirmBooks()){await say('<strong>✓ Books saved.</strong> QuickBooks is connected to '+E(loc.wallet.name)+'. On to the next one.');await runSlots(nextSlot('accounting')||nextSlot());return true}
 await say(QBO_RESULT[r]||QBO_RESULT.error);await runSlots('accounting');return true}
async function slot(s){const n=loc.wallet.name,st=loc.wallet.state||'your state',pre=stage()==='preopening',payrollManual=actions()?.connectorHealth?.('payroll')?.state==='manual'
const head=(t,why)=>say('<span class="fj-step">'+svg(s)+E(SLOTS[s].name)+'</span>'+t+(why?'<small class="fj-why">'+E(why)+'</small>':''))
const W=WHY[pre?'preopening':'operating'][s]
if(s==='entity'){
 /* "Not sure" gets one clarifying question first: papers in hand, or help working it out. */
 if(store().formed==='unsure'&&!saved('entity')&&store().slots?.entity!=='diy'){await head('You weren’t sure whether the company behind '+E(n)+' has been formed. That’s common. Do you have papers like articles of organization, an operating agreement or an EIN letter?',W)
  const c=await ask({choices:[{label:'I have documents',sub:'Upload them and I’ll read the legal name, EIN, state and owners',value:'up',primary:true,icon:'upload'},{label:'Guide me through formation',sub:'Prepare my brief and work out what’s still undecided',value:'guide',icon:'entity'},{label:'Ask my attorney',sub:'Invite them to add the documents, free',value:'att',icon:'people',tag:'Free'}],skip:{label:'Later',value:'later'}})
  if(c==='up'){const r=await uploadFlow(s,'Other','Upload your articles, operating agreement or EIN letter','entity');if(r!=='back')return r;return 'back'}
  if(c==='guide')return leave(s,'started',formationGuide)
  if(c==='att')return inviteFlow(s,'entity','attorney')
  return laterOrNext(s,'until you know more')}
 if(store().formed==='no'&&!saved('entity')&&store().slots?.entity!=='diy'){await head('Let’s prepare the business that will own your location. You don’t have to choose a legal structure alone.',W)
  const c=await ask({choices:[{label:'Guide me through formation',sub:'Prepare my brief, clarify decisions and choose support',value:'guide',primary:true,icon:'entity'},{label:'Explore forming it with CoverPanda',sub:'See provider scope and pricing. Nothing is requested or purchased yet.',value:'cp',icon:'entity'},{label:'I’ll do it myself',sub:'I’ll give you the three steps',value:'diy'},{label:'My attorney is handling it',sub:'Invite them to add the documents, free',value:'att',icon:'people',tag:'Free'}],skip:{label:'Later',value:'later'}})
  if(c==='guide')return leave(s,'started',formationGuide);
  if(c==='cp')return leave(s,'exploring',help('entity'))
  if(c==='att')return inviteFlow(s,'entity','attorney')
  if(c==='diy'){mark(s,'diy');await say('Here’s the short version:<ol class="fj-plan"><li><strong>Prepare your filing with your provider</strong><span>Confirm structure, formation state, owners, registered agent and any legal review before filing.</span></li><li><strong>Get your EIN</strong><span>Confirm eligibility and the current application process directly with the IRS; save its official confirmation.</span></li><li><strong>Bring them here</strong><span>Upload them and I’ll read the details.</span></li></ol>');const d=await ask({choices:[{label:'I have them now',value:'up',primary:true,icon:'upload'},{label:'Continue setup',value:'next'}]});if(d==='up'){const r=await uploadFlow(s,'Other','Upload your articles, operating agreement or EIN letter','entity');if(r!=='back')return r}return 'next'}
  return laterOrNext(s,'for when it’s formed')}
 await head(saved('entity')?'Your company name is saved. Add the formation papers or EIN letter and I’ll fill in the EIN, state and owners.':'Let’s add the company behind '+E(n)+'.',W)
 const c=await ask({choices:[{label:'Upload formation documents',sub:'I’ll read the legal name, EIN, state and owners',value:'up',primary:true,icon:'upload'},{label:'Type the details',sub:'Legal name, EIN and owners',value:'type'},{label:'Invite my attorney',sub:'They add it for you',value:'att',icon:'people',tag:'Free'}],skip:{label:saved('entity')?'Good for now':'Later',value:'later'}})
 if(c==='up')return uploadFlow(s,'Other','Upload your articles, operating agreement or EIN letter','entity');if(c==='type')return leave(s,'started',()=>{window.switchTab?.('entity');setTimeout(()=>{const f=$('life-entity-form');f?.scrollIntoView({block:'start'});f?.querySelector('input,select')?.focus()},150)});if(c==='att')return inviteFlow(s,'entity','attorney')
 if(saved('entity')){mark(s,'later');return 'next'}return laterOrNext(s)}
if(s==='lease'){await head('Where are you on the lease for '+E(n)+'?',W)
 const c=await ask({choices:[{label:'It’s signed',sub:'I’ll read the landlord, dates, base rent and CAM',value:'signed',primary:true,icon:'upload'},{label:'Still negotiating',sub:'Upload the LOI or draft',value:'loi'},...(pre?[{label:'Still looking for a site',value:'site'}]:[])],skip:{label:'Later',value:'later'}})
 if(c==='signed')return uploadFlow(s,'Lease','Upload your signed lease','lease',{types:LEASE_TYPES});if(c==='loi')return uploadFlow(s,'Lease','Upload the LOI or draft lease','lease',{types:LEASE_TYPES})
 return laterOrNext(s,c==='site'?'for when you have a site':'')}
if(s==='banking'){const r=await bankStep();if(r==='next'&&!store().loan_asked&&!(life?.records||[]).some(x=>x.kind==='loan'))await loans();return r}
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
 if(c==='no'){await say('You’ll need your formation documents and EIN to open one.'+(saved('entity')?'':' That’s why the company comes first.'));const d=await ask({choices:[{label:'Help me choose a bank',sub:'Prepares an editable request for you to review and send. Nothing is applied for.',value:'help',primary:true},{label:'I’ll open one myself',value:'diy'}]});if(d==='help')return leave(s,'drafted',()=>journeyApi()?.draft?.('bank'));mark(s,'diy');return 'next'}
 return laterOrNext(s)}}
async function slotRest(s){const n=loc.wallet.name,st=loc.wallet.state||'your state',pre=stage()==='preopening',payrollManual=actions()?.connectorHealth?.('payroll')?.state==='manual'
const head=(t,why)=>say('<span class="fj-step">'+svg(s)+E(SLOTS[s].name)+'</span>'+t+(why?'<small class="fj-why">'+E(why)+'</small>':''))
const W=WHY[pre?'preopening':'operating'][s]
if(s==='accounting'){const qboLive=window.FRAN_HUB?.qboLive?.()!==false;await head('Who keeps the books for '+E(n)+'?',W)
 const c=await ask({choices:[{label:'I use QuickBooks',sub:qboLive?'Connect it in about a minute':'Upload a P&L from QuickBooks for now',value:'qbo',primary:true,icon:'accounting'},{label:'My accountant or bookkeeper',sub:'Invite them to connect it for you',value:'inv',icon:'people',tag:'Free'},{label:'No one yet',sub:'See CoverPanda bookkeeping or other options',value:'none'},{label:'Spreadsheets or other software',sub:'Upload a recent P&L',value:'up'}],skip:{label:'Later',value:'later'}})
 if(c==='qbo')return qboLive?connectFlow(s,'qbo'):uploadFlow(s,'Financial statements','Upload a recent P&L from QuickBooks')
 if(c==='inv')return inviteFlow(s,'accounting','accountant or bookkeeper');if(c==='up')return uploadFlow(s,'Financial statements','Upload a recent P&L')
 if(c==='none')return leave(s,'exploring',help('books'));return laterOrNext(s)}
if(s==='payroll'){await head(pre?'Will you have employees on payroll soon?':'How do you run payroll today?',W)
 const c=await ask({choices:[{label:'Gusto',sub:payrollManual?'Import a Gusto report now. Live connection isn’t enabled yet.':'Connect it, read-only',value:'gusto',primary:true,icon:'payroll'},{label:'Another provider',sub:'ADP, Paychex, Square, Toast…',value:'other'},{label:pre?'Not yet. Help me set it up':'I need a payroll provider',sub:'See CoverPanda payroll options',value:'help'}],skip:{label:pre?'Later, before my first hire':'Later',value:'later'}})
 if(c==='gusto')return payrollManual?leave(s,'started',()=>actions()?.alternative?.('payroll')):connectFlow(s,'payroll')
 if(c==='other'){const d=await ask({choices:[{label:'Import a payroll report',sub:'Opens the payroll import, which reads pay periods and totals',value:'imp',primary:true},{label:'Invite my payroll provider',sub:'They add reports for you',value:'inv',icon:'people',tag:'Free'},{label:'Back',value:'back'}]});if(d==='imp')return leave(s,'started',()=>actions()?.alternative?.('payroll'));if(d==='inv')return inviteFlow(s,'payroll','payroll provider');return 'back'}
 if(c==='help')return leave(s,'exploring',help('payroll'));return laterOrNext(s,pre?'for before your first hire':'')}
if(s==='insurance'){await head('Is '+E(n)+' insured yet?',W)
 const c=await ask({choices:[{label:'Yes, I have a policy',sub:'Upload the declarations page; I’ll read limits and dates',value:'up',primary:true,icon:'upload'},{label:'My agent has it',sub:'Invite them to add policies',value:'inv',icon:'people',tag:'Free'},{label:'Not yet',sub:'Get coverage options from CoverPanda',value:'help'}],skip:{label:'Later',value:'later'}})
 if(c==='up')return uploadFlow(s,'Legal & insurance','Upload your policy or declarations page');if(c==='inv')return inviteFlow(s,'insurance','insurance agent');if(c==='help')return leave(s,'exploring',help('insurance'))
 return laterOrNext(s)}
return 'next'}

/* ---------- Journey 2: an operating owner brings everything in at once ---------- */
const PILE_ICON={lease:'lease',loan:'banking',entity:'entity',insurance:'insurance',franchise:'entity',financials:'accounting',payroll:'payroll',buildout:'lease',plans:'lease',business_plan:'accounting',projections:'accounting',other:'upload'}
let planDocs=[]
async function gather(){save({gathered:true});const drive=driveOn();if(drive)window.FRAN_DRIVE.preload().catch(()=>{})
 await say('<span class="fj-step">'+svg('upload')+'What you already have</span>Let’s bring in what you already have, all at once: lease, loan papers, company documents, insurance, financial statements, build-out contracts, plans, projections. I’ll sort everything and pull out the key details.<small class="fj-why">Each file is stored privately with '+E(loc.wallet.name)+'. Nothing is shared.</small>')
 for(;;){const c=await ask({choices:[{label:'Add a batch of files',sub:'Drop a whole folder’s worth. I’ll sort it.',value:'batch',primary:true,icon:'upload'},{label:'Connect Google Drive',sub:drive?'Pick files from Drive. Private copies are kept here.':'Coming soon. For now, download the folder from Drive and drop it here.',value:'drive',tag:drive?'':'Soon'},{label:'I’ll go one at a time',value:'one'}]})
  if(c==='one')return
  if(c==='drive'&&!drive){await say('Google Drive sign-in isn’t switched on yet. In Drive, select your folder and choose Download, then drop the files here. I’ll sort them the same way.');continue}
  if(c==='drive'){if(!driveOn()){await say('Google Drive isn’t available right now. Download the folder from Drive and drop the files here instead.');continue}await say('Google will ask you to sign in and pick files or a folder. Fran only gets the files you pick, and saves private copies to '+E(loc.wallet.name)+'.');const got=await fromDrive();if(!got)continue;await batch(got);return}
  const files=await filePicker('Add your documents',{multiple:true});if(!files)continue;await batch(files);return}}
async function batch(files){you('Added '+files.length+' file'+(files.length===1?'':'s'))
 const t=turn();t.innerHTML='<ul class="fj-inbox" aria-live="polite">'+files.map((f,i)=>'<li data-i="'+i+'"><span class="fj-ci">'+svg('upload')+'</span><span class="fj-inbox-name">'+E(f.name)+'</span><em>Reading…</em></li>').join('')+'</ul>';scroll()
 const results=[]
 for(let i=0;i<files.length;i++){const f=files[i],row=t.querySelector('[data-i="'+i+'"]');let text='',read={kind:null,found:0}
  try{text=await window.FranExtract.textOf(f)}catch(_){text=''}const sorted=window.FranExtract.classify(text,f.name)
  if(sorted.details&&text.trim().length>40)read=window.FranExtract.read(text,f.name,sorted.type)
  row.querySelector('.fj-ci').innerHTML=svg(PILE_ICON[sorted.type]);row.querySelector('em').textContent=sorted.label+' · saving…'
  try{const signed=await api('location','upload_url',{name:f.name,size:f.size,category:sorted.category});const {error}=await sb.storage.from('location-docs').uploadToSignedUrl(signed.path,signed.token,f,{contentType:f.type||'application/octet-stream'});if(error)throw Error(error.message);await api('location','finish_upload',{...signed,name:f.name,category:sorted.category})
   row.querySelector('em').textContent=sorted.label+(read.found>=2?' · details found':' · saved');row.dataset.state=read.found>=2?'found':'saved';results.push({file:f,sorted,read})}
  catch(e){row.querySelector('em').textContent='Didn’t save: '+e.message;row.dataset.state='failed'}}
 try{await window.refreshLocation?.(true)}catch(_){}
 const piles={};for(const r of results)(piles[r.sorted.label]=piles[r.sorted.label]||[]).push(r)
 const found=results.filter(r=>r.read.found>=2)
 planDocs=results.filter(r=>['business_plan','projections'].includes(r.sorted.type)).map(r=>({id:findDoc(r.file.name)?.id||'',name:r.file.name,kind:r.sorted.type}))
 for(const r of results){const slot={lease:'lease',entity:'entity',insurance:'insurance',financials:'accounting',payroll:'payroll'}[r.sorted.type];if(slot&&!saved(slot)&&!store().slots?.[slot])mark(slot,'started')}
 metric('journey_batch',{files:files.length,saved:results.length,found:found.length})
 await say('I sorted '+results.length+' of '+files.length+' file'+(files.length===1?'':'s')+':<ul class="fj-piles">'+Object.entries(piles).map(([k,v])=>'<li><strong>'+v.length+'</strong> '+E(k)+'</li>').join('')+'</ul>'+(found.length?'I found details in '+found.length+'. Let’s check them one at a time.':'Everything is saved privately in Data rooms.'))
 for(const r of found){const docId=findDoc(r.file.name)?.id||'',slot={lease:'lease',entity:'entity',loan:'banking'}[r.read.kind]
  await say('<span class="fj-step">'+svg(PILE_ICON[r.read.kind])+E(r.sorted.label)+'</span>Here’s what I found in <strong>'+E(r.file.name)+'</strong>.')
  const saved_=await window.FranDetails.review(turn(),r.read.kind,r.read.fields,{fileName:r.file.name,docId});clearTurn();renderWallet()
  if(!saved_){await say('Skipped. It’s still saved; you can add the details later.');continue}
  await say('<strong>✓ Saved.</strong> '+window.FranDetails.summary(saved_))
  if(saved_.kind==='entity'&&(saved_.owners||[]).length>1){await say('The papers name '+saved_.owners.length+' owners. Invite the others?');await window.FranDetails.inviteOwners(turn(),saved_.owners);clearTurn()}
  if(slot&&slot!=='banking')renderHome()}
 if(planDocs.length)await say('I’ll link '+planDocs.map(d=>'<strong>'+E(d.name)+'</strong>').join(', ')+' to your business plan.')}
/* Multiplayer: the people who already do the work connect their part. Free. */
const VENDORS=[['accounting','accountant or bookkeeper','My accountant or bookkeeper','They connect QuickBooks and add reports'],['payroll','payroll provider','My payroll provider','They add payroll reports'],['insurance','insurance agent','My insurance agent','They add policies and certificates'],['entity','attorney','My attorney or entity service','They add company documents']]
async function vendors(){if(store().vendors_asked)return;save({vendors_asked:true})
 const open=VENDORS.filter(([scope])=>{const slot={accounting:'accounting',payroll:'payroll',insurance:'insurance',entity:'entity'}[scope];return !saved(slot)&&!['invited','requested'].includes(status(slot))});if(!open.length)return
 await say('<span class="fj-step">'+svg('people')+'Who already helps you</span>Who already helps you run '+E(loc.wallet.name)+'? Invite them and they’ll connect their part for you.<small class="fj-why">Free. Each invite works for one email and this location only. You’ll see each email before it’s sent.</small>')
 const picked=await new Promise(resolve=>{const t=turn();t.innerHTML='<div class="fj-multi" role="group" aria-label="Who helps you">'+open.map(([scope,,label,sub])=>'<label class="fj-choice"><input type="checkbox" value="'+scope+'"><span><strong>'+E(label)+'</strong><small>'+E(sub)+'</small></span><em>Free</em></label>').join('')+'</div><div class="fj-drop-actions"><button type="button" class="fj-go" data-go>Invite them</button><button type="button" class="fj-skip" data-none>No one yet</button></div>'
  t.querySelector('[data-go]').onclick=()=>{const v=[...t.querySelectorAll('input:checked')].map(x=>x.value);clearTurn();resolve(v)};t.querySelector('[data-none]').onclick=()=>{clearTurn();resolve([])};scroll();requestAnimationFrame(()=>t.querySelector('input')?.focus({preventScroll:true}))})
 if(!picked.length){you('No one yet');return}
 you(picked.map(sc=>VENDORS.find(v=>v[0]===sc)[2]).join(', '))
 for(const scope of picked){const [,who]=VENDORS.find(v=>v[0]===scope),slot={accounting:'accounting',payroll:'payroll',insurance:'insurance',entity:'entity'}[scope];stepKey=slot;renderWallet();await inviteFlow(slot,scope,who)}
 stepKey=null;renderWallet()}
/* The plan: start fresh or connect what exists, built from what the Wallet already knows. */
async function planStep(){save({plan_asked:true});const pre=stage()==='preopening',has=window.FranBizPlan?.saved?.()
 if(!window.FranBizPlan)return
 await say('<span class="fj-step">'+svg('accounting')+'Business plan</span>'+(has?'Your business plan is in the Wallet. Want to update it with what we just added?':pre?'Let’s put your opening plan on paper: what it costs to open, how you’ll fund it, and your first three years. It’s what a lender asks for.':'Do you have a business plan or projections? I’ll keep yours current against your real numbers every month.')+'<small class="fj-why">'+(pre?'Built from your lease, loan and what you tell me. Editable anytime.':'It starts from your actual results when QuickBooks is connected.')+'</small>')
 const c=await ask({choices:[{label:has?'Update my plan':pre?'Build my opening plan':'Build it with Fran',sub:pre?'Costs, funding and projections in a few minutes':'Start from your current numbers',value:'fresh',primary:true,icon:'accounting'},...(has?[]:[{label:'I have one already',sub:planDocs.length?'Link '+planDocs.map(d=>d.name).join(', '):'Upload your plan or projections',value:'existing',icon:'upload'}])],skip:{label:'Later',value:'later'}})
 if(c==='later'){await say('No problem. Your business plan is in the sidebar whenever you’re ready.');return}
 if(c==='existing'&&!planDocs.length){const r=await uploadFlow('accounting','Other','Upload your business plan or projections',null,{track:false});if(r==='back')return planStep();const d=(loc?.records||[]).filter(x=>x.kind==='document').sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0];if(d)planDocs=[{id:d.id,name:d.data?.name||'Plan',kind:/project|forecast|pro ?forma|\.xlsx?$|\.csv$/i.test(d.data?.name||'')?'projections':'business_plan'}]}
 if(c==='existing')await say('Linked. Now the few numbers that drive your projections, so I can track plan versus actual.')
 const plan=await window.FranBizPlan.quickStart(turn(),{stage:pre?'preopening':'operating',documents:planDocs});clearTurn()
 if(!plan){await say('No problem. Your business plan is in the sidebar whenever you’re ready.');return}
 metric('journey_plan',{stage:stage(),mode:c,docs:planDocs.length})
 await say('<strong>✓ Your plan is saved.</strong> Here’s the first look:'+window.FranBizPlan.brief(plan)+'<small class="fj-why">Calculated from your assumptions'+(Object.keys(plan.assumptions?.sources||{}).some(k=>!/^Starting/.test(plan.assumptions.sources[k]))?' and your Wallet records':'')+'. Open the full plan to add your story, adjust costs, and print a lender summary.</small>')}

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

/* ---------- no floating pill ----------
   Setup progress lives in one calm card on Home (below). Nothing floats over working pages and nothing opens on its own. */
function showPill(){const p=$('fran-journey-pill');if(p)p.hidden=true}

/* ---------- Home: a compact setup card ----------
   One line of progress, the next part with the action that completes it, and everything else on request.
   For the lease, both ways to add the signed copy sit side by side. */
const hub=()=>window.FRAN_HUB
/* The path for a new franchisee, mapped to the screens that already do each step. Done only when a record says so. */
const PATH=[
 {id:'plan',name:'Business plan',sub:'Projections your lender and franchisor can read.',done:()=>!!window.FranBizPlan?.saved?.(),go:()=>{window.switchTab?.('bizplan')}},
 {id:'owners',name:'Ownership team',sub:'Who owns what, recorded once.',done:()=>(life?.records||[]).some(r=>r.kind==='entity'&&(r.data?.owners||[]).length),go:()=>hub()?.openArea?.('company','path')},
 {id:'form',name:'Incorporate',sub:'Form the LLC, with formation help if you want it.',done:()=>saved('entity'),go:()=>hub()?.perform?.('company','help')},
 {id:'finance',name:'Finance stack',sub:'Bank account, expense cards and your loan application.',done:()=>saved('banking'),go:()=>hub()?.openArea?.('banking','path'),more:[['Expense cards',()=>journeyApi()?.market?.('bank')],['Loan application',()=>window.switchTab?.('debt')]]},
 {id:'insurance',name:'Insurance',sub:'Coverage your landlord and brand ask for.',done:()=>saved('insurance'),go:()=>hub()?.openArea?.('insurance','path')},
 {id:'books',name:'Accounting',sub:'QuickBooks from the first sale.',done:()=>saved('accounting'),go:()=>hub()?.openArea?.('books','path')},
 {id:'payroll',name:'Payroll',sub:'Ready before your first hire.',done:()=>saved('payroll'),go:()=>hub()?.openArea?.('payroll','path')}]
function nextActions(next){if(!next)return ''
 if(next==='lease')return '<div class="fj-home-pair" role="group" aria-label="Add your signed lease"><button type="button" class="fj-btn primary" data-fj-do="file">'+svg('upload')+'Upload the signed lease</button><button type="button" class="fj-btn" data-fj-do="drive"'+(driveOn()?'':' aria-describedby="fj-drive-off"')+'>'+svg('drive')+'Pick from Google Drive</button></div>'+(driveOn()?'':'<p class="fj-home-fine" id="fj-drive-off">Google Drive opens the same import used in Data rooms. If it isn’t switched on for your account yet, download the lease from Drive and upload it.</p>')
 return '<div class="fj-home-pair"><button type="button" class="fj-btn primary" data-fj-do="area">Set up '+E(next==='accounting'?'your books':SLOTS[next].noun)+'</button></div>'}
let homeOpen=false,wantHome=false,homeWatch=null
/* Home is redrawn by its own script; put the card back whenever a redraw drops it. */
function watchHome(dash){if(homeWatch)return;homeWatch=new MutationObserver(()=>{if(wantHome&&!$('fj-home'))requestAnimationFrame(()=>{if(wantHome&&!$('fj-home'))renderHome()})});homeWatch.observe(dash,{childList:true,subtree:true})}
function renderHome(){const dash=$('page-dashboard');let h=$('fj-home')
wantHome=!!(dash&&loc&&owned()&&profile());if(dash)watchHome(dash)
if(!wantHome){h?.remove();document.body.classList.remove('fj-home-on');return}
if(!h){h=document.createElement('section');h.id='fj-home';h.className='fj-home';h.setAttribute('aria-labelledby','fj-home-title')}
/* Right under the store's heading, so it reads as a small status line rather than a section to scroll to. */
const anchor=dash.querySelector('#wallet-home>.wallet-heading')||dash.querySelector('.main-hdr');if(anchor){if(anchor.nextElementSibling!==h)anchor.after(h)}else if(dash.firstElementChild!==h)dash.prepend(h)
const n=readyCount(),next=n<6?order().find(x=>!saved(x)&&due(x))||null:null,pre=stage()==='preopening',why=WHY[pre?'preopening':'operating']
document.body.classList.add('fj-home-on');h.dataset.complete=String(n===6)
const title=n===6?E(loc.wallet.name)+' is fully set up.':next?'Next: '+E(next==='accounting'?'your books':'your '+SLOTS[next].noun)+'.':'Pick up what’s left for '+E(loc.wallet.name)+'.'
/* With no next step, say exactly where each remaining part stands; never imply a request that wasn't sent. */
const rest=CANON.filter(x=>!saved(x)).map(status),count=k=>rest.filter(x=>x===k).length
const where=[[count('invited'),'invited'],[count('requested'),'with a help request you sent'],[count('exploring'),'exploring options'],[count('drafted'),'with a draft request to review'],[count('later')+count('diy')+count('started'),'on your list']].filter(([c])=>c).map(([c,t])=>c+' '+t)
const sub=n===6?'Every part is in. Fran flags anything that goes out of date.':next?why[next]:'Everything else has a path: '+where.join(', ')+'.'
const grid='<ol class="fj-home-grid">'+CANON.map(x=>{const st=status(x);return '<li data-state="'+st+'"'+(x===next?' data-next':'')+'><button type="button" data-fj-area="'+x+'"><span class="fj-slot-icon">'+svg(st==='saved'?'check':x)+'</span><span><strong>'+E(SLOTS[x].name)+'</strong><small>'+E(x===next&&st!=='saved'?'Up next':LABEL[st])+'</small></span></button></li>'}).join('')+'</ol>'
const path=pre?'<h3 class="fj-home-sub">Your path to opening</h3><ol class="fj-path">'+PATH.map((p,i)=>{const d=p.done();return '<li data-done="'+d+'"><span class="fj-path-n" aria-hidden="true">'+(d?svg('check'):i+1)+'</span><span class="fj-path-copy"><strong>'+E(p.name)+'</strong><small>'+E(d?'Saved':p.sub)+'</small>'+(p.more?'<span class="fj-path-more">'+p.more.map(([l],j)=>'<button type="button" class="fj-textbtn" data-fj-path-more="'+i+':'+j+'">'+E(l)+'</button>').join('')+'</span>':'')+'</span><button type="button" class="fj-btn small" data-fj-path="'+i+'" aria-label="'+E((d?'Review ':'Start ')+p.name)+'">'+(d?'Review':'Start')+'</button></li>'}).join('')+'</ol>':''
h.innerHTML='<div class="fj-home-row"><span class="fj-home-ring" style="--p:'+Math.round(n/6*100)+'" aria-hidden="true"><b>'+n+'</b>/6</span><div class="fj-home-copy"><small>Setup · '+n+' of 6 saved</small><h2 id="fj-home-title">'+title+'</h2><p>'+E(sub)+'</p></div>'+(n<6?'<button type="button" class="fj-textbtn fj-home-fran" data-fj-continue>Continue with Fran</button>':'')+'</div>'
 +(n<6?nextActions(next):'')
 +'<details class="fj-home-more"'+(homeOpen?' open':'')+'><summary>'+(pre?'All six parts and your path to opening':'See all six parts')+'</summary>'+grid+path+'</details>'
h.querySelector('.fj-home-more').addEventListener('toggle',e=>{homeOpen=e.target.open})
h.querySelector('[data-fj-continue]')?.addEventListener('click',()=>resume('home'))
h.querySelectorAll('[data-fj-do]').forEach(b=>b.onclick=()=>{const k=HUBKEY[next],a=b.dataset.fjDo;metric('setup_card_action',{slot:next,action:a});if(a==='area')return hub()?.openArea?.(k,'home_card');hub()?.perform?.(k,a)})
h.querySelectorAll('[data-fj-path]').forEach(b=>b.onclick=()=>{const p=PATH[b.dataset.fjPath];metric('setup_path_opened',{step:p.id});p.go()})
h.querySelectorAll('[data-fj-path-more]').forEach(b=>b.onclick=()=>{const [i,j]=b.dataset.fjPathMore.split(':');PATH[i].more[j][1]()})
h.querySelectorAll('[data-fj-area]').forEach(b=>b.onclick=()=>hub()?.openArea?.(HUBKEY[b.dataset.fjArea],'home_tile'))}

/* ---------- first visit: what a finished Wallet looks like ----------
   A brand-new owner (signed in, no location yet) sees an example Home, blurred and clearly labeled, with one
   centered prompt to start. A short tour is optional. Every figure in the example is fictional. */
const SAMPLE='<div class="fj-sample" aria-hidden="true" inert>'
 +'<div class="fj-sample-head"><div><small>Sample Bakery · Example store</small><h1>Good morning.</h1></div><span class="fj-sample-pills"><i class="on">✓ Point of sale</i><i class="on">✓ QuickBooks</i><i class="on">✓ Gusto</i><i>+ Insurance</i></span></div>'
 +'<div class="fj-sample-hero"><small>This week’s sales</small><strong>$18,420</strong><div class="fj-sample-strip"><span>Labor <b>24.8%</b></span><span>Cash <b>$41,200</b></span><span>Next payroll <b>Fri</b></span></div><em>Plan next week →</em></div>'
 +'<div class="fj-sample-stats"><div class="s-green"><small>Available cash</small><strong>$41,200</strong><span>3 accounts · today</span></div><div class="s-orange"><small>Labor cost</small><strong>$4,570</strong><span>Last pay period</span></div><div class="s-blue"><small>Net sales</small><strong>$73,900</strong><span>September · closed</span></div><div class="s-purple"><small>Scheduled hours</small><strong>412 h</strong><span>Next week</span></div></div>'
 +'<div class="fj-sample-rows"><div><b>Lease</b><span>Renews Mar 2029 · rent $6,200/mo</span></div><div><b>Insurance</b><span>General liability · renews Jan 14</span></div><div><b>Books</b><span>September closed · net income $8,310</span></div></div></div>'
const TOUR=[
 ['One Home for the whole business','Cash, sales and labor for each store, with the date beside every number.'],
 ['Numbers you can check','Every figure links to its source: the bank, QuickBooks, payroll or the document it came from.'],
 ['Plan labor every week','Payroll and your schedule meet sales, so next week’s plan is ready before Monday.'],
 ['Records ready when you need them','Lease, insurance and company papers in one place, with renewal dates. Share a data room with a lender in a few clicks.']]
const ROAD=['Business plan','Ownership team','Incorporate','Finance stack: bank, cards, loan','Insurance','Accounting (QuickBooks)','Payroll']
let welcomeHost=null,tourAt=-1
function welcome(){const dash=$('page-dashboard');if(!dash)return create()
 window.switchTab?.('dashboard');document.body.classList.add('fj-welcome-on')
 if(!welcomeHost){welcomeHost=document.createElement('section');welcomeHost.id='fj-welcome';welcomeHost.className='fj-welcome'}
 dash.prepend(welcomeHost);tourAt=-1;paintWelcome();metric('welcome_shown',{})}
function paintWelcome(){const w=welcomeHost;if(!w)return
 const card=tourAt<0?'<small class="fj-eyebrow">Welcome to Fran Wallet</small><h2 id="fj-welcome-title">This is what a finished Wallet looks like.</h2><p>Behind this card is an example Home with made-up figures. Yours fills in as you add your company, bank, books and payroll. Most owners start with the company.</p><ol class="fj-road" aria-label="Your path as a new franchisee">'+ROAD.map(r=>'<li>'+E(r)+'</li>').join('')+'</ol><div class="fj-welcome-actions"><button type="button" class="fj-btn primary" data-fj-welcome-start>Start setting up my company</button><button type="button" class="fj-btn" data-fw-tour>Take the 1-minute tour</button></div><p class="fj-home-fine">Free to start. Nothing connects, uploads or sends without your OK.</p>'
  :tourAt<TOUR.length?'<small class="fj-eyebrow">Tour · '+(tourAt+1)+' of '+TOUR.length+'</small><h2 id="fj-welcome-title">'+E(TOUR[tourAt][0])+'</h2><p>'+E(TOUR[tourAt][1])+'</p><div class="fj-dots" aria-hidden="true">'+TOUR.map((_,i)=>'<i'+(i===tourAt?' class="on"':'')+'></i>').join('')+'</div><div class="fj-welcome-actions"><button type="button" class="fj-btn primary" data-fw-tour-next>'+(tourAt===TOUR.length-1?'See where to start':'Next')+'</button><button type="button" class="fj-textbtn" data-fw-tour-skip>Skip tour</button></div>'
  :'<small class="fj-eyebrow">Your path as a new franchisee</small><h2 id="fj-welcome-title">Seven steps from signing to opening.</h2><ol class="fj-road" aria-label="Your path as a new franchisee">'+ROAD.map(r=>'<li>'+E(r)+'</li>').join('')+'</ol><p>Fran keeps your place in each one. You can do them in any order; the company comes first because the bank, landlord and payroll all ask for it.</p><div class="fj-welcome-actions"><button type="button" class="fj-btn primary" data-fj-welcome-start>Start setting up my company</button></div>'
 w.innerHTML=SAMPLE+'<div class="fj-welcome-layer"><span class="fj-sample-tag">Example Home · fictional figures</span><div class="fj-welcome-card" role="region" aria-labelledby="fj-welcome-title" tabindex="-1">'+card+'</div></div>'
 w.querySelectorAll('[data-fj-welcome-start]').forEach(b=>b.onclick=()=>{metric('welcome_start',{tour:tourAt});create()})
 w.querySelector('[data-fw-tour]')?.addEventListener('click',()=>{tourAt=0;metric('welcome_tour',{});paintWelcome()})
 w.querySelector('[data-fw-tour-next]')?.addEventListener('click',()=>{tourAt++;paintWelcome()})
 w.querySelector('[data-fw-tour-skip]')?.addEventListener('click',()=>{tourAt=TOUR.length;paintWelcome()})
 requestAnimationFrame(()=>(w.querySelector('.fj-welcome-card .primary')||w.querySelector('.fj-welcome-card'))?.focus({preventScroll:true}))}
function dropWelcome(){welcomeHost?.remove();welcomeHost=null;document.body.classList.remove('fj-welcome-on')}
/* ---------- wiring ---------- */
const orig=window.openWalletModal
if(orig){window.FRAN_JOURNEY_ORIGINAL_OPEN=orig
 window.openWalletModal=function(mode,...a){if((mode||'create')==='create'&&typeof WALLETS!=='undefined'&&!WALLETS.length&&!busy){/* Sign-in for an account with no location yet: show the example Home first. */if(window.FRAN_FIRST_RUN){window.FRAN_FIRST_RUN=false;return welcome()}return create()}return orig.call(this,mode,...a)}}
window.addEventListener('fran:location',e=>{const prev=loc?.wallet?.id;loc=e.detail;if(loc?.wallet)dropWelcome();if(prev!==loc?.wallet?.id){life=null;server=null;pending=null;lastPut=0}if(prev&&prev!==loc?.wallet?.id&&dialog?.open&&phase!=='create')dialog.close();renderWallet();showPill();renderHome()})
window.addEventListener('fran:readiness',e=>{if(e.detail?.location?.wallet?.id!==loc?.wallet?.id)return;life=e.detail.life;/* A refresh fetched just before our own save lands can carry the previous copy; keep what we just wrote. */const row=(life?.records||[]).find(r=>r.kind==='setup');if(row&&!(server&&Date.now()-lastPut<15000))server={data:row.data||{},updated_at:row.updated_at||row.created_at};renderWallet();showPill();renderHome()
 /* Back from a provider’s authorization screen: continue the conversation once per return. */
 const waiting=store().awaiting;if(waiting&&owned()&&!dialog?.open&&!pendingPlan){save({awaiting:''});setTimeout(()=>resume('return'),300)}})
/* Continue once this wallet's data arrives; if the refresh is slow, continue with the wallet just created and let the data fill in. */
window.addEventListener('fran:onboarding-created',e=>{if(!pendingPlan)return;const id=e.detail?.wallet_id,started=Date.now();const go=()=>{if(loc?.wallet?.id===id)return afterCreate();const w=typeof WALLETS!=='undefined'&&WALLETS.find(x=>x.id===id);if(w&&Date.now()-started>2500){loc={wallet:w,records:[],books:[],banks:[]};return afterCreate()}setTimeout(go,120)};go()})
window.addEventListener('fran:connector-result',()=>setTimeout(showPill,200))
document.addEventListener('click',()=>setTimeout(showPill,80))
const FROM_HUB={company:'entity',lease:'lease',banking:'banking',books:'accounting',payroll:'payroll',insurance:'insurance'},NOTE={connect:'started',file:'started',drive:'started',primary:'started',invite:'invited',help:'exploring'}
window.FRAN_JOURNEY={create,resume,saved,note:(hubKey,action)=>{const slot=FROM_HUB[hubKey];if(!slot||!loc||!NOTE[action]||saved(slot))return;mark(slot,NOTE[action]);save({last:slot});renderHome();showPill()},ready:()=>loc?readyCount():0,refresh:()=>{renderWallet();showPill();renderHome()},active:()=>!!dialog?.open||!!pendingPlan||driving,state:()=>store(),
 /* Setup never opens on its own for a location that exists: the Home card carries it. Returning true tells the
    onboarding guide that setup is handled, so it doesn't open its own dialog either. */
 autoResume:()=>{if(pendingPlan||dialog?.open)return true;return owned()},
 driveOn,welcome}
})()
