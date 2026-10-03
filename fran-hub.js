/* Setup sheets, the connectors & plugins directory, and page guides.
   One place to start each area (Accounting, Payroll, Insurance, Finance…), modeled on
   connector directories: connect what you already use, start with a file, or bring in
   someone to help. Every action reuses an existing, explicit flow; nothing connects,
   uploads or sends from this file. Saved/connected states come from the setup journey
   and connector health, never from a logo. */
(()=>{'use strict'
const $=id=>document.getElementById(id),E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const actions=()=>window.FRAN_SETUP_ACTIONS,journey=()=>window.FRAN_SETUP_JOURNEY
const metric=(name,props)=>{try{window.posthog?.capture(name,props)}catch(_){}}
const memberId=()=>typeof ME!=='undefined'&&ME?.id||''
const go=(route,then)=>{window.switchTab?.(route);if(then)setTimeout(then,90)}
const icon=name=>'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+({
 books:'<path d="M4 19V5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2Zm0 0a2 2 0 0 0 2 2h12"/><path d="M8 8h6M8 12h6"/>',
 payroll:'<circle cx="9" cy="8" r="3"/><path d="M3 20c.7-3.4 3-5 6-5s5.3 1.6 6 5"/><path d="M16 4.5a3 3 0 0 1 0 6M18 15c1.8.6 2.8 2.2 3 5"/>',
 insurance:'<path d="M12 3 5 6v5c0 4.4 2.9 8.3 7 10 4.1-1.7 7-5.6 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
 banking:'<path d="M3 9 12 4l9 5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
 company:'<path d="M4 21V5l8-3 8 3v16"/><path d="M9 21v-5h6v5M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01"/>',
 files:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 14h6M9 17h4"/>',
 debt:'<path d="M3 17 9 11l4 4 8-8"/><path d="M15 7h6v6"/>',
 upload:'<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>',
 people:'<circle cx="9" cy="8" r="3"/><path d="M3 20c.7-3.4 3-5 6-5s5.3 1.6 6 5M17 11v6M14 14h6"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>',
 spark:'<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
 check:'<path d="m5 12 4 4 10-10"/>'}[name]||'')+'</svg>'

/* topic = setup-journey id; connector = onboarding connector id used for health and handoff. */
const AREAS={
 books:{topic:'qbo',route:'books',name:'Accounting',noun:'your books',value:'Revenue, expenses and monthly profit, with the reporting period beside every number.',unlock:['Monthly profit & loss','Expense trends','Reporting periods'],
  connect:[{name:'QuickBooks Online',logo:'QB',copy:'Profit & loss, balance sheet and reporting periods.',connector:'qbo'}],
  file:{label:'Upload a P&L or balance sheet',copy:'Using Xero, Wave or spreadsheets? A recent export works.',category:'Financial statements'},
  invite:{scope:'accounting',label:'Invite your accountant or bookkeeper',copy:'They get access to this location only.'},
  help:{service:'books',label:'Get bookkeeping from CoverPanda',copy:'Monthly books, cleanup and reporting. You see scope and price before anything starts.'},
  reads:'Accounting reports and company identity you authorize.',limits:'Fran does not create, edit or pay transactions.'},
 payroll:{topic:'payroll',route:'payroll',name:'Payroll',noun:'payroll',value:'Employer cost, paid hours and labor-to-sales for each pay period.',unlock:['Full labor cost','Labor vs. sales','Pay-period history'],
  connect:[{name:'Gusto',logo:'G',copy:'Pay runs, employer cost and headcount.',connector:'payroll'}],
  file:{label:'Import a payroll report',copy:'ADP, Paychex, Square, Toast or another provider: export a payroll summary.',payrollImport:true},
  invite:{scope:'payroll',label:'Invite your payroll provider',copy:'They can add reports for this location only.'},
  help:{service:'payroll',label:'Set up payroll with CoverPanda',copy:'Help choosing or running a payroll provider. Nothing starts without your approval.'},
  reads:'Payroll summaries and labor totals for the company you confirm.',limits:'Fran does not run, approve or change payroll.'},
 insurance:{topic:'insurance',route:'insurance',name:'Insurance',noun:'your coverage',value:'Coverage limits and renewal dates in one place, read from your policy documents.',unlock:['Coverage limits','Renewal dates','Policy documents'],
  connect:[],
  file:{label:'Upload a policy or declarations page',copy:'Fran reads the coverage and renewal dates from it.',category:'Legal & insurance',drive:true},
  invite:{scope:'insurance',label:'Invite your insurance agent',copy:'They can add policies for this location only.'},
  help:{service:'insurance',label:'Get coverage help from CoverPanda',copy:'Find an agent or compare coverage. You decide before anything is bound.'},
  reads:'The policy documents and coverage details you add.',limits:'Your insurer confirms coverage. Fran only organizes it.'},
 banking:{topic:'bank',route:'banking',name:'Banking & cards',noun:'your accounts',value:'Balances and account activity for this location, with the date of every figure.',unlock:['Available cash','Account activity','Statement history'],
  connect:[{name:'Bank & cards via Plaid',logo:'$',copy:'Balances and transactions from the accounts you choose.',connector:'bank'}],
  file:{label:'Upload a bank statement',copy:'A recent monthly statement is enough to start.',category:'Financial statements'},
  help:{draft:'bank',label:'Help choosing a bank or card',copy:'Prepares an editable request. Nothing is applied for.'},
  reads:'Only the accounts, balances and activity you approve in Plaid.',limits:'Fran cannot move money, make payments or see your bank login.'},
 company:{topic:'company',route:'company',name:'Company & legal',noun:'your company records',value:'Legal entity, owners and key dates kept together for this location.',unlock:['Legal identity','Ownership','Deadlines'],
  connect:[],primary:{label:'Add company details',copy:'Name, entity type, state and owners.',run:()=>go('entity',()=>{const f=$('life-entity-form');f?.scrollIntoView({block:'start'});f?.querySelector('input,select')?.focus()})},
  file:{label:'Upload formation documents',copy:'Articles, operating agreement or EIN letter.',category:'Other'},
  invite:{scope:'entity',label:'Invite your attorney or entity provider',copy:'They get access to this location only.'},
  help:{service:'entity',label:'Formation & registered agent help',copy:'Prepare a request. You review scope and fees before deciding.'},
  reads:'The company details and documents you add.',limits:'Fran does not file with the state on your behalf.'},
 lease:{route:'documents',name:'Lease & franchise agreement',noun:'your lease',value:'Rent, term and renewal dates, read from the signed lease or LOI.',unlock:['Rent & term','Renewal dates','Landlord contact'],
  connect:[],file:{label:'Upload your lease or LOI',copy:'Signed lease, amendment or letter of intent. Add the franchise agreement too.',category:'Lease',drive:true},
  help:{draft:'document',label:'Help reviewing my lease',copy:'Prepares an editable request. Nothing is sent automatically.'},
  reads:'The lease documents you add.',limits:'Fran does not negotiate or sign on your behalf.'},
 files:{heroTitle:'Your data room starts with one record',topic:'document',route:'documents',name:'Files & agreements',noun:'a record',value:'Private originals with source dates: leases, statements, franchise agreements.',unlock:['Private originals','Source dates','Searchable records'],
  connect:[],file:{label:'Upload a file',copy:'A lease, statement or agreement is enough to start.',drive:true},
  help:{draft:'document',label:'Help gathering my records',copy:'Prepares an editable request listing what to collect first.'},
  reads:'The private copy you select and its readable text.',limits:'Nothing is shared until you publish a room.'},
 debt:{topic:'debt',route:'debt',name:'Loans & financing',noun:'your loans',value:'Lender terms and recorded balances, each tied to a statement date.',unlock:['Lender & terms','Recorded balance','Statement date'],
  connect:[],primary:{label:'Add an existing loan',copy:'Lender, terms and the latest statement date.',run:()=>actions()?.run?.('debt')},
  file:{label:'Upload a lender statement',copy:'Fran keeps the balance tied to its statement date.',category:'Debt & lending'},
  help:{draft:'debt',label:'Get financing guidance',copy:'Prepares an editable request. No application or credit pull.'},
  reads:'The lender terms, source date and evidence you provide.',limits:'Fran does not verify payoffs or apply for credit.'}
}
/* The six Wallet parts lead and are what the counts measure; files and loans are extra sources. */
const ORDER=['company','lease','banking','books','payroll','insurance'],MORE=['files','debt']
const AUTO=['books','payroll','insurance','banking']
const ROUTE_AREA={books:'books',payroll:'payroll',insurance:'insurance',banking:'banking',company:'company',documents:'files',debt:'debt'}
const SOURCE_AREA={qbo:'books',bank:'banking',payroll:'payroll',document:'files',debt:'debt',insurance:'insurance'}
const SETUP_AREA={books:'books',payroll:'payroll',insurance:'insurance',entity:'company'}
const TOPIC_AREA=Object.fromEntries(Object.entries(AREAS).map(([k,a])=>[a.topic,k]))

let quietUntil=0,state=null,readyWallet=null,route=document.querySelector('.page.active')?.id?.replace('page-','')||'dashboard'
const owned=()=>!!state?.wallet&&!state.wallet.access_role
const saved=key=>key==='lease'?!!window.FRAN_JOURNEY?.saved?.('lease'):!!journey()?.catalog?.().find(t=>t.id===AREAS[key].topic)?.saved
/* Live QuickBooks availability is whatever the server status put on the real Connect button: a test company or an unavailable connection is not offered as a live connect. */
const qboLive=()=>{const t=($('connect-qbo')?.textContent||'').trim();return !t||t==='Connect QuickBooks'}
const health=connector=>connector==='qbo'&&!actions()?.connected?.('qbo')&&!qboLive()?{state:'manual',label:'Report upload available'}:connector?actions()?.connectorHealth?.(connector):null
const dialogOpen=()=>!!document.querySelector('dialog[open]')||($('wallet-modal')&&!$('wallet-modal').classList.contains('hidden'))
function sessionKey(kind,key){return 'fran_hub_'+kind+':'+memberId()+':'+(state?.wallet?.id||'')+':'+key}
function sessionFlag(kind,key,set){try{if(set)sessionStorage.setItem(sessionKey(kind,key),'1');return !!sessionStorage.getItem(sessionKey(kind,key))}catch(_){return !!set}}

function sheet(){let d=$('fran-hub');if(d)return d
d=document.createElement('dialog');d.id='fran-hub';d.className='fran-hub';d.setAttribute('aria-labelledby','fran-hub-title')
d.addEventListener('click',e=>{if(e.target===d)d.close()})
d.addEventListener('close',()=>{d.removeAttribute('data-mode');window.dispatchEvent(new CustomEvent('fran:hub-closed'))})
document.body.append(d);return d}
function show(d,focus){if(!d.open)d.showModal();requestAnimationFrame(()=>(d.querySelector(focus)||d.querySelector('.hub-close'))?.focus())}
function closeThen(fn){$('fran-hub')?.close();fn?.()}
function tip(id,text){return '<span class="hub-tip"><button type="button" aria-describedby="'+id+'" aria-label="More about this">?</button><span role="tooltip" id="'+id+'">'+E(text)+'</span></span>'}
function chip(text,tone){return '<span class="hub-chip'+(tone?' '+tone:'')+'">'+E(text)+'</span>'}

function connectorRow(key,c){const h=health(c.connector),manual=h?.state==='manual',attention=h?.state==='attention',live=actions()?.connected?.(c.connector)
const status=live&&!attention?chip('Connected','ok'):attention?chip(h.label||'Needs attention','warn'):manual?chip('Live connection not available yet','muted'):chip('Available')
const label=live&&!attention?'Review':attention?'Fix connection':manual?'Import a report':'Connect'
return '<div class="hub-row"><span class="hub-logo" aria-hidden="true">'+E(c.logo)+'</span><div class="hub-row-copy"><strong>'+E(c.name)+'</strong><p>'+E(manual?'Live '+c.name+' access isn’t enabled yet. Export a report from '+c.name+' and add it below.':c.copy)+'</p></div>'+status+(manual?'':'<button type="button" class="hub-btn'+(live&&!attention?'':' primary')+'" data-hub-connect="'+E(c.connector)+'">'+label+'</button>')+'</div>'}
function actionRow(kind,ic,o,label,primary){return '<div class="hub-row"><span class="hub-logo soft" aria-hidden="true">'+icon(ic)+'</span><div class="hub-row-copy"><strong>'+E(o.label)+'</strong><p>'+E(o.copy)+'</p></div><button type="button" class="hub-btn'+(primary?' primary':'')+'" data-hub-'+kind+'>'+E(label)+'</button></div>'}

function perform(key,action,connector){const a=AREAS[key];metric('setup_sheet_action',{area:key,action});$('fran-hub')?.close();window.FRAN_JOURNEY?.note?.(key,action)
 if(action==='connect')return actions()?.run?.(connector)
 if(action==='file')return a.file.payrollImport?actions()?.alternative?.('payroll'):actions()?.addFile?.(a.file.category)
 if(action==='drive')return actions()?.alternative?.('document')
 if(action==='invite')return go(a.route,()=>dispatchEvent(new CustomEvent('fran:invite-provider',{detail:{scope:a.invite.scope}})))
 if(action==='help')return a.help.draft?journey()?.draft?.(a.help.draft):dispatchEvent(new CustomEvent('fran:service-profile',{detail:{service:a.help.service}}))
 if(action==='market')return journey()?.market?.(a.topic)
 if(action==='primary')return a.primary.run()
 if(action==='review')return journey()?.review?.(a.topic)||go(a.route)}
function openArea(key,trigger='button'){const a=AREAS[key];if(!a||!owned())return
const name=state.wallet.name||'this location',done=saved(key),d=sheet();d.dataset.mode='area';d.dataset.area=key
const connect=a.connect.map(c=>connectorRow(key,c)).join('')+(a.primary?'<div class="hub-row"><span class="hub-logo soft" aria-hidden="true">'+icon(key)+'</span><div class="hub-row-copy"><strong>'+E(a.primary.label)+'</strong><p>'+E(a.primary.copy)+'</p></div><button type="button" class="hub-btn primary" data-hub-primary>Start</button></div>':'')
d.innerHTML='<header class="hub-head"><span class="hub-mark" aria-hidden="true">'+icon(key)+'</span><div><small>SET UP · '+E(name.toUpperCase())+'</small><h2 id="fran-hub-title">'+(done?E(a.name)+' is in your Wallet':'Bring '+E(a.noun)+' into '+E(name))+'</h2><p>'+E(a.value)+'</p></div><button type="button" class="hub-close" aria-label="Close">×</button></header>'+
 (done?'<div class="hub-saved" role="status">'+icon('check')+'<span><strong>A '+E(a.name.toLowerCase())+' source is saved.</strong> Review its dates and coverage, or add another source below.</span><button type="button" class="hub-btn primary" data-hub-review>Review '+E(a.name.toLowerCase())+'</button></div>':
 '<ol class="hub-steps" aria-label="How this works"><li class="on"><b>1</b>Connect or upload</li><li><b>2</b>Fran reads it</li><li><b>3</b>You review the result</li></ol><div class="hub-unlock"><small>WHAT YOU’LL SEE</small>'+a.unlock.map(u=>'<span>'+E(u)+'</span>').join('')+'</div>')+
 '<div class="hub-body">'+
 (connect?'<section class="hub-group"><h3>Connect what you use '+tip('hub-tip-connect','You review the provider’s own sign-in and permission screen. Fran only reads; you can disconnect anytime.')+'</h3>'+connect+'</section>':'')+
 '<section class="hub-group"><h3>'+(connect?'Or start with a file':'Start with a file')+' '+tip('hub-tip-file','Files stay private to this location. Fran reads what it can and shows you what still needs confirming.')+'</h3>'+actionRow('file','upload',a.file,a.file.payrollImport?'Import':'Upload',!a.connect.length&&!a.primary||a.connect.length&&a.connect.every(x=>health(x.connector)?.state==='manual'))+(a.file.drive?'<button type="button" class="hub-link" data-hub-drive>Import a private copy from Google Drive →</button>':'')+'</section>'+
 ((a.invite||a.help)?'<section class="hub-group"><h3>Have someone do it for you '+tip('hub-tip-help','An invite creates a private link for this location only. You copy and send it yourself. Requests to CoverPanda open as drafts.')+'</h3>'+(a.invite?actionRow('invite','people',{label:a.invite.label,copy:a.invite.copy+' Free.'},'Invite'):'')+(a.help?actionRow('help','help',a.help,a.help.draft?'Prepare request':'See options'):'')+'<button type="button" class="hub-link" data-hub-market>Explore tools & offers for '+E(a.name.toLowerCase())+' →</button></section>':'')+
 '<details class="hub-trust"><summary>What Fran can and can’t see</summary><dl><div><dt>Fran can use</dt><dd>'+E(a.reads)+'</dd></div><div><dt>Fran won’t</dt><dd>'+E(a.limits)+'</dd></div><div><dt>Scope</dt><dd>'+E(name)+' only</dd></div></dl></details></div>'+
 '<footer class="hub-foot"><button type="button" class="hub-link" data-hub-directory>All connectors & plugins</button><button type="button" class="hub-btn" data-hub-later>'+(done?'Done':'Not now')+'</button></footer>'
d.querySelector('.hub-close').onclick=()=>d.close()
d.querySelector('[data-hub-later]').onclick=()=>{metric('setup_sheet_action',{area:key,action:done?'done':'later'});d.close()}
d.querySelector('[data-hub-directory]').onclick=()=>openDirectory('connectors')
d.querySelector('[data-hub-review]')?.addEventListener('click',()=>perform(key,'review'))
d.querySelector('[data-hub-primary]')?.addEventListener('click',()=>perform(key,'primary'))
d.querySelectorAll('[data-hub-connect]').forEach(b=>b.onclick=()=>perform(key,'connect',b.dataset.hubConnect))
d.querySelector('[data-hub-file]').onclick=()=>perform(key,'file')
d.querySelector('[data-hub-drive]')?.addEventListener('click',()=>perform(key,'drive'))
d.querySelector('[data-hub-invite]')?.addEventListener('click',()=>perform(key,'invite'))
d.querySelector('[data-hub-help]')?.addEventListener('click',()=>perform(key,'help'))
d.querySelector('[data-hub-market]')?.addEventListener('click',()=>perform(key,'market'))
show(d,done?'[data-hub-review]':'.hub-btn.primary, [data-hub-file]')
metric('setup_sheet_opened',{area:key,trigger,saved:done})}

const PLUGINS=[
 {id:'ask',name:'Ask your Wallet',copy:'Ask questions about this location’s saved records. Answers cite their sources and dates.',needs:[],any:true,open:()=>go('ask')},
 {id:'labor',name:'Labor planning',copy:'Compare labor with sales and plan schedules by pay period.',needs:['payroll'],open:()=>go('payroll',()=>document.querySelector('#fw-payroll [data-workspace=schedule]')?.click())},
 {id:'readiness',name:'Readiness review',copy:'Check which records a lender or buyer will ask for, and what is missing.',needs:['files'],page:'readiness',open:()=>go('readiness')},
 {id:'rooms',name:'Data rooms',copy:'Share selected originals with a named lender, buyer or advisor. Revoke anytime.',needs:['files'],page:'dataroom',open:()=>go('dataroom')},
 {id:'debt',name:'Debt schedule',copy:'Track lenders, terms and recorded balances with statement dates.',needs:['debt'],page:'debt',open:()=>go('debt')},
 {id:'services',name:'CoverPanda services',copy:'Bookkeeping, payroll, insurance and formation help from your CoverPanda team.',needs:[],page:'services',open:()=>go('services')}]
function anySaved(){return ORDER.some(saved)}
function openDirectory(tab='connectors',trigger='button'){if(!owned())return
const d=sheet(),name=state.wallet.name||'this location';d.dataset.mode='directory'
const progress=ORDER.filter(saved).length,next=TOPIC_AREA[journey()?.next?.()],rec=next&&!saved(next)?next:ORDER.find(k=>!saved(k))
const card=key=>{const a=AREAS[key],done=saved(key),c=a.connect[0],h=health(c?.connector),manual=h?.state==='manual',attention=h?.state==='attention'
 const status=attention?chip('Needs attention','warn'):done?chip('Saved','ok'):key===rec?chip('Recommended','rec'):''
 const via=c?(manual?c.name+' report import':c.name)+' · upload':'Upload · invite · help'
 return '<article class="hub-card" data-hub-search="'+E((a.name+' '+via+' '+a.value).toLowerCase())+'"><header><span class="hub-mark small" aria-hidden="true">'+icon(key)+'</span><div><h3>'+E(a.name)+'</h3><small>'+E(via)+'</small></div>'+status+'</header><p>'+E(a.value)+'</p><button type="button" class="hub-btn'+(attention||key===rec?' primary':'')+'" data-hub-area="'+key+'">'+(attention?'Fix':done?'Manage':'Set up')+'</button></article>'},connectors=ORDER.map(card).join('')+'<h3 class="hub-more">More sources</h3>'+MORE.map(card).join('')
const plugins=PLUGINS.filter(p=>!p.page||$('page-'+p.page)).map(p=>{const missing=p.any?(anySaved()?[]:['any']):p.needs.filter(k=>!saved(k)),ready=!missing.length
 const req=p.any?'<span class="hub-req'+(ready?' ok':'')+'">'+(ready?'✓ ':'')+'Uses any saved source</span>':p.needs.map(k=>'<span class="hub-req'+(saved(k)?' ok':'')+'">'+(saved(k)?'✓ ':'Needs ')+E(AREAS[k].name)+'</span>').join('')
 return '<article class="hub-card" data-hub-search="'+E((p.name+' '+p.copy).toLowerCase())+'"><header><span class="hub-mark small plugin" aria-hidden="true">'+icon('spark')+'</span><div><h3>'+E(p.name)+'</h3><small>Plugin · read-only</small></div></header><p>'+E(p.copy)+'</p><div class="hub-reqs">'+req+'</div><button type="button" class="hub-btn'+(ready?' primary':'')+'" data-hub-plugin="'+p.id+'"'+(ready?'':' data-hub-needs="'+(p.any?ORDER.find(k=>!saved(k))||'books':missing[0])+'"')+'>'+(ready?'Open':'Set up '+E(p.any?'a source':AREAS[missing[0]].name))+'</button></article>'}).join('')
d.innerHTML='<header class="hub-head"><span class="hub-mark" aria-hidden="true">'+icon('spark')+'</span><div><small>'+E(name.toUpperCase())+' · '+progress+' OF '+ORDER.length+' AREAS SET UP</small><h2 id="fran-hub-title">Connectors & plugins</h2><p>Connectors bring sources into this Wallet. Plugins are the tools that put those sources to work. Everything is read-only and scoped to this location.</p></div><button type="button" class="hub-close" aria-label="Close">×</button></header>'+
 '<div class="hub-progress" aria-hidden="true"><i style="width:'+Math.round(progress/ORDER.length*100)+'%"></i></div>'+
 '<div class="hub-tabs" role="tablist"><button type="button" role="tab" id="hub-tab-connectors" aria-controls="hub-panel-connectors" data-hub-tab="connectors">Connectors</button><button type="button" role="tab" id="hub-tab-plugins" aria-controls="hub-panel-plugins" data-hub-tab="plugins">Plugins</button><label class="hub-search"><span class="sr">Search</span><input type="search" placeholder="Search payroll, insurance, QuickBooks…" data-hub-filter></label></div>'+
 '<div class="hub-body"><div class="hub-grid" role="tabpanel" id="hub-panel-connectors" aria-labelledby="hub-tab-connectors">'+connectors+'</div><div class="hub-grid" role="tabpanel" id="hub-panel-plugins" aria-labelledby="hub-tab-plugins">'+plugins+'</div><p class="hub-empty" hidden role="status">Nothing matches. Try “bank”, “policy” or “report”.</p></div>'+
 '<footer class="hub-foot"><span class="hub-foot-note">Not sure where to start? Most owners begin with accounting or payroll.</span><button type="button" class="hub-btn" data-hub-later>Close</button></footer>'
const select=t=>{d.querySelectorAll('[data-hub-tab]').forEach(b=>{const on=b.dataset.hubTab===t;b.setAttribute('aria-selected',on);b.tabIndex=on?0:-1});d.querySelectorAll('[role=tabpanel]').forEach(p=>p.hidden=p.id!=='hub-panel-'+t);filter()}
const filter=()=>{const q=d.querySelector('[data-hub-filter]').value.trim().toLowerCase(),panel=d.querySelector('[role=tabpanel]:not([hidden])');let n=0;panel.querySelectorAll('.hub-card').forEach(c=>{const m=!q||c.dataset.hubSearch.includes(q);c.hidden=!m;n+=m});d.querySelector('.hub-empty').hidden=!!n}
d.querySelectorAll('[data-hub-tab]').forEach(b=>{b.onclick=()=>select(b.dataset.hubTab);b.onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){const other=d.querySelector('[data-hub-tab]:not([aria-selected=true])');select(other.dataset.hubTab);other.focus()}}})
d.querySelector('[data-hub-filter]').oninput=filter
d.querySelector('.hub-close').onclick=()=>d.close();d.querySelector('[data-hub-later]').onclick=()=>d.close()
d.querySelectorAll('[data-hub-area]').forEach(b=>b.onclick=()=>openArea(b.dataset.hubArea,'directory'))
d.querySelectorAll('[data-hub-plugin]').forEach(b=>b.onclick=()=>{if(b.dataset.hubNeeds)return openArea(b.dataset.hubNeeds,'plugin');const p=PLUGINS.find(x=>x.id===b.dataset.hubPlugin);metric('plugin_opened',{plugin:p.id});closeThen(p.open)})
select(tab);show(d,'[data-hub-tab][aria-selected=true]')
metric('connector_directory_opened',{tab,trigger,areas_saved:progress})}

/* Area hero: what an empty Accounting, Payroll, Insurance or Finance page leads with. */
const HERO={books:'books',payroll:'payroll',insurance:'insurance',banking:'banking',company:'company',documents:'files'}
function heroes(){for(const [route,key] of Object.entries(HERO)){const page=$('page-'+route);if(!page)continue;let box=page.querySelector('.hub-hero')
 if(!owned()||readyWallet!==state?.wallet?.id||saved(key)){box?.remove();page.classList.remove('hub-hero-on');continue}
 const a=AREAS[key],c=a.connect[0],manual=c&&health(c.connector)?.state==='manual',name=state.wallet.name||'this location'
 if(!box){box=document.createElement('section');box.className='hub-hero'}
 const head=page.querySelector('.wallet-heading')||page.querySelector('.main-hdr');if(head&&head.nextElementSibling!==box)head.after(box);else if(!head&&page.firstElementChild!==box)page.prepend(box)
 page.classList.add('hub-hero-on')
 const primary=a.primary?'<button type="button" class="hub-btn primary" data-hero="primary">'+E(a.primary.label)+'</button>':c&&!manual?'<button type="button" class="hub-btn primary" data-hero="connect" data-connector="'+E(c.connector)+'">Connect '+E(c.name)+'</button>':'<button type="button" class="hub-btn primary" data-hero="file">'+E(a.file.label)+'</button>'
 box.innerHTML='<div class="hub-hero-main"><span class="hub-mark" aria-hidden="true">'+icon(key)+'</span><div><small>'+E(a.name.toUpperCase())+' · NOT SET UP YET</small><h2>'+(a.heroTitle?E(a.heroTitle):'Bring '+E(a.noun)+' into '+E(name))+'</h2><p>'+E(a.value)+'</p><div class="hub-unlock bare">'+a.unlock.map(u=>'<span>'+E(u)+'</span>').join('')+'</div></div></div><div class="hub-hero-actions">'+primary+(a.invite?'<button type="button" class="hub-btn" data-hero="invite">'+E(a.invite.label)+' <em>Free</em></button>':'')+(a.help?'<button type="button" class="hub-btn" data-hero="help">'+E(a.help.label)+'</button>':'')+'<button type="button" class="hub-link" data-hero="all">All options →</button></div>'+(manual?'<p class="hub-hero-note">Live '+E(c.name)+' access isn’t enabled yet. Add a report from '+E(c.name)+' to start now.</p>':'')
 box.querySelectorAll('[data-hero]').forEach(b=>b.onclick=()=>b.dataset.hero==='all'?openArea(key,'hero'):perform(key,b.dataset.hero,b.dataset.connector))}}
/* Sidebar entry: a quiet progress pill that opens the directory. */
function sidebarEntry(){const nav=$('release-nav')||document.querySelector('#view-wallet .sidebar nav, #view-wallet .sidebar');if(!nav)return
let b=$('fran-hub-nav');if(!owned()){b?.remove();return}
if(!b){b=document.createElement('button');b.type='button';b.id='fran-hub-nav';b.className='nav-item release-nav fran-hub-nav';b.onclick=()=>openDirectory('connectors','sidebar');const settings=nav.querySelector('[data-page=settings]');settings?settings.before(b):nav.append(b)}
const n=ORDER.filter(saved).length
b.innerHTML='<span>Connectors</span><small aria-label="'+n+' of '+ORDER.length+' areas set up">'+n+'/'+ORDER.length+'</small>'}

/* Page guides: a "How this page works" tooltip in each page header. Shown once per member and page, then on demand. */
const GUIDES={
 dashboard:['Home','Your setup progress and the next useful step live here.','Each finding shows its source and date.','Questions about saved records? Use Ask your Wallet.'],
 ask:['Ask your Wallet','Ask about this location’s saved records.','Type /setup anytime to continue setup.','Answers cite their sources and reporting dates.'],
 books:['Accounting','Connect QuickBooks or upload a P&L to fill this page.','Every number shows its reporting period.','Invite your accountant to keep it current.'],
 payroll:['Payroll','Connect Gusto or import a report from any provider.','See employer cost, hours and labor-to-sales by pay period.','Fran reads payroll. It never runs or changes it.'],
 insurance:['Insurance','Upload a policy or declarations page.','Fran pulls out coverage limits and renewal dates.','Your insurer confirms coverage. Fran only organizes it.'],
 banking:['Finance','Connect accounts through Plaid or upload statements.','See balances and activity by account.','Fran can’t move money or see your bank login.'],
 company:['Company','Keep the legal entity, owners and key dates together.','Upload formation documents to fill in details.','Deadlines appear once dates are saved.'],
 documents:['Data rooms','Store originals privately for this location.','Build a room to share selected files with a lender or buyer.','Nothing is shared until you publish and name recipients.'],
 services:['Support','Message your CoverPanda team about this location.','Requests start as drafts you can edit.','Nothing is sent until you press Send.']}
function guideSeenKey(r){return 'fran_page_guide:'+memberId()+':'+r}
function closeGuides(){document.querySelectorAll('.fran-page-guide[data-open]').forEach(g=>{g.removeAttribute('data-open');g.querySelector('button')?.setAttribute('aria-expanded','false')})}
function ensureGuide(r){const g=GUIDES[r],page=$('page-'+r);if(!g||!page||!owned())return null
const head=page.querySelector('.ask-heading')||page.querySelector('.wallet-heading')||page.querySelector('.main-hdr');if(!head)return null
let box=head.querySelector('.fran-page-guide');if(box)return box
box=document.createElement('span');box.className='fran-page-guide'
const id='fran-guide-'+r
box.innerHTML='<button type="button" aria-expanded="false" aria-controls="'+id+'"><span aria-hidden="true">?</span> How this page works</button><div class="fran-page-guide-pop" id="'+id+'" role="dialog" aria-label="How '+E(g[0])+' works"><strong>'+E(g[0])+'</strong><ol>'+g.slice(1).map(s=>'<li>'+E(s)+'</li>').join('')+'</ol><div><button type="button" data-guide-setup>Set up this area</button><button type="button" data-guide-close>Got it</button></div></div>'
const area=ROUTE_AREA[r],setupBtn=box.querySelector('[data-guide-setup]')
if(area)setupBtn.onclick=()=>{closeGuides();openArea(area,'guide')};else setupBtn.remove()
box.querySelector('button').onclick=e=>{e.stopPropagation();const open=!box.hasAttribute('data-open');closeGuides();if(open){box.setAttribute('data-open','');box.querySelector('button').setAttribute('aria-expanded','true');try{localStorage.setItem(guideSeenKey(r),'1')}catch(_){}metric('page_guide_shown',{route:r,trigger:'button'})}}
box.querySelector('[data-guide-close]').onclick=()=>{closeGuides();box.querySelector('button').focus()}
head.append(box);return box}
function maybeAutoGuide(r){const box=ensureGuide(r);if(!box||dialogOpen()||Date.now()<quietUntil)return
try{if(localStorage.getItem(guideSeenKey(r)))return;localStorage.setItem(guideSeenKey(r),'1')}catch(_){return}
closeGuides();box.setAttribute('data-open','');box.querySelector('button').setAttribute('aria-expanded','true');metric('page_guide_shown',{route:r,trigger:'first_visit'})}
document.addEventListener('click',e=>{if(!e.target.closest('.fran-page-guide'))closeGuides()})
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('.fran-page-guide[data-open]')){const b=document.querySelector('.fran-page-guide[data-open]>button');closeGuides();b?.focus()}})

/* After a goal is chosen, an empty area opens its setup sheet over the page, once per area per browser session. */
function onRoute(r){route=r;closeGuides();setTimeout(heroes,120)
setTimeout(()=>{if(route!==r)return
const key=ROUTE_AREA[r],ready=owned()&&readyWallet===state.wallet.id&&!!actions()?.profile?.()
if(key&&AUTO.includes(key)&&ready&&Date.now()>=quietUntil&&!saved(key)&&!sessionFlag('auto',key)&&!dialogOpen()){sessionFlag('auto',key,true);ensureGuide(r);return openArea(key,'page')}
maybeAutoGuide(r)},380)}
const prior=window.switchTab
if(prior)window.switchTab=function(name,...args){const out=prior.call(this,name,...args);onRoute(name);return out}

/* Route the older entry points on each page to the same sheet, so every "get started" button behaves alike. */
document.addEventListener('click',e=>{if(!owned())return
const t=e.target.closest('.fran-empty-start [data-start], [data-wallet-setup], [data-payroll-connect], #fran-onboarding [data-source], #fran-onboarding [data-open-library]');if(!t)return
let key=null
if(t.matches('[data-open-library]')){e.preventDefault();e.stopImmediatePropagation();return openDirectory('connectors','home')}
if(t.matches('[data-start]')){const page=t.closest('.page');key=ROUTE_AREA[page?.id?.replace('page-','')]}
else if(t.matches('[data-wallet-setup]'))key=SETUP_AREA[t.dataset.walletSetup]
else if(t.matches('[data-payroll-connect]'))key='payroll'
else if(t.matches('[data-source]'))key=SOURCE_AREA[t.dataset.source]
if(!key||!AREAS[key])return
e.preventDefault();e.stopImmediatePropagation();openArea(key,'page_button')},true)

window.addEventListener('fran:location',e=>{const same=state?.wallet?.id===e.detail?.wallet?.id;state=e.detail;if(!same){readyWallet=null;$('fran-hub')?.close();document.querySelectorAll('.fran-page-guide').forEach(g=>g.remove())}sidebarEntry();heroes()})
window.addEventListener('fran:readiness',e=>{if(e.detail?.location?.wallet?.id!==state?.wallet?.id)return;setTimeout(()=>{readyWallet=state?.wallet?.id||null;sidebarEntry();heroes();onRoute(route)},0)})
window.addEventListener('fran:health',()=>{sidebarEntry();setTimeout(heroes,0)})
window.addEventListener('fran:hub-closed',()=>{const r=route;if(GUIDES[r])setTimeout(()=>ensureGuide(r),0)})
window.FRAN_HUB={openArea,openDirectory,qboLive,quiet:(area,ms)=>{quietUntil=Date.now()+(ms||8000);if(area)sessionFlag('auto',area,true)},areas:()=>ORDER.map(k=>({id:k,name:AREAS[k].name,saved:saved(k)}))}
})()
