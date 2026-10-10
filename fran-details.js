/* Details read from documents: review, save, and where they live in the Wallet.
   - Review: "Here's what I found" with every value editable and the line it came from underneath.
   - Save: company details merge into the entity record; a lease and a loan are saved as owner-confirmed
     records (one per document); a loan also updates the Debt schedule with its current balance.
   - Present: Loan cards on Debt. Company shows the lease, entity and owners as summary cards with a detail sheet
     (fran-wallet-experience.js), and invites owners from there.
   Nothing is saved until the owner presses Save. Loan schedules are calculated from confirmed terms. */
(()=>{'use strict'
const $=id=>document.getElementById(id),E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const X=()=>window.FranExtract,metric=(n,p)=>{try{window.posthog?.capture(n,p)}catch(_){}}
let loc=null,life=null
const owned=()=>!!loc?.wallet&&!loc.wallet.access_role
const today=()=>new Date().toISOString().slice(0,10)
const usd=(v,d=0)=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(v))
const day=s=>s?new Date(s+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}):'—'
const per=p=>p==='year'?'/yr':p==='square foot per year'?'/sf/yr':'/mo'
const ICON={entity:'<path d="M4 21V5l8-3 8 3v16"/><path d="M9 21v-5h6v5M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01"/>',lease:'<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',loan:'<path d="M3 9 12 4l9 5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',quote:'<path d="M7 7h4v4H7zM13 7h4v4h-4zM7 11c0 3-1 5-3 6M13 11c0 3-1 5-3 6"/>',people:'<circle cx="9" cy="8" r="3"/><path d="M3 20c.7-3.4 3-5 6-5s5.3 1.6 6 5M17 11v6M14 14h6"/>',mail:'<path d="M3 6h18v12H3z"/><path d="m3 7 9 6 9-6"/>',phone:'<path d="M5 4h4l2 5-3 2a11 11 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 6a2 2 0 0 1 2-2"/>'}
const svg=n=>'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+(ICON[n]||'')+'</svg>'
async function api(fn,action,body){const {data:{session}}=await sb.auth.getSession();if(!session)throw Error('Please sign in again.')
 const r=await fetch(SUPABASE_URL+'/functions/v1/'+fn,{method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify({action,wallet_id:loc.wallet.id,...body})})
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'That didn’t save. Please try again.');return d}
const records=k=>(life?.records||[]).filter(r=>r.kind===k)
const entityRecord=()=>records('entity')[0]?.data||null

/* ---------- review: what was found, editable, with its source ---------- */
const LABEL={entity:'Company documents',lease:'Lease',loan:'Loan'}
const SPEC={
 entity:[['name','Legal name'],['entity_type','Entity type','select',['LLC','Corporation','Partnership','Sole proprietorship']],['jurisdiction','State of formation','state'],['ein','EIN','text','XX-XXXXXXX'],['effective_date','Formation date','date']],
 lease:[['landlord','Landlord'],['landlord_contact.name','Landlord contact'],['landlord_contact.email','Contact email','email'],['landlord_contact.phone','Contact phone','tel'],['premises','Premises','text','',true],['effective_date','Effective date','date'],['expiration_date','Expiration date','date'],['base_rent','Base rent','money'],['cam','CAM','money'],['security_deposit','Security deposit','money'],['renewal','Renewal options','text','',true]],
 loan:[['lender','Lender'],['contact.name','Point of contact'],['contact.email','Contact email','email'],['contact.phone','Contact phone','tel'],['loan_type','Loan type'],['loan_number','Loan number'],['amount','Loan amount','money'],['apr','Interest rate (%)','number'],['term_months','Term (months)','number'],['payment','Monthly payment','money'],['first_payment_date','First payment','date'],['maturity_date','Maturity date','date']]}
const REQUIRED={entity:['name'],lease:['landlord'],loan:['lender','amount','apr','term_months']}
/* Flatten extracted fields into form values + evidence lines. */
function flatten(kind,f){const v={},ev={},calc={};const put=(k,x)=>{if(!x)return;ev[k]=x.evidence||'';if(x.calculated)calc[k]=true}
 for(const [key] of SPEC[kind]){const [a,b]=key.split('.');const src=f[a];if(!src)continue;if(b){v[key]=src.value?.[b]||'';if(v[key])put(key,src)}else if(a==='base_rent'||a==='cam'){v[key]=src.value?.amount??'';v[a+'_period']=src.value?.period||'month';if(a==='cam')v.cam_basis=src.value?.basis||'';put(key,src)}else{v[key]=src.value;put(key,src)}}
 if(kind==='lease'&&f.term_months){v.term_months=f.term_months.value;ev.term_months=f.term_months.evidence}
 if(kind==='lease'&&f.tenant)v.tenant=f.tenant.value
 if(kind==='loan'&&f.note_date)v.note_date=f.note_date.value
 return {v,ev,calc,owners:kind==='entity'?(f.owners||[]).map(o=>({name:o.name,percentage:o.percentage,evidence:o.evidence})):[]}}
function field([key,label,type='text',hint='',wide],v,ev,calc){const val=v[key]??'',id='fd-'+key.replace('.','-'),found=!!ev[key]
 const input=type==='select'?'<select id="'+id+'" data-k="'+key+'"><option value="">Choose</option>'+hint.map(o=>'<option'+(o===val?' selected':'')+'>'+E(o)+'</option>').join('')+'</select>'
  :type==='state'?'<select id="'+id+'" data-k="'+key+'"><option value="">Choose</option>'+(typeof STATE_CODES!=='undefined'?STATE_CODES:Object.values(X().STATES)).map(o=>'<option'+(o===val?' selected':'')+'>'+E(o)+'</option>').join('')+'</select>'
  :'<div class="fd-in'+(type==='money'?' money':'')+'">'+(type==='money'?'<span>$</span>':'')+'<input id="'+id+'" data-k="'+key+'" type="'+(type==='money'||type==='number'?'number':type==='date'?'date':type==='email'?'email':type==='tel'?'tel':'text')+'"'+(type==='money'?' step="0.01" min="0"':type==='number'?' step="0.01" min="0"':'')+' value="'+E(val)+'" placeholder="'+E(found?'':hint||'Not in the document')+'">'+(key==='base_rent'||key==='cam'?'<select data-k="'+key+'_period" aria-label="'+E(label)+' period">'+['month','year','square foot per year'].map(p=>'<option value="'+p+'"'+((v[key+'_period']||'month')===p?' selected':'')+'>'+per(p)+'</option>').join('')+'</select>':'')+'</div>'
 return '<label class="fd-field'+(wide?' wide':'')+(found?' found':' missing')+'" for="'+id+'"><span class="fd-label">'+E(label)+(found?'<i aria-label="Found in the document">✓</i>':'')+'</span>'+input+(found?'<small class="fd-ev" title="'+E(ev[key])+'">'+(calc[key]?'Calculated · ':'')+E(ev[key]).slice(0,220)+'</small>':'<small class="fd-ev none">Not found. Add it if you know it.</small>')+'</label>'}
function ownerRows(owners){return owners.map((o,i)=>'<div class="fd-owner" data-i="'+i+'"><input data-o="name" aria-label="Owner name" value="'+E(o.name)+'" placeholder="Owner name"><div class="fd-in pct"><input data-o="percentage" aria-label="Ownership percentage" type="number" min="0" max="100" step="0.01" value="'+E(o.percentage??'')+'" placeholder="—"><span>%</span></div><button type="button" class="fd-x" data-remove aria-label="Remove owner">×</button>'+(o.evidence?'<small class="fd-ev">'+E(o.evidence).slice(0,160)+'</small>':'')+'</div>').join('')}
/* Renders into host; resolves with the saved data, or null if the owner chose not to save. */
function review(host,kind,fields,meta={}){return new Promise(resolve=>{const {v,ev,calc,owners}=flatten(kind,fields),spec=SPEC[kind],found=Object.keys(ev).length+(owners.length?1:0)
 host.innerHTML='<form class="fd-review" novalidate><header><span class="fd-mark">'+svg(kind)+'</span><div><small>'+E(LABEL[kind].toUpperCase())+(meta.fileName?' · '+E(meta.fileName):'')+'</small><h3>Here’s what I found</h3><p>Check each detail and fix anything that’s off. Nothing is saved until you press Save.</p></div><span class="fd-count">'+found+' found</span></header>'+
  '<div class="fd-grid">'+spec.map(s=>field(s,v,ev,calc)).join('')+'</div>'+
  (kind==='entity'?'<section class="fd-owners"><h4>'+svg('people')+'Owners</h4><p>'+(owners.length?'Named in the document. Confirm names and percentages.':'No owners found in this document. Add them if you like.')+'</p><div data-owners>'+ownerRows(owners)+'</div><button type="button" class="fd-link" data-add-owner>+ Add an owner</button></section>':'')+
  (kind==='loan'?'<section class="fd-calc" aria-live="polite"></section>':'')+
  '<p class="fd-err" role="alert"></p><footer><button type="submit" class="fd-save">Save to Wallet</button><button type="button" class="fd-skip" data-skip>Not now</button></footer></form>'
 const form=host.querySelector('form'),list=()=>[...form.querySelectorAll('.fd-owner')].map(r=>({name:r.querySelector('[data-o=name]').value.trim(),percentage:r.querySelector('[data-o=percentage]').value===''?null:Number(r.querySelector('[data-o=percentage]').value)})).filter(o=>o.name)
 const values=()=>{const out={...v};form.querySelectorAll('[data-k]').forEach(el=>{const k=el.dataset.k;out[k]=el.type==='number'?(el.value===''?null:Number(el.value)):el.value.trim()});return out}
 const calcPanel=()=>{const p=form.querySelector('.fd-calc');if(!p)return;const d=values(),s=X().schedule({amount:d.amount,apr:d.apr,term_months:d.term_months,payment:d.payment,first_payment_date:d.first_payment_date});if(!s){p.innerHTML='<p class="fd-calc-empty">Add the amount, rate and term to see the payment schedule.</p>';return}
  const next=s.rows.find(r=>!r.date||r.date>=today())||s.rows[0];p.innerHTML='<h4>Payment schedule <small>Calculated from the terms above</small></h4><div class="fd-tiles"><div><span>Monthly payment</span><strong>'+usd(s.payment,2)+'</strong>'+(s.calculated?'<small>calculated</small>':'<small>from the document</small>')+'</div><div><span>'+(next.date?day(next.date):'Payment '+next.n)+'</span><strong>'+usd(next.principal,2)+'</strong><small>principal</small></div><div><span>Same payment</span><strong>'+usd(next.interest,2)+'</strong><small>interest</small></div><div><span>Paid off</span><strong>'+(s.payoff_date?day(s.payoff_date):s.rows.length+' payments')+'</strong><small>'+usd(s.total_interest)+' total interest</small></div></div>'+table(s,6)}
 form.addEventListener('input',e=>{if(e.target.closest('.fd-field'))e.target.closest('.fd-field').classList.remove('bad');calcPanel()})
 form.querySelector('[data-add-owner]')?.addEventListener('click',()=>{const box=form.querySelector('[data-owners]');box.insertAdjacentHTML('beforeend',ownerRows([{name:'',percentage:null}]));box.lastElementChild.querySelector('input').focus()})
 form.addEventListener('click',e=>{if(e.target.matches('[data-remove]'))e.target.closest('.fd-owner').remove()})
 form.querySelector('[data-skip]').onclick=()=>{metric('details_review',{kind,action:'skip',found});resolve(null)}
 form.onsubmit=async e=>{e.preventDefault();const d=values(),err=form.querySelector('.fd-err');err.textContent='';let bad=null
  for(const k of REQUIRED[kind])if(d[k]===''||d[k]===null||d[k]===undefined){const f=form.querySelector('[data-k="'+k+'"]')?.closest('.fd-field');f?.classList.add('bad');bad=bad||f}
  if(bad){err.textContent='Add the highlighted '+(kind==='loan'?'details so the schedule is right.':'detail to save.');bad.querySelector('input,select')?.focus();return}
  const btn=form.querySelector('.fd-save');btn.disabled=true;btn.textContent='Saving…'
  try{const saved=await save(kind,{...d,owners:kind==='entity'?list():undefined},ev,meta);metric('details_review',{kind,action:'save',found});resolve(saved)}
  catch(x){err.textContent=x.message;btn.disabled=false;btn.textContent='Save to Wallet'}}
 calcPanel();requestAnimationFrame(()=>form.querySelector('.fd-save')?.focus({preventScroll:true}))})}
function table(s,limit){const rows=limit?s.rows.slice(Math.max(0,s.rows.findIndex(r=>!r.date||r.date>=today())),Math.max(0,s.rows.findIndex(r=>!r.date||r.date>=today()))+limit):s.rows
 return '<div class="fd-table" role="region" aria-label="Payment schedule" tabindex="0"><table><thead><tr><th>#</th><th>Date</th><th>Payment</th><th>Principal</th><th>Interest</th><th>Balance</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+r.n+'</td><td>'+(r.date?day(r.date):'—')+'</td><td>'+usd(r.payment,2)+'</td><td>'+usd(r.principal,2)+'</td><td>'+usd(r.interest,2)+'</td><td>'+usd(r.balance,2)+'</td></tr>').join('')+'</tbody></table></div>'}

/* ---------- save into the Wallet ---------- */
async function save(kind,d,ev,meta){const evidence=Object.fromEntries(Object.entries(ev||{}).map(([k,s])=>[k.split('.')[0],s]))
 if(kind==='entity'){const cur=entityRecord()||{},owners=(d.owners||[]).map(o=>({name:o.name,percentage:o.percentage}))
  const name=d.name||cur.name||'',jurisdiction=d.jurisdiction||cur.jurisdiction||''
  const data={...cur,name,entity_type:d.entity_type||cur.entity_type||'Undecided',jurisdiction,ein:d.ein||cur.ein||'',effective_date:d.effective_date||cur.effective_date||'',owners:owners.length?owners:(cur.owners||[]),stage:cur.stage&&cur.stage!=='planning'?cur.stage:'existing',operating_status:cur.operating_status||'operating',onboarding_draft:!(name&&jurisdiction)}
  await api('lifecycle','save',{kind:'entity',data,request_id:'entity'});await refresh();return {kind,...data}}
 const docId=meta.docId||'',key=docId||('doc:'+(meta.fileName||kind+'-'+Date.now()))
 const existing=records(kind).find(r=>r.data?.document_id===docId&&docId||r.record_key===key)
 if(kind==='lease'){const data={document_id:docId,document_name:meta.fileName||'',landlord:d.landlord,tenant:d.tenant||'',landlord_contact:{name:d['landlord_contact.name']||'',email:d['landlord_contact.email']||'',phone:d['landlord_contact.phone']||''},premises:d.premises||'',effective_date:d.effective_date||'',expiration_date:d.expiration_date||'',term_months:d.term_months||null,base_rent:d.base_rent,base_rent_period:d.base_rent!==null&&d.base_rent!==''?d.base_rent_period||'month':'',cam:d.cam,cam_period:d.cam!==null&&d.cam!==''?d.cam_period||'month':'',cam_basis:d.cam_basis||'',security_deposit:d.security_deposit,renewal:d.renewal||'',evidence}
  await api('lifecycle','save',{kind:'lease',data,request_id:key,...(existing?{id:existing.id}:{})});await refresh();return {kind,...data}}
 const data={document_id:docId,document_name:meta.fileName||'',lender:d.lender,contact:{name:d['contact.name']||'',email:d['contact.email']||'',phone:d['contact.phone']||''},loan_number:d.loan_number||'',loan_type:d.loan_type||'',amount:d.amount,apr:d.apr,term_months:d.term_months,payment:d.payment,first_payment_date:d.first_payment_date||'',maturity_date:d.maturity_date||'',note_date:d.note_date||'',evidence}
 await api('lifecycle','save',{kind:'loan',data,request_id:key,...(existing?{id:existing.id}:{})})
 /* The Debt schedule shows one current balance per loan: the scheduled balance as of today, from the confirmed terms. */
 const s=X().schedule(data),bal=s?(data.first_payment_date&&data.first_payment_date>today()?data.amount:X().balanceOn(s,today())):data.amount
 await api('location','save',{kind:'debt',data:{lender:data.lender,reference:data.loan_number||data.document_name||'Loan',balance:Math.round((bal??data.amount)*100)/100,payment:s?.payment||data.payment||0,apr:data.apr,as_of:today(),maturity:data.maturity_date||s?.payoff_date||null}})
 await refresh();return {kind,...data,schedule:s}}
async function refresh(){try{await window.refreshLocation?.(true)}catch(_){}}
function summary(r){if(r.kind==='entity')return E(r.name||'Company')+(String(r.ein||'').replace(/\D/g,'').length>=4?' · EIN ••-•••'+String(r.ein).replace(/\D/g,'').slice(-4):'')+(r.owners?.length?' · '+r.owners.length+' owner'+(r.owners.length===1?'':'s'):'')
 if(r.kind==='lease')return E(r.landlord)+(r.base_rent?' · '+usd(r.base_rent)+per(r.base_rent_period):'')+(r.expiration_date?' through '+day(r.expiration_date):'')
 return E(r.lender)+' · '+usd(r.amount)+' at '+r.apr+'%'+(r.schedule?' · '+usd(r.schedule.payment,2)+'/mo':'')}

/* ---------- invite owners named in the papers ---------- */
function inviteOwners(host,owners){return new Promise(resolve=>{const me=String(typeof ME!=='undefined'&&ME?.email||'').toLowerCase()
 host.innerHTML='<section class="fd-invite"><h4>'+svg('people')+'Invite the other owners</h4><p>Owners you invite can manage this location’s connections, records, documents and sharing. They don’t see your other locations. Nothing is sent until you choose.</p><div>'+owners.map((o,i)=>'<div class="fd-invite-row" data-i="'+i+'"><span class="fd-avatar">'+E(o.name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase())+'</span><span class="fd-invite-name"><strong>'+E(o.name)+'</strong><small>'+(o.percentage!=null?o.percentage+'% owner':'Owner')+'</small></span><form class="fd-invite-form"><input type="email" required placeholder="Their email" aria-label="'+E(o.name)+' email"><button type="submit">Invite</button></form><p class="fd-invite-status" role="status"></p></div>').join('')+'</div><footer><button type="button" class="fd-save" data-done>Done</button></footer></section>'
 host.querySelectorAll('.fd-invite-row').forEach(row=>{const f=row.querySelector('form'),st=row.querySelector('.fd-invite-status')
  f.onsubmit=async e=>{e.preventDefault();const email=f.querySelector('input').value.trim().toLowerCase();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){st.textContent='Enter a valid email.';return}if(email===me){st.textContent='That’s you. You already have access.';return}
   f.querySelector('button').disabled=true;st.textContent='Adding…'
   try{await api('location','grant_team',{email});const url='https://franwallet.com/wallet.html?team_wallet='+encodeURIComponent(loc.wallet.id);metric('owner_invited',{source:'document'})
    f.outerHTML='<div class="fd-invite-done"><button type="button" data-copy>Copy invite link</button><button type="button" data-send>Email the invitation</button></div>';st.textContent=email+' is added. They get access when they sign in with that email.'
    row.querySelector('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(url);st.textContent='Link copied. Send it however you like.'}catch(_){st.textContent=url}}
    row.querySelector('[data-send]').onclick=async b=>{b.target.disabled=true;try{await api('location','send_team_invite',{email,invite_id:crypto.randomUUID()});st.textContent='Invitation email sent to '+email+'.'}catch(x){st.textContent=x.message;b.target.disabled=false}}}
   catch(x){st.textContent=x.message;f.querySelector('button').disabled=false}}})
 host.querySelector('[data-done]').onclick=()=>resolve()
 requestAnimationFrame(()=>host.querySelector('.fd-invite-form input')?.focus({preventScroll:true}))})}

/* ---------- add from a document, anywhere: pick, consent, upload, read, review, save ---------- */
const CATEGORY={entity:'Other',lease:'Lease',loan:'Debt & lending'}
async function uploadFile(file,category){const signed=await api('location','upload_url',{name:file.name,size:file.size,category});const {error}=await sb.storage.from('location-docs').uploadToSignedUrl(signed.path,signed.token,file,{contentType:file.type||'application/octet-stream'});if(error)throw Error(error.message);await api('location','finish_upload',{...signed,name:file.name,category});await refresh();return ((loc?.records||[]).filter(r=>r.kind==='document'&&r.data?.name===file.name).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0]?.id)||''}
async function readFile(file,hint){try{const text=await X().textOf(file);if(!text||text.trim().length<40)return {kind:null,found:0,unreadable:true};return X().read(text,file.name,hint)}catch(_){return {kind:null,found:0,unreadable:true}}}
function dialog(){let d=$('fd-dialog');if(d)return d;d=document.createElement('dialog');d.id='fd-dialog';d.className='fd-dialog';d.setAttribute('aria-label','Add details from a document');d.addEventListener('click',e=>{if(e.target===d)d.close()});document.body.append(d);return d}
async function fromDocument(kind,existing){if(!owned())return;const d=dialog(),name=loc.wallet.name
 const shell=body=>{d.innerHTML='<div class="fd-dialog-in"><button type="button" class="fd-close" aria-label="Close">×</button>'+body+'</div>';d.querySelector('.fd-close').onclick=()=>d.close();if(!d.open)d.showModal()}
 if(existing){shell('<div data-host></div>');const fields={};for(const [k,val] of Object.entries(existing))fields[k]={value:val,evidence:existing.evidence?.[k]||'Saved earlier.'};if(kind==='lease'){fields.base_rent={value:{amount:existing.base_rent,period:existing.base_rent_period},evidence:existing.evidence?.base_rent||'Saved earlier.'};fields.cam={value:{amount:existing.cam,period:existing.cam_period,basis:existing.cam_basis},evidence:existing.evidence?.cam||'Saved earlier.'}}
  const r=await review(d.querySelector('[data-host]'),kind,fields,{fileName:existing.document_name,docId:existing.document_id});d.close();return r}
 shell('<form class="fj-drop fd-pick"><h3>'+E({entity:'Add company documents',lease:'Add your lease',loan:'Add a loan document'}[kind])+'</h3><p>'+E({entity:'Articles, operating or partnership agreement, or your EIN letter. I’ll read the legal name, EIN, state and owners.',lease:'Signed lease or amendment. I’ll read the landlord, contact, dates, base rent and CAM.',loan:'Promissory note or loan agreement. I’ll read the lender, contact, amount, rate and term, and build the payment schedule.'}[kind])+'</p><label class="fj-dropzone"><input type="file" accept=".pdf,.txt"><strong>Choose a PDF</strong><small>Text-based PDFs read best · up to 25 MB</small><em data-file></em></label><label class="fj-consent"><input type="checkbox"> Store it privately with '+E(name)+' and let Fran read it. Nothing is shared.</label><p class="fj-err" role="alert"></p><div class="fj-drop-actions"><button type="submit" class="fj-go" disabled>Read it</button></div></form>')
 const f=d.querySelector('form'),input=f.querySelector('input[type=file]'),consent=f.querySelector('.fj-consent input'),go=f.querySelector('.fj-go');let file=null;const sync=()=>{go.disabled=!(file&&consent.checked)}
 input.onchange=()=>{file=input.files[0]||null;f.querySelector('[data-file]').textContent=file?.name||'';if(file&&file.size>25*1024*1024){file=null;f.querySelector('.fj-err').textContent='That file is over 25 MB.'}sync()};consent.onchange=sync
 f.onsubmit=async e=>{e.preventDefault();if(!file)return;go.disabled=true;go.textContent='Reading…'
  try{const [docId,found]=await Promise.all([uploadFile(file,CATEGORY[kind]),readFile(file,kind)])
   if(!found.kind||found.found<2){shell('<div class="fd-none"><h3>'+E(file.name)+' is saved</h3><p>'+(found.unreadable?'I couldn’t read text from this file. Scanned pages and photos need a text-based PDF.':'I couldn’t find the details I look for in this document.')+' You can type them instead.</p><div data-host></div></div>');const r=await review(d.querySelector('[data-host]'),kind,{},{fileName:file.name,docId});d.close();return}
   shell('<div data-host></div>');const r=await review(d.querySelector('[data-host]'),found.kind,found.fields,{fileName:file.name,docId})
   if(r&&r.kind==='entity'&&r.owners?.length>1){shell('<div data-host></div>');await inviteOwners(d.querySelector('[data-host]'),r.owners)}d.close()}
  catch(x){f.querySelector('.fj-err').textContent=x.message;go.disabled=false;go.textContent='Read it'}}
 requestAnimationFrame(()=>input.focus())}

/* ---------- where the details live ---------- */
/* Saved on the server with confirmed_at when the owner presses Save; extracted records wait for review. */
const sourceLine=d=>{const on=d.confirmed_at&&!/awaiting/i.test(d.status||d.extraction_status||'')?String(d.confirmed_at).slice(0,10):'';return '<footer class="fd-source">From '+E(d.document_name||'your document')+' · '+(on?'confirmed by you '+day(on):'awaiting your review')+'</footer>'}
function loanCard(r){const d=r.data,s=X().schedule(d),now=today();const next=s?.rows.find(x=>!x.date||x.date>=now),bal=s?(d.first_payment_date&&d.first_payment_date>now?d.amount:X().balanceOn(s,now)):d.amount,paid=d.amount?Math.max(0,Math.min(100,Math.round((1-bal/d.amount)*100))):0,c=d.contact||{}
 return '<article class="fd-card"><header><span class="fd-mark">'+svg('loan')+'</span><div><small>'+E([d.loan_type||'LOAN',d.loan_number?'#'+d.loan_number:''].filter(Boolean).join(' · ').toUpperCase())+'</small><h3>'+E(d.lender)+'</h3>'+(c.name||c.email||c.phone?'<p class="fd-contact">'+(c.name?'<span>'+E(c.name)+'</span>':'')+(c.email?'<a href="mailto:'+E(c.email)+'">'+svg('mail')+E(c.email)+'</a>':'')+(c.phone?'<a href="tel:'+E(c.phone.replace(/[^\d+]/g,''))+'">'+svg('phone')+E(c.phone)+'</a>':'')+'</p>':'')+'</div><button type="button" class="fd-edit" data-fd-edit="loan" data-id="'+E(r.id)+'">Edit</button></header>'+
  '<div class="fd-tiles"><div><span>Balance today</span><strong>'+usd(bal)+'</strong><small>of '+usd(d.amount)+' · calculated</small></div><div><span>Monthly payment</span><strong>'+usd(s?.payment??d.payment,2)+'</strong><small>'+(d.payment?'from the document':'calculated')+'</small></div><div><span>Interest rate</span><strong>'+E(d.apr)+'%</strong><small>'+E(d.term_months)+'-month term</small></div><div><span>Paid off</span><strong>'+day(s?.payoff_date||d.maturity_date)+'</strong><small>'+(s?usd(s.total_interest)+' total interest':'')+'</small></div></div>'+
  '<div class="fd-term"><div><span>Paid down</span><strong>'+paid+'%</strong></div><div class="fd-bar" aria-hidden="true"><i style="width:'+paid+'%"></i></div><div><span>Next payment</span><strong>'+(next?.date?day(next.date):'—')+'</strong></div></div>'+(next?'<p class="fd-term-note">Next payment: '+usd(next.principal,2)+' principal + '+usd(next.interest,2)+' interest</p>':'')+
  (s?'<details class="fd-sched"><summary>Payment schedule · '+s.rows.length+' payments</summary><p>Calculated from the terms you confirmed. Your lender’s statement is the official balance.</p>'+table(s)+'</details>':'')+
  sourceLine(d)+'</article>'}
function section(id,page,anchorSel,html){let s=$(id);const p=$('page-'+page);if(!p)return null;if(!s){s=document.createElement('section');s.id=id;s.className='fd-section'}const anchor=p.querySelector(anchorSel)||p.querySelector('.main-hdr');if(anchor&&anchor.nextElementSibling!==s)anchor.after(s);else if(!anchor&&p.firstElementChild!==s)p.prepend(s);s.innerHTML=html;return s}
function render(){$('fd-company')?.remove();if(!owned()||!life){$('fd-debt')?.remove();return}
 /* Company: the lease, loan, entity and owners are summary cards in fran-wallet-experience.js, so nothing is drawn there. */
 const loans=records('loan')
 const dt=section('fd-debt','debt','.hub-hero','<div class="fd-head"><h2>Loans</h2><button type="button" class="fd-link" data-fd-add="loan">Add a loan document</button></div>'+(loans.length?loans.map(loanCard).join(''):'<article class="fd-card empty"><span class="fd-mark">'+svg('loan')+'</span><div><h3>Add a loan document</h3><p>I’ll read the lender, your contact, the amount, rate and term, and build the month-by-month schedule of principal and interest.</p></div><button type="button" class="fd-cta" data-fd-add="loan">Add loan</button></article>'))
 if(dt){dt.querySelectorAll('[data-fd-add]').forEach(b=>b.onclick=()=>fromDocument(b.dataset.fdAdd));dt.querySelectorAll('[data-fd-edit]').forEach(b=>b.onclick=()=>{const r=records(b.dataset.fdEdit).find(x=>x.id===b.dataset.id);if(r)fromDocument(b.dataset.fdEdit,r.data)})}}
window.addEventListener('fran:location',e=>{if(e.detail?.wallet?.id!==loc?.wallet?.id)life=null;loc=e.detail;render()})
window.addEventListener('fran:readiness',e=>{if(e.detail?.location?.wallet?.id!==loc?.wallet?.id)return;life=e.detail.life;render()})
/* The Debt page rebuilds its content on every refresh; put the loans back when that happens. */
let restoring=false;const watch=new MutationObserver(()=>{if(restoring||!owned()||!life)return;if(document.getElementById('page-debt')&&!$('fd-debt')){restoring=true;requestAnimationFrame(()=>{render();restoring=false})}})
for(const id of ['page-debt']){const p=document.getElementById(id);if(p)watch.observe(p,{childList:true})}
window.FranDetails={review,save,readFile,uploadFile,inviteOwners,fromDocument,summary,render}
})()
