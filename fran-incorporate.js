/* Incorporate: the guided company setup in Company → Compliance & entity.
   Company → Owners → Taxes → Addresses → Review. Each step saves to the location's entity record through the lifecycle
   API. A confirmed setup is then sent to the formation team, who quote, file and post updates through the existing
   service request. Nothing here files with a state, charges a card or requests a tax election by itself. */
(()=>{'use strict';
const C=window.FranFormationCore;if(!C?.incorporationGaps)return;
const E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const metric=(n,p)=>{try{window.posthog?.capture(n,p)}catch(_){}}; /* step, path and counts only: never names or addresses */
const STATE_NAMES={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',PR:'Puerto Rico'};
const stateLabel=s=>STATE_NAMES[s]||(s==='unsure'?'Not sure yet':'Not chosen');
const STEPS=[['company','Company'],['owners','Owners'],['taxes','Taxes'],['addresses','Addresses'],['review','Review']];
const tag=(t,tone='')=>'<em class="finc-tag'+(tone?' is-'+tone:'')+'">'+E(t)+'</em>';
const STRUCTURES=[['LLC','LLC','Protects your personal assets from the business’s debts and lawsuits, with simple upkeep and flexible tax options. Works with money from friends and family and with bank or SBA loans.',tag('Most franchise owners','ok')],
 ['Corporation','Corporation','Mainly for raising money from institutional investors such as venture funds, which usually require one. Comes with a board, bylaws and more formal upkeep.'],
 ['Undecided','Not sure yet','Keep going. Most franchise owners choose an LLC; review will flag this so you can confirm it with your accountant or attorney.']];
const ELECTION_HELP={default:['Keep the default','The simplest start: nothing extra to file. You can request a different treatment later.',tag('Most new owners','ok')],
 s_corp:['Request S corporation treatment','Can lower self-employment tax once profits are steady, but you must run payroll and pay yourself a reasonable salary. Owners generally must be U.S. individuals. Filed separately with the IRS on Form 2553, which has a deadline.',tag('Separate IRS filing')],
 c_corp:['Request C corporation treatment','Rare for a single franchise location. Usually only when investors or a specific tax plan call for it. Filed separately with the IRS on Form 8832.',tag('Separate IRS filing')],
 undecided:['Decide later with my accountant','That’s fine. Review will flag it, and nothing is filed until you approve.']};
const support='<button type="button" class="finc-link finc-support" data-finc-support>Questions? Message your formation team</button>';
const memory=new Map(); /* wallet id → working state, so a lifecycle re-render never loses unsaved input */
const draftKey=id=>'fran-incorporate-draft:'+id;
let host=null,ctx=null,st=null,busy=false,pendingFocus=null,typingTimer=null;

/* ---------- state ---------- */
function fromRecord(e,wallet){const j=C.normalizeJourney(e.formation_journey)||C.normalizeJourney({}),inc=j.incorporation||C.normalizeIncorporation({});
 const path=j.path==='existing'||e.stage==='existing'?'existing':j.path==='help'?'help':j.path==='new'?'new':'';
 let name=String(e.name||''),ending=inc.ending;if(ending&&name.toLowerCase().endsWith(' '+ending.toLowerCase()))name=name.slice(0,-(ending.length+1));else if(ending&&name)ending='';
 const owners=Array.isArray(e.owners)&&e.owners.length?e.owners.map(o=>({name:o.name||'',percentage:o.percentage??''})):[{name:'',percentage:''}];
 return {path,step:inc.step,inc,journey:j,details:{base:name,dba:e.dba||'',jurisdiction:e.jurisdiction||(j.jurisdiction_unsure?'unsure':'')||(path==='existing'?'':wallet.state||''),entity_type:['LLC','Corporation'].includes(e.entity_type)?e.entity_type:(path?'Undecided':''),owners,physical_address:e.physical_address||'',mailing_address:e.mailing_address||''},
  errors:{},message:'',error:false,dirty:false,serverAt:Date.parse(j.updated_at)||0,serverSig:JSON.stringify([e.name||'',e.dba||'',e.jurisdiction||'',e.entity_type||'',e.owners||[],e.physical_address||'',e.mailing_address||'',e.stage||''])};}
const compose=base=>{const b=String(base||'').trim(),end=st.inc.ending;return b&&end&&!b.toLowerCase().endsWith(end.toLowerCase())?b+' '+end:b;};
const legalName=d=>compose(d.base);
const facts=()=>({name:legalName(st.details),entity_type:st.details.entity_type,jurisdiction:st.details.jurisdiction,owners:st.details.owners,physical_address:st.details.physical_address,mailing_address:st.inc.mailing_same?st.details.physical_address:st.details.mailing_address});
const confirmed=()=>!!st.inc.confirmed_fingerprint&&st.inc.confirmed_fingerprint===C.incorporationFingerprint(facts(),st.inc);
const changedSinceConfirm=()=>!!st.inc.confirmed_fingerprint&&!confirmed();
function writeDraft(){try{localStorage.setItem(draftKey(ctx.wallet.id),JSON.stringify({at:Date.now(),path:st.path,step:st.step,inc:st.inc,details:st.details}))}catch(_){}}
function readDraft(id){try{const d=JSON.parse(localStorage.getItem(draftKey(id))||'null');return d&&typeof d==='object'&&d.details&&typeof d.details==='object'?d:null}catch(_){return null}}
const clearDraft=id=>{try{localStorage.removeItem(draftKey(id))}catch(_){}};

/* ---------- formation team hand-off ---------- */
/* The request lives in the existing service pipeline (service-commerce): the server rebuilds the confirmed setup from the
   saved record, opens the team's ticket, and carries the quote, payment and delivery updates. */
const team=new Map(); /* wallet id → {state:'loading'|'ready'|'error', engagement, canSend} */
let sending=false;
async function serviceApi(action,body={}){if(typeof sb==='undefined'||typeof SUPABASE_URL==='undefined')throw Error('Sign in again to continue.');
 const {data:{session}}=await sb.auth.getSession();if(!session)throw Error('Sign in again to continue.');
 const r=await fetch(SUPABASE_URL+'/functions/v1/service-commerce',{method:'POST',headers:{'Content-Type':'application/json',apikey:typeof SUPABASE_ANON_KEY==='undefined'?'':SUPABASE_ANON_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify({action,wallet_id:ctx.wallet.id,...body})});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Please retry.');return d;}
async function loadTeam(force=false){const id=ctx?.wallet?.id,prev=team.get(id);if(!id||(!force&&prev&&prev.state!=='error'))return;
 team.set(id,{...prev,state:prev?.state==='ready'?'ready':'loading'});
 try{const r=await serviceApi('load');team.set(id,{state:'ready',engagement:(r.engagements||[]).find(e=>e.service==='entity')||null,canSend:r.can_purchase===true});}
 catch(e){team.set(id,{...prev,state:'error',message:e.message});}
 if(ctx?.wallet?.id===id)render();}
const teamOf=()=>team.get(ctx?.wallet?.id)||{state:'idle'};
function request(){const e=teamOf().engagement;if(!e)return null;const sent=e.intake?.setup||null;return {e,status:e.status,sent,stale:!!sent&&confirmed()&&sent.fingerprint!==st.inc.confirmed_fingerprint};}
const STATUS_PHASE={scope_review:'preparing',proposal_ready:'quote',onboarding:'filing',active:'done',past_due:'payment',canceled:'ended'};
/* Where the company is: confirm → send → preparing → quote → filing → done (or resend / locked after a change). */
function phase(){const r=request(),t=teamOf();
 if(r&&!(!r.sent&&r.status==='scope_review')){if(!r.sent)return 'locked';if(r.stale)return r.status==='scope_review'?'resend':'locked';return STATUS_PHASE[r.status]||'preparing';}
 if(!confirmed())return 'confirm';
 if(t.state==='idle'||t.state==='loading')return 'checking';
 return t.state==='error'?'unknown':'send';}
const sentDate=()=>{const s=request()?.e;return s?new Date(s.updated_at||s.created_at).toLocaleDateString('en-US',{month:'long',day:'numeric'}):'';};
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n/100);
async function send(){if(sending||busy)return;read();if(!confirmed())return;sending=true;st.error=false;st.message='Sending to your formation team…';render();
 try{if(st.dirty&&!await persist())return;
  const r=await serviceApi('start',{selection:'entity_formation',consent:true,intake:{}});
  st.message=r.locked?'Your team already prepared a quote from the details you sent earlier. Message them about the change.':r.updated?'Updated details sent. Your team will quote from these.':r.existing?'Your formation team already has these details.':'Sent. Your formation team will check the name and prepare your quote.';
  metric('incorporate_sent_to_team',{updated:!!r.updated,locked:!!r.locked});pendingFocus='#finc-heading';await loadTeam(true);}
 catch(e){st.error=true;st.message='Not sent yet: '+(e.message||'Please retry.')+' Your confirmed details are saved.';pendingFocus='#finc-status';}
 finally{sending=false;render();}}
const openRequest=()=>dispatchEvent(new CustomEvent('fran:service-open',{detail:{service:'entity'}}));

/* ---------- saving ---------- */
function patch(){const d=st.details,f=facts(),now=new Date().toISOString(),stage=st.path==='existing'?'existing':'planning';
 const owners=d.owners.filter(o=>String(o.name||'').trim()).map(o=>({name:String(o.name).trim(),percentage:o.percentage===''||o.percentage===null?null:Number(o.percentage)}));
 return {name:f.name,dba:String(d.dba||'').trim(),jurisdiction:STATE_NAMES[d.jurisdiction]?d.jurisdiction:'',entity_type:['LLC','Corporation'].includes(d.entity_type)?d.entity_type:'Undecided',owners,
  physical_address:String(d.physical_address||'').trim(),mailing_address:String(f.mailing_address||'').trim(),stage,
  formation_journey:{...st.journey,path:st.path||'',step:st.step==='review'?'review':'prepare',jurisdiction_unsure:d.jurisdiction==='unsure',incorporation:{...st.inc,step:st.step},updated_at:now}};}
/* Saves run one at a time. A save asked for while one is in flight waits for it, then sends the latest answers. */
let inflight=null;
async function persist(message){while(inflight)await inflight.catch(()=>{});inflight=save(message);try{return await inflight}finally{inflight=null}}
async function save(message){const s=st,id=ctx.wallet.id;busy=true;s.message='Saving…';s.error=false;render();
 try{const body=patch(),r=await ctx.save(body);if(r?.stale)return false;s.dirty=false;clearTimeout(s.draftTimer);s.journey={...s.journey,...body.formation_journey};s.serverAt=Date.parse(body.formation_journey.updated_at);clearDraft(id);s.message=message||'Saved to '+ctx.wallet.name+'.';return true;}
 catch(e){s.error=true;s.message='Not saved yet: '+(e.message||'Please retry.')+' Your answers are kept on this device.';try{localStorage.setItem(draftKey(id),JSON.stringify({at:Date.now(),path:s.path,step:s.step,inc:s.inc,details:s.details}))}catch(_){}pendingFocus='#finc-status';return false;}
 finally{busy=false;memory.set(id,s);if(ctx.wallet.id===id&&host?.isConnected)render();}}

/* ---------- views ---------- */
const pill=(text,tone='')=>'<span class="finc-pill'+(tone?' is-'+tone:'')+'">'+E(text)+'</span>';
const field=(id,label,input,{hint='',err=''}={})=>'<div class="finc-field'+(err?' has-error':'')+'"><label for="finc-'+id+'">'+label+'</label>'+(hint?'<small id="finc-'+id+'-hint">'+hint+'</small>':'')+input+(err?'<p class="finc-error" id="finc-'+id+'-error">'+E(err)+'</p>':'')+'</div>';
const described=(id,{hint,err})=>{const ids=[hint?'finc-'+id+'-hint':'',err?'finc-'+id+'-error':''].filter(Boolean).join(' ');return (ids?' aria-describedby="'+ids+'"':'')+(err?' aria-invalid="true"':'');};
const text=(id,value,opts={})=>field(id,opts.label,'<input id="finc-'+id+'" name="'+id+'" type="text" autocomplete="'+(opts.auto||'off')+'" maxlength="'+(opts.max||180)+'" value="'+E(value)+'"'+(opts.placeholder?' placeholder="'+E(opts.placeholder)+'"':'')+described(id,opts)+'>',opts);
const radios=(name,items,value,legend,{err='',hint=''}={})=>'<fieldset class="finc-choices'+(err?' has-error':'')+'"'+(err?' aria-describedby="finc-'+name+'-error"':'')+'><legend>'+legend+'</legend>'+(hint?'<p class="finc-hint">'+hint+'</p>':'')+items.map(([v,l,sub,tag])=>'<label class="finc-choice"><input type="radio" name="'+name+'" value="'+E(v)+'"'+(v===value?' checked':'')+'><span><strong>'+E(l)+(tag?' '+tag:'')+'</strong>'+(sub?'<small>'+E(sub)+'</small>':'')+'</span></label>').join('')+(err?'<p class="finc-error" id="finc-'+name+'-error">'+E(err)+'</p>':'')+'</fieldset>';
function errorSummary(){const errs=Object.entries(st.errors);if(!errs.length)return '';return '<div class="finc-summary" role="alert" tabindex="-1" id="finc-error-summary"><b>Fix '+(errs.length===1?'this':'these '+errs.length)+' to continue</b><ul>'+errs.map(([k,m])=>'<li><a href="#finc-'+E(k)+'">'+E(m)+'</a></li>').join('')+'</ul></div>';}

function intro(){const w=E(ctx.wallet.name);return '<div class="finc-intro"><p class="finc-eyebrow">Company setup · about 5 minutes</p><h2 id="finc-heading" tabindex="-1">Set up the company behind '+w+'</h2><p class="finc-lede">Your company comes first: your EIN, bank account, lease and insurance are all opened in its name. FranWallet walks you through it and helps you get it right the first time.</p>'
 +'<div class="finc-paths" role="group" aria-label="Where are you starting?">'
 +'<button type="button" class="finc-path is-primary" data-finc-path="new"><strong>Start a new company</strong><small>Set up an LLC or corporation, step by step</small><span aria-hidden="true">→</span></button>'
 +'<button type="button" class="finc-path" data-finc-path="existing"><strong>I already have a company</strong><small>Record it once; no duplicate filing</small><span aria-hidden="true">→</span></button>'
 +'<button type="button" class="finc-path" data-finc-path="help"><strong>I’m not sure yet</strong><small>Start preparing; open questions are flagged, not blocking</small><span aria-hidden="true">→</span></button></div>'
 +'<h3 class="finc-how-title">How it works</h3><ol class="finc-how"><li><b>Answer five short sections.</b> Each choice is explained in plain language, with what fits most franchise owners.</li><li><b>Review your company profile.</b> We flag anything missing or inconsistent before it can hold up your filing.</li><li><b>Send it to your formation team.</b> They check the name with the state and send you one quote. Nothing is filed or charged until you accept it.</li></ol>'
 +'<p class="finc-truth"><b>Good to know:</b> your answers save after every step. Stop any time and pick up from your wallet’s Home.</p>'+support+'</div>';}

function stepper(){const gaps=C.incorporationGaps(facts(),st.inc),open=new Set(gaps.map(g=>g[0])),i=STEPS.findIndex(s=>s[0]===st.step);
 return '<nav class="finc-steps" aria-label="Company setup steps"><p class="finc-steps-count">Step '+(i+1)+' of '+STEPS.length+' · '+STEPS[i][1]+'</p><ol>'+STEPS.map(([k,l],n)=>{const cur=k===st.step,state=cur?'current':k==='review'?(confirmed()?'done':''):(n<i||st.visited?.[k])?(open.has(k)?'open':'done'):'';
  return '<li class="is-'+(state||'todo')+'"><button type="button" data-finc-step="'+k+'"'+(cur?' aria-current="step"':'')+'><span class="finc-dot" aria-hidden="true">'+(state==='done'?'✓':n+1)+'</span><span>'+l+(state==='open'?'<small>Needs a decision</small>':'')+'</span></button></li>';}).join('')+'</ol></nav>';}

function sidecard(){const f=facts(),tax=C.defaultTax(f.entity_type,f.owners),total=C.ownershipTotal(f.owners),owners=f.owners.filter(o=>String(o.name||'').trim());
 const row=(l,v,muted)=>'<div><dt>'+l+'</dt><dd'+(muted?' class="is-muted"':'')+'>'+E(v)+'</dd></div>';
 return '<aside class="finc-card" aria-label="Your company so far"><p class="finc-card-mark">YOUR COMPANY</p><p class="finc-card-name">'+E(f.name||'Name not chosen')+'</p><dl>'
  +row('Structure',f.entity_type&&f.entity_type!=='Undecided'?f.entity_type:'Not sure yet',!f.entity_type||f.entity_type==='Undecided')
  +row('Formation state',stateLabel(f.jurisdiction),!STATE_NAMES[f.jurisdiction])
  +row('Owners',owners.length?owners.length+(owners.length===1?' owner':' owners')+(total!==null?' · '+total+'%':''):'None added',!owners.length)
  +row('Taxes',st.inc.tax_election==='default'?tax.label+' (default)':st.inc.tax_election==='undecided'?'Not decided yet':C.ELECTIONS[st.inc.tax_election].replace('Request ','')+' · not submitted',st.inc.tax_election==='undecided')
  +row('Registered agent',st.inc.agent==='own'?(st.inc.agent_name||'Name needed'):st.inc.agent==='service'?'Registered agent service':'Decide later',st.inc.agent==='later')
  +'</dl><p class="finc-card-foot">'+cardStatus()+'</p></aside>';}
const CARD={preparing:['With your formation team','attn'],quote:['Quote ready','attn'],filing:['Accepted · being filed','attn'],done:['Marked complete','ok'],payment:['Payment needs attention','attn'],ended:['Request ended',''],resend:['Updated details to send','attn'],locked:['Changed after your quote','attn']};
const cardStatus=()=>{const c=st.path&&st.path!=='existing'&&CARD[phase()];return c?pill(c[0],c[1]):confirmed()?pill('Details confirmed','ok'):pill('Draft · nothing filed');};

function companyStep(){const d=st.details,e=st.errors,endings=C.ENDINGS[d.entity_type]||[],existing=st.path==='existing';
 if(endings.length&&!endings.includes(st.inc.ending))st.inc.ending=endings[0];if(!endings.length)st.inc.ending='';
 return '<h3 id="finc-heading" tabindex="-1">'+(existing?'Your company':'Name and structure')+'</h3><p class="finc-sub">'+(existing?'Use the details on your formation documents.':'The state checks that your name is available when the filing is submitted. Give us a backup and we can use it right away if your first choice is taken.')+'</p>'
 +'<div class="finc-name-row">'+text('name',d.base,{label:existing?'Legal name':'Company name · first choice',hint:existing?'Exactly as it appears on your formation documents.':'The legal name the state registers. Not your wallet nickname.',err:e.name,placeholder:existing?'':'For example, Rivera Family Foods'})
 +(endings.length?field('ending','Ending','<select id="finc-ending" name="ending">'+endings.map(x=>'<option'+(x===st.inc.ending?' selected':'')+'>'+E(x)+'</option>').join('')+'</select>'):'')+'</div>'
 +(existing?'':text('name_backup',st.inc.name_backup,{label:'Backup name <span class="finc-opt">(optional)</span>',hint:'Used only if your first choice isn’t available.',placeholder:'For example, Rivera Hospitality'}))
 +(d.base&&endings.length?'<p class="finc-preview">Registered as <b>'+E(legalName(d))+'</b>'+(st.inc.name_backup&&!existing?', or <b>'+E(compose(st.inc.name_backup))+'</b> if it’s taken':'')+'</p>':'')
 +radios('entity_type',existing?STRUCTURES.slice(0,2):STRUCTURES,d.entity_type,'Structure',{err:e.entity_type,hint:existing?'':'Not legal advice. If something about your situation is unusual, ask the FranWallet team or your attorney.'})
 +field('jurisdiction','Formation state','<select id="finc-jurisdiction" name="jurisdiction"'+described('jurisdiction',{hint:1,err:e.jurisdiction})+'><option value="">Choose a state</option>'+(existing?'':'<option value="unsure"'+(d.jurisdiction==='unsure'?' selected':'')+'>Not sure yet</option>')+Object.entries(STATE_NAMES).map(([k,v])=>'<option value="'+k+'"'+(k===d.jurisdiction?' selected':'')+'>'+v+'</option>').join('')+'</select>',{hint:'Usually the state where '+E(ctx.wallet.name)+' operates'+(ctx.wallet.state&&STATE_NAMES[ctx.wallet.state]?' ('+STATE_NAMES[ctx.wallet.state]+')':'')+'. Forming somewhere else typically means registering in your operating state as well, with a second set of fees.',err:e.jurisdiction})
 +'<fieldset class="finc-dba"><legend>DBA <span class="finc-opt">(optional)</span></legend><p class="finc-hint">The name customers see, if it’s different from your legal name, like your brand and city. A DBA (“doing business as”) is registered separately from the company.</p><div class="finc-pair">'
 +text('dba',d.dba,{label:'First choice',max:180,placeholder:'For example, Jersey Mike’s Austin'})+text('dba_backup',st.inc.dba_backup,{label:'Backup',max:180})+'</div></fieldset>';}

function ownersStep(){const d=st.details,total=C.ownershipTotal(d.owners),n=d.owners.filter(o=>String(o.name||'').trim()).length;
 return '<h3 id="finc-heading" tabindex="-1">Who owns the company?</h3><p class="finc-sub">List the legal owners and their share. A spouse, manager or advisor is not an owner unless they hold a share.</p>'
 +'<div class="finc-owners">'+d.owners.map((o,i)=>{const err=st.errors['owner_'+i];return '<div class="finc-owner'+(err?' has-error':'')+'"><div class="finc-field"><label for="finc-owner_'+i+'">Owner '+(i+1)+' name</label><input id="finc-owner_'+i+'" data-owner="'+i+'" data-key="name" type="text" maxlength="180" autocomplete="off" value="'+E(o.name)+'"'+(err?' aria-invalid="true" aria-describedby="finc-owner_'+i+'-error"':'')+'></div><div class="finc-field finc-pct"><label for="finc-owner_pct_'+i+'">Share</label><span class="finc-pct-wrap"><input id="finc-owner_pct_'+i+'" data-owner="'+i+'" data-key="percentage" type="number" inputmode="decimal" min="0" max="100" step="0.01" value="'+E(o.percentage)+'"><span aria-hidden="true">%</span></span></div>'+(d.owners.length>1?'<button type="button" class="finc-link" data-finc-remove="'+i+'">Remove<span class="finc-sr"> owner '+(i+1)+'</span></button>':'')+(err?'<p class="finc-error" id="finc-owner_'+i+'-error">'+E(err)+'</p>':'')+'</div>';}).join('')+'</div>'
 +(d.owners.length<20?'<button type="button" class="btn btn-ghost finc-add" data-finc-add-owner>Add another owner</button>':'')
 +'<p class="finc-total'+(total===100?' is-ok':n?' is-warn':'')+'" aria-live="polite">'+(n?total===null?'Add a share for each owner.':'Total '+total+'%'+(total===100?' ✓':' · shares should add up to 100%'):'Add at least one owner to continue to review.')+'</p>';}

function taxesStep(){const f=facts(),tax=C.defaultTax(f.entity_type,f.owners),allowed=C.electionsFor(f.entity_type),v=allowed.includes(st.inc.tax_election)?st.inc.tax_election:'undecided';
 return '<h3 id="finc-heading" tabindex="-1">How the company is taxed</h3><p class="finc-sub">Forming the company and choosing how it’s taxed are separate decisions, and this one can change later. Most new owners keep the default and revisit it with their accountant once the business is profitable.</p>'
 +'<div class="finc-default"><p class="finc-eyebrow">Your default, based on your answers</p><p class="finc-default-v">'+E(tax.label)+'</p><p>'+E(tax.note)+'</p></div>'
 +(f.entity_type==='Undecided'||!f.entity_type?'<p class="finc-note">Choose LLC or corporation on the Company step to see your options.</p>':'')
 +radios('tax_election',allowed.map(k=>[k,ELECTION_HELP[k][0],ELECTION_HELP[k][1],ELECTION_HELP[k][2]||'']),v,'What would you like to do?',{err:st.errors.tax_election})
 +(v==='s_corp'||v==='c_corp'?'<p class="finc-truth"><b>Not submitted.</b> This records your choice for your accountant and your review. The election is a separate IRS filing made after the company exists; FranWallet doesn’t file it.</p>':'')
 +'<p class="finc-note">General information, not tax advice.</p>';}

function addressesStep(){const d=st.details,i=st.inc;
 return '<h3 id="finc-heading" tabindex="-1">Addresses</h3><p class="finc-sub">Three different jobs. Keeping them separate means legal notices, customers and mail each reach the right place.</p>'
 +'<section class="finc-block"><h4>Registered agent</h4><p class="finc-hint">Every state requires one before the company can be formed. The agent accepts lawsuits and official state notices for the company during business hours, and its address is listed on the public record.</p>'
 +'<ul class="finc-why"><li>Keeps your home address off the public record</li><li>Someone is always there to accept legal papers, so a deadline or court notice is never missed</li><li>Notices are passed to you, so nothing sits unopened at a store that hasn’t opened yet</li></ul>'
 +radios('agent',[['service','Registered agent service','A professional registered agent in your formation state, arranged by FranWallet. You’ll see the yearly price before you approve anything.',tag('Recommended','ok')],['own','I’ll name my own agent','You or someone you choose, with a street address in the formation state and available during business hours. That address becomes public.'],['later','Decide later','Review will flag it.']],i.agent,'Who will be the registered agent?',{err:st.errors.agent})
 +(i.agent==='own'?text('agent_name',i.agent_name,{label:'Registered agent name',err:st.errors.agent_name,max:120}):'')+'</section>'
 +'<section class="finc-block"><h4>Business address</h4>'+text('physical_address',d.physical_address,{label:'Where the business operates',hint:'The location’s street address, or where you run the business before it opens. Many states publish it.',auto:'street-address',max:300})+'</section>'
 +'<section class="finc-block"><h4>Mailing address</h4><label class="finc-check"><input type="checkbox" name="mailing_same"'+(i.mailing_same?' checked':'')+'> Same as the business address</label>'
 +(i.mailing_same?'':text('mailing_address',d.mailing_address,{label:'Mailing address',hint:'Where you want ordinary business mail.',max:300}))
 +'<label class="finc-check"><input type="checkbox" name="mail_interest"'+(i.mail_interest?' checked':'')+'> I’d like a business mailing address with mail forwarding</label>'
 +'<p class="finc-note">Useful if you work from home or want mail handled before the location opens. We’ll confirm availability and pricing with you before anything is set up. Some banks ask for a street address rather than a mail service.</p></section>';}

function reviewStep(){const f=facts(),gaps=C.incorporationGaps(f,st.inc),tax=C.defaultTax(f.entity_type,f.owners),ok=confirmed(),owners=f.owners.filter(o=>String(o.name||'').trim());
 const section=(step,title,rows)=>'<section class="finc-rv"><div class="finc-rv-head"><h4>'+title+'</h4><button type="button" class="finc-link" data-finc-step="'+step+'">Edit<span class="finc-sr"> '+title+'</span></button></div><dl>'+rows.map(([l,v])=>'<div><dt>'+l+'</dt><dd>'+v+'</dd></div>').join('')+'</dl></section>';
 const need=v=>'<span class="finc-need">'+E(v)+'</span>';
 const P=phase(),[title,sub]=ok?(HEADINGS[P]||HEADINGS.send)():['Review your company','Check everything once. Confirming saves an exact record of what you approved; it does not file or charge anything.'];
 return '<h3 id="finc-heading" tabindex="-1">'+E(title)+'</h3><p class="finc-sub">'+E(sub)+'</p>'
 +(changedSinceConfirm()?'<div class="finc-alert" role="status"><b>Details changed after you confirmed.</b> Review and confirm again.'+(request()?.sent?' Your formation team still has the version you sent on '+E(sentDate())+'.':'')+'</div>':'')
 +(gaps.length?'<div class="finc-gaps"><p><b>'+gaps.length+(gaps.length===1?' decision':' decisions')+' before you can confirm</b></p><ul>'+gaps.map(([s,l])=>'<li><button type="button" class="finc-link" data-finc-step="'+s+'">'+E(l)+'</button></li>').join('')+'</ul></div>':'')
 +section('company','Company',[['Legal name',f.name?E(f.name):need('Not chosen')],['Structure',f.entity_type&&f.entity_type!=='Undecided'?E(f.entity_type):need('Not sure yet')],['Formation state',STATE_NAMES[f.jurisdiction]?E(stateLabel(f.jurisdiction)):need('Not chosen')],...(st.inc.name_backup?[['Backup name',E(compose(st.inc.name_backup))]]:[]),['DBA',E([st.details.dba,st.inc.dba_backup].filter(Boolean).join(' · backup: ')||'None')]])
 +section('owners','Owners',owners.length?owners.map(o=>[E(o.name),o.percentage===''||o.percentage===null?need('Share missing'):E(o.percentage+'%')]):[['Owners',need('None added')]])
 +section('taxes','Taxes',[['Default treatment',E(tax.label)],['Your choice',st.inc.tax_election==='undecided'?need('Not decided yet'):E(C.ELECTIONS[st.inc.tax_election])],...(['s_corp','c_corp'].includes(st.inc.tax_election)?[['Election status',pill('Not submitted','attn')]]:[])])
 +section('addresses','Addresses',[['Registered agent',st.inc.agent==='later'?need('Decide later'):st.inc.agent==='own'?(st.inc.agent_name?E(st.inc.agent_name):need('Name needed')):'Registered agent service '+pill('Price shown before you approve')],['Business address',f.physical_address?E(f.physical_address):need('Not added')],['Mailing address',st.inc.mailing_same?'Same as business address':E(f.mailing_address||'Not added')],...(st.inc.mail_interest?[['Mailing address service','Requested · we’ll confirm options with you']]:[])])
 +'<section class="finc-rv"><h4>Costs</h4><table class="finc-costs"><tbody>'+[['State filing fee','Quote required'],['Formation service','Quote required'],...(st.inc.agent==='service'?[['Registered agent service, renews yearly','Quote required']]:[]),...(st.inc.mail_interest?[['Mailing address and forwarding','Confirmed with you first']]:[]),['Tax election filing','Not included'],...(quote()?[['Your quote',quote()]]:[])].map(([l,v])=>'<tr><th scope="row">'+l+'</th><td>'+E(v)+'</td></tr>').join('')+'</tbody></table><p class="finc-note">'+(quote()?'Your quote lists exactly what it covers. Review it before you accept.':'Prices come from your formation team’s quote. Nothing is charged until you accept it.')+'</p></section>'
 +(ok?'':'<div class="finc-confirm'+(st.errors.confirm?' has-error':'')+'"><label class="finc-check"><input type="checkbox" id="finc-confirm" name="confirm"'+(gaps.length?' disabled':'')+(st.errors.confirm?' aria-invalid="true" aria-describedby="finc-confirm-error"':'')+'> I confirm these details are correct and I’m authorized to prepare this company.</label>'+(st.errors.confirm?'<p class="finc-error" id="finc-confirm-error">'+E(st.errors.confirm)+'</p>':'')+'</div>')
 +nextSteps(ok);}

const HEADINGS={
 send:()=>['Your company is ready to send','You confirmed these details. Send them to your formation team for one quote. Change anything and you’ll confirm again.'],
 checking:()=>HEADINGS.send(),unknown:()=>HEADINGS.send(),
 preparing:()=>['Your formation team has your details','They’re checking the name with the state and preparing one quote. You’ll see it here when it’s ready.'],
 quote:()=>['Your quote is ready','Review what it covers and the price. Nothing is filed or charged until you accept it.'],
 filing:()=>['Your formation team is on it','You accepted the quote. They’ll post each step and your documents in your request.'],
 done:()=>['Your formation team marked this complete','Their updates and your documents are in your request.'],
 payment:()=>['Your payment needs attention','Open your request to update the payment.'],
 ended:()=>['Your formation request ended','Message your formation team if you want to start again.'],
 resend:()=>['Send your updated details','You changed and re-confirmed details after sending. Your team hasn’t quoted yet, so send them the update.'],
 locked:()=>['Tell your team about the change','Your team is working from the details you sent on '+sentDate()+'. Message them about what changed.']};
const quote=()=>{const p=request()?.e?.proposal;return p&&Number.isSafeInteger(p.amount)?money(p.amount)+(p.interval==='once'?' one time':' / '+p.interval):'';};
function nextSteps(ok){const row=(who,what,status,tone)=>'<li><span class="finc-who">'+who+'</span><span class="finc-what">'+what+'</span>'+pill(status,tone)+'</li>';
 const P=phase(),at=['confirm','send','preparing','quote','filing','done'].indexOf(['checking','unknown','resend','locked'].includes(P)?'send':P==='payment'?'quote':P==='ended'?'confirm':P),past=i=>at>i;
 const step=(i,upNext='Up next')=>past(i)?['Done','ok']:at===i?[upNext,'attn']:['Not started',''];
 return '<section class="finc-rv finc-next"><h4>What happens next</h4><ol>'
  +row('You','Confirm your company details',...(ok||past(0)?['Done','ok']:['Up next','']))
  +row('You','Send it to your formation team',...(P==='resend'?['Send the update','attn']:P==='locked'?['Message your team','attn']:step(1)))
  +row('Formation team','Check the name with the state and prepare one quote',...step(2,'In progress'))
  +row('You','Review and accept the quote',...(P==='payment'?['Needs attention','attn']:step(3)))
  +row('Formation team','File with the state and post each update here',...(P==='done'?['Marked complete','ok']:step(4,'In progress')))
  +row('You','EIN, operating agreement and business bank account','After approval')+'</ol></section>';}

function existingDone(){const f=facts();return '<h3 id="finc-heading" tabindex="-1">'+E(f.name)+' is on record</h3><p class="finc-sub">Saved as an existing company, so FranWallet won’t prepare a new formation for it.</p>'
 +'<div class="finc-next-actions"><button type="button" class="btn btn-primary" data-finc-open="record">Add EIN and owners</button><button type="button" class="btn btn-ghost" data-finc-open="dataroom">Store formation documents</button><button type="button" class="finc-link" data-finc-step="company">Edit company details</button></div>';}

function actions(){const i=STEPS.findIndex(s=>s[0]===st.step),last=st.step==='review';if(st.path==='existing'&&st.step==='review')return '';
 const primary=last?(confirmed()?teamAction():'<button type="button" class="btn btn-primary" data-finc-confirm'+(C.incorporationGaps(facts(),st.inc).length?' disabled':'')+'>Confirm details</button>'):'<button type="button" class="btn btn-primary" data-finc-next>'+(st.path==='existing'?'Save company':'Save and continue')+'</button>';
 return '<div class="finc-actions">'+primary+(i>0&&st.path!=='existing'?'<button type="button" class="btn btn-ghost" data-finc-step="'+STEPS[i-1][0]+'">Back</button>':'')+(last?'<button type="button" class="btn btn-ghost" data-finc-brief>Download summary</button>':'<button type="button" class="btn btn-ghost" data-finc-later>Save and finish later</button>')+'</div>'+support
  +(last&&confirmed()?teamNote():'');}
function teamAction(){const P=phase(),t=teamOf(),btn=(label,attr,extra='')=>'<button type="button" class="btn btn-primary" '+attr+extra+'>'+label+'</button>';
 if(['send','resend','unknown','checking'].includes(P)){const blocked=P==='checking'||sending||(t.state==='ready'&&!t.canSend);return btn(sending?'Sending…':P==='resend'?'Send the updated details':'Send to my formation team','data-finc-send',(blocked?' disabled':'')+' aria-describedby="finc-send-why"');}
 if(P==='locked'||P==='ended')return btn('Message my formation team','data-finc-message')+' <button type="button" class="btn btn-ghost" data-finc-request>View request</button>';
 return btn(P==='quote'?'Review your quote':'View request','data-finc-request');}
function teamNote(){const P=phase(),t=teamOf();
 if(!['send','resend','unknown','checking'].includes(P))return '';
 const why=t.state==='ready'&&!t.canSend?'Only the wallet owner can send this to the formation team.':'Your formation team checks the name with the state, then sends you one quote for the state fee, formation and any registered agent service. Nothing is filed or charged until you accept it.';
 return '<p class="finc-note" id="finc-send-why">'+why+'</p>'+(P==='unknown'?'<p class="finc-note">We couldn’t check whether you’ve already sent this. Sending again is safe; it never creates a second request. <button type="button" class="finc-link" data-finc-team-retry>Check again</button></p>':'');}

function render(){if(ctx&&st?.path&&st.path!=='existing'&&teamOf().state==='idle')loadTeam(); /* the request status, once per wallet */
 homeCard();if(!host?.isConnected)return;host.classList.add('finc');
 /* A re-render (often a lifecycle refresh after a save) must not take the field the owner is typing in. */
 const was=document.activeElement,keep=was&&was.id&&host.contains(was)?{id:was.id,start:was.selectionStart,end:was.selectionEnd}:null;
 const status='<p id="finc-status" class="finc-status'+(st.error?' is-error':'')+'" role="'+(st.error?'alert':'status')+'" tabindex="-1">'+E(st.message)+(st.error?' <button type="button" class="finc-link" data-finc-retry>Retry</button>':'')+'</p>';
 if(!st.path){host.innerHTML=intro()+status;bind();return;}
 const body=st.path==='existing'&&st.step==='review'?existingDone():({company:companyStep,owners:ownersStep,taxes:taxesStep,addresses:addressesStep,review:reviewStep})[st.step]();
 host.innerHTML='<div class="finc-top"><div><p class="finc-eyebrow">'+(st.path==='existing'?'Existing company':'Company setup')+' · '+E(ctx.wallet.name)+'</p></div><button type="button" class="finc-link" data-finc-path="">Change starting point</button></div>'
  +(st.path==='existing'?'':stepper())+'<div class="finc-layout"><form class="finc-main" id="finc-form" novalidate'+(busy?' aria-busy="true"':'')+'>'+errorSummary()+body+actions()+status+'</form>'+(st.path==='existing'?'':sidecard())+'</div>';
 bind();
 const target=pendingFocus&&host.querySelector(pendingFocus);if(target)target.focus({preventScroll:false});
 else if(keep){const el=document.getElementById(keep.id);if(el&&host.contains(el)){el.focus({preventScroll:true});try{if(keep.start!=null)el.setSelectionRange(keep.start,keep.end)}catch(_){}}}
 pendingFocus=null;}

/* ---------- input ---------- */
function read(form=host.querySelector('#finc-form')){if(!form)return;const d=st.details,i=st.inc,v=n=>form.elements[n]?.value;
 if(form.elements.name)d.base=v('name');if(form.elements.name_backup)i.name_backup=v('name_backup');if(form.elements.dba_backup)i.dba_backup=v('dba_backup');if(form.elements.mail_interest)i.mail_interest=form.elements.mail_interest.checked;if(form.elements.ending)i.ending=v('ending');if(form.elements.dba)d.dba=v('dba');if(form.elements.jurisdiction)d.jurisdiction=v('jurisdiction');
 const type=form.querySelector('[name=entity_type]:checked');if(type)d.entity_type=type.value;
 form.querySelectorAll('[data-owner]').forEach(el=>{const o=d.owners[+el.dataset.owner];if(o)o[el.dataset.key]=el.value;});
 const tax=form.querySelector('[name=tax_election]:checked');if(tax)i.tax_election=tax.value;
 const agent=form.querySelector('[name=agent]:checked');if(agent)i.agent=agent.value;if(form.elements.agent_name)i.agent_name=v('agent_name');
 if(form.elements.physical_address)d.physical_address=v('physical_address');if(form.elements.mailing_same)i.mailing_same=form.elements.mailing_same.checked;if(form.elements.mailing_address)d.mailing_address=v('mailing_address');}
function validate(step){read();const e=C.validateIncorporation(step,{...facts(),entity_type:st.details.entity_type},st.inc);
 if(step==='company'&&st.path==='existing'){if(!STATE_NAMES[st.details.jurisdiction])e.jurisdiction='Choose the state where the company was formed.';if(!['LLC','Corporation'].includes(st.details.entity_type))e.entity_type='Choose the structure on your formation documents.';}
 if(step==='company'&&!e.name&&!String(st.details.base||'').trim())e.name=st.path==='existing'?'Enter the legal name on your formation documents.':e.name;
 st.errors=e;return !Object.keys(e).length;}
async function goTo(step,{save=true}={}){read();st.visited={...(st.visited||{}),[st.step]:true};const from=st.step;st.step=step;st.errors={};pendingFocus='#finc-heading';metric('incorporate_step_viewed',{step,path:st.path});
 if(save&&st.dirty){const ok=await persist();if(!ok&&st.error){st.step=from;render();return;}}else render();}
function bind(){
 host.querySelectorAll('[data-finc-path]').forEach(b=>b.onclick=()=>{const p=b.dataset.fincPath;if(p===st.path)return;if(!p){st.path='';st.message='';render();pendingFocus='#finc-heading';return;}
  st.path=p;st.step='company';st.dirty=true;if(p!=='existing'&&!st.details.entity_type)st.details.entity_type='Undecided';if(p==='existing'&&st.details.jurisdiction==='unsure')st.details.jurisdiction='';metric('incorporate_path_selected',{path:p});pendingFocus='#finc-heading';
  /* An existing company is saved with its details (the record requires a legal name); a new one saves its place now. */
  if(p==='existing'){st.message='';render();return;}
  persist('Started. Your answers save as you go.');});
 host.querySelectorAll('[data-finc-step]').forEach(b=>b.onclick=()=>goTo(b.dataset.fincStep));
 host.querySelector('[data-finc-next]')?.addEventListener('click',async()=>{if(!validate(st.step)){pendingFocus='#finc-error-summary';render();return;}st.dirty=true;
  if(st.path==='existing'){st.visited={company:true};st.step='review';pendingFocus='#finc-heading';const ok=await persist('Saved as an existing company.');if(!ok&&st.error){st.step='company';render();}return;}
  const i=STEPS.findIndex(s=>s[0]===st.step);await goTo(STEPS[i+1][0]);});
 host.querySelector('[data-finc-confirm]')?.addEventListener('click',async()=>{read();const box=host.querySelector('#finc-confirm');if(!box?.checked){st.errors={confirm:'Tick the box to confirm these exact details.'};pendingFocus='#finc-confirm';render();return;}
  if(C.incorporationGaps(facts(),st.inc).length)return;const prev={...st.inc};st.inc.confirmed_fingerprint=C.incorporationFingerprint(facts(),st.inc);st.inc.confirmed_at=new Date().toISOString();st.dirty=true;st.errors={};pendingFocus='#finc-heading';metric('incorporate_confirmed',{owners:facts().owners.length});
  const ok=await persist('Details confirmed. Nothing was filed or charged.');if(!ok){st.inc.confirmed_fingerprint=prev.confirmed_fingerprint;st.inc.confirmed_at=prev.confirmed_at;render();}});
 host.querySelector('[data-finc-add-owner]')?.addEventListener('click',()=>{read();st.details.owners.push({name:'',percentage:''});st.dirty=true;pendingFocus='#finc-owner_'+(st.details.owners.length-1);render();});
 host.querySelectorAll('[data-finc-remove]').forEach(b=>b.onclick=()=>{read();st.details.owners.splice(+b.dataset.fincRemove,1);st.dirty=true;st.errors={};pendingFocus='#finc-owner_0';render();});
 host.querySelector('[data-finc-retry]')?.addEventListener('click',()=>persist());
 host.querySelector('[data-finc-later]')?.addEventListener('click',async()=>{read();st.dirty=true;const ok=await persist('Saved. Pick up where you left off from your wallet’s Home any time.');if(!ok)return;metric('incorporate_saved_for_later',{step:st.step});window.switchTab?.('dashboard');window.scrollTo?.(0,0);document.getElementById('finc-home-title')?.focus?.();});
 host.querySelectorAll('[data-finc-support],[data-finc-message]').forEach(b=>b.onclick=()=>dispatchEvent(new CustomEvent('fran:service-message',{detail:{service:'entity'}})));
 host.querySelector('[data-finc-brief]')?.addEventListener('click',brief);
 host.querySelector('[data-finc-send]')?.addEventListener('click',send);
 host.querySelector('[data-finc-request]')?.addEventListener('click',openRequest);
 host.querySelector('[data-finc-team-retry]')?.addEventListener('click',()=>loadTeam(true));
 host.querySelectorAll('[data-finc-open]').forEach(b=>b.onclick=()=>b.dataset.fincOpen==='record'?window.FranLifecycleUI?.openRecord?.('ein'):window.switchTab?.('dataroom'));
 host.querySelectorAll('#finc-error-summary a').forEach(a=>a.onclick=e=>{e.preventDefault();host.querySelector(a.getAttribute('href'))?.focus();});
 const form=host.querySelector('#finc-form');if(!form)return;form.onsubmit=e=>{e.preventDefault();host.querySelector('[data-finc-next],[data-finc-confirm]')?.click();};
 /* Choices that change what the step shows re-render at once; typing is kept in memory and on this device. */
 form.addEventListener('change',e=>{if(e.target.matches('[name=entity_type],[name=tax_election],[name=agent],[name=mailing_same],[name=mail_interest],[name=ending]')){read();st.dirty=true;const id=e.target.id||'';pendingFocus=id?'#'+id:'[name="'+e.target.name+'"]:checked';render();}});
 form.addEventListener('input',e=>{st.dirty=true;read(e.currentTarget);
  /* A corrected field drops its own error (and its line in the summary) without a re-render. */
  const key=(e.target.id||'').replace(/^finc-/,'').replace(/^owner_pct_/,'owner_');if(st.errors[key]){delete st.errors[key];const f=e.target.closest('.finc-field,.finc-owner');f?.classList.remove('has-error');f?.querySelector('.finc-error')?.remove();e.target.removeAttribute('aria-invalid');e.target.removeAttribute('aria-describedby');host.querySelector('#finc-error-summary a[href="#finc-'+key+'"]')?.parentElement.remove();if(!Object.keys(st.errors).length)host.querySelector('#finc-error-summary')?.remove();}if(e.target.dataset.owner!==undefined||['name','name_backup','agent_name','physical_address'].includes(e.target.name)){clearTimeout(typingTimer);typingTimer=setTimeout(()=>{read();refreshLive();},120);}clearTimeout(st.draftTimer);st.draftTimer=setTimeout(()=>{read();if(st.dirty)writeDraft();},400);});}
/* Update the live total, name preview and company card without moving focus. */
function refreshLive(){const t=host.querySelector('.finc-total');if(t){const n=document.createElement('div');n.innerHTML=ownersStep();t.replaceWith(n.querySelector('.finc-total'));}
 const p=host.querySelector('.finc-preview');if(p)p.innerHTML='Registered as <b>'+E(legalName(st.details))+'</b>'+(st.inc.name_backup&&st.path!=='existing'?', or <b>'+E(compose(st.inc.name_backup))+'</b> if it’s taken':'');
 const card=host.querySelector('.finc-card');if(card){const n=document.createElement('div');n.innerHTML=sidecard();card.replaceWith(n.firstElementChild);}}

function brief(){const f=facts(),tax=C.defaultTax(f.entity_type,f.owners),lines=['FRANWALLET COMPANY SETUP SUMMARY','Not a filing, legal opinion, tax election or order.','Prepared: '+new Date().toISOString().slice(0,10),'Wallet: '+ctx.wallet.name,'',
 'Legal name: '+(f.name||'Not chosen'),'Structure: '+(f.entity_type||'Not sure yet'),'Formation state: '+stateLabel(f.jurisdiction),...(st.inc.name_backup?['Backup name: '+compose(st.inc.name_backup)]:[]),'DBA: '+([st.details.dba,st.inc.dba_backup].filter(Boolean).join(' (backup: ')+(st.inc.dba_backup&&st.details.dba?')':'')||'None'),'',
 'Owners:',...f.owners.filter(o=>String(o.name||'').trim()).map(o=>'  '+o.name+' · '+(o.percentage===''?'share missing':o.percentage+'%')),'',
 'Default tax treatment: '+tax.label,'Requested tax treatment: '+C.ELECTIONS[st.inc.tax_election]+(['s_corp','c_corp'].includes(st.inc.tax_election)?' (NOT SUBMITTED)':''),'Registered agent: '+(st.inc.agent==='own'?st.inc.agent_name:C.AGENTS[st.inc.agent]),'Business address: '+(f.physical_address||'Not added'),'Mailing address: '+(st.inc.mailing_same?'Same as business address':f.mailing_address||'Not added'),...(st.inc.mail_interest?['Mailing address service: requested, to be confirmed']:[]),'',
 'Status: '+(confirmed()?'Details confirmed by the owner on '+String(st.inc.confirmed_at).slice(0,10)+'. Not filed.':'Draft. Not filed.'),'Costs: quote required. Nothing was charged.','No EIN, SSN or payment details are included.'];
 const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain'})),a=document.createElement('a');a.href=url;a.download='company-setup-summary.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);metric('incorporate_summary_downloaded',{});}

/* ---------- Home: the one next step until the company is set up ---------- */
let status=null;
function publishStatus(next){if(JSON.stringify(next)===JSON.stringify(status))return;status=next;window.dispatchEvent(new CustomEvent('fran:formation-status',{detail:status}));}
function homeCard(){const page=document.getElementById('page-dashboard'),hdr=page?.querySelector('.main-hdr');if(!hdr||!ctx||!st)return;
 let card=document.getElementById('finc-home');
 if(st.path==='existing'||(!st.path&&ctx.entity?.stage!=='planning')){card?.remove();return;}
 const f=facts(),i=STEPS.findIndex(x=>x[0]===st.step),ok=confirmed(),started=!!st.path,pct=ok?100:started?Math.round(i/STEPS.length*100):0,P=started?phase():'confirm',withTeam=['preparing','quote','filing','done','payment','ended','locked','resend'].includes(P);
 const HOME={preparing:['is with your formation team','They’re checking the name with the state and preparing your quote. We’ll email you and show it here when it’s ready.'],quote:['has a quote ready','Review what it covers and the price. Nothing is filed or charged until you accept it.'],filing:['is being filed','You accepted the quote. Your formation team posts each step in your request.'],done:['is marked complete','Your formation team’s updates and documents are in your request.'],payment:['needs a payment update','Open your request to update the payment.'],ended:['request ended','Message your formation team to start again.'],resend:['has updated details to send','Your team hasn’t quoted yet. Send them the update.'],locked:['changed after your quote','Message your formation team about what changed.']};
 const title=withTeam?E(f.name)+' '+HOME[P][0]:ok?E(f.name)+' is ready to send':started?'Continue setting up '+E(f.name||'your company'):'Your first step: set up the company behind '+E(ctx.wallet.name);
 const sub=withTeam?HOME[P][1]:ok?'Send your confirmed details to your formation team for one quote. Nothing is filed or charged until you accept it.':started?'Step '+(i+1)+' of '+STEPS.length+' · '+STEPS[i][1]+'. Your answers are saved; pick up right where you left off.':'Name, owners, taxes and addresses, checked for gaps. About 5 minutes. Nothing is filed or charged.';
 /* Home's setup card reads this, so the owner's next step waits on the formation request instead of skipping past it. */
 publishStatus({walletId:ctx.wallet.id,phase:P,withTeam,title:withTeam?(f.name||'Your company')+' '+HOME[P][0]:'',sub:withTeam?HOME[P][1]:'',action:P==='quote'?'Review your quote':'View company request'});
 if(!card){card=document.createElement('section');card.id='finc-home';card.className='finc-home';card.setAttribute('aria-labelledby','finc-home-title');hdr.after(card);}
 card.innerHTML='<div class="finc-home-copy"><p class="finc-home-eyebrow">'+(withTeam?'Company setup · with your formation team':'Your next step')+'</p><h2 id="finc-home-title">'+title+'</h2><p>'+sub+'</p><div class="finc-home-bar" role="progressbar" aria-label="Company setup progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+pct+'"><i style="width:'+pct+'%"></i></div></div>'
  +'<button type="button" class="finc-home-go" data-finc-home>'+(P==='quote'?'Review your quote':withTeam?'View company':ok?'Send for a quote':started?'Continue':'Start company setup')+' <span aria-hidden="true">→</span></button>';
 card.querySelector('[data-finc-home]').onclick=()=>open({path:started?'':'new'});}
window.addEventListener('fran:location',e=>{if(!e.detail||e.detail.wallet?.id!==ctx?.wallet?.id)document.getElementById('finc-home')?.remove();});

/* ---------- mount ---------- */
function mount(el,c){host=el;ctx=c;if(!host)return;const id=c.wallet.id,mem=memory.get(id),fresh=fromRecord(c.entity||{},c.wallet);
 /* Keep this tab's state through lifecycle re-renders unless the saved record is newer (another tab or device). */
 /* The record form and the Company card save without touching the journey's time, so also compare the saved fields themselves. */
 if(mem&&(mem.dirty||(mem.serverAt>=fresh.serverAt&&mem.serverSig===fresh.serverSig)))st=mem;else{st=fresh;const draft=readDraft(id);if(draft&&draft.at>st.serverAt){st.path=draft.path||st.path;st.step=draft.step||st.step;st.inc={...st.inc,...C.normalizeIncorporation(draft.inc)};st.details={...st.details,...draft.details};st.dirty=true;st.message='Restored answers you hadn’t saved yet on this device.';}}
 if(st.path&&st.step!=='company')st.visited=Object.fromEntries(STEPS.slice(0,STEPS.findIndex(s=>s[0]===st.step)).map(s=>[s[0],true]));
 const queued=pendingOpen?.walletId===id?pendingOpen:null;if(queued){pendingOpen=null;choose(queued.path);}
 memory.set(id,st);render();if(queued)requestAnimationFrame(focusHeading);}
/* Anywhere in the app: open the company setup and move focus to it. */
/* A path chosen before this wallet's setup has mounted waits for that wallet, never another one. */
let pendingOpen=null;
const currentWallet=()=>typeof WALLET_ID!=='undefined'?WALLET_ID:ctx?.wallet?.id;
function choose(path){if(!path||st.path)return;st.path=path;st.step='company';st.dirty=true;if(!st.details.entity_type)st.details.entity_type='Undecided';}
function focusHeading(){const h=document.getElementById('finc-heading');(host?.isConnected?host:h)?.scrollIntoView({block:'start'});h?.focus({preventScroll:true});}
function open({path}={}){if(ctx&&request())loadTeam(true);window.switchTab?.('entity');window.FranLifecycleUI?.showFormation?.();metric('incorporate_opened',{});
 if(!st||ctx?.wallet?.id!==currentWallet()){pendingOpen={walletId:currentWallet(),path:path||''};return;}
 requestAnimationFrame(()=>{choose(path);render();focusHeading();});}
document.addEventListener('click',e=>{if(!e.target.closest('[data-formation-open]'))return;e.preventDefault();open();});
window.addEventListener('fran:incorporate-open',e=>open(e.detail||{}));
/* The request changes elsewhere (the quote dialog, the team): refresh its status when it does or when the owner returns. */
window.addEventListener('fran:service-changed',e=>{if(e.detail?.service==='entity'&&ctx)loadTeam(true);});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&ctx&&request())loadTeam(true);});
window.FranFormation={mount,open,status:()=>status,_reset:()=>memory.clear()};
})();
