/* Guided formation journey: pure rules shared by the wallet and the lifecycle edge function.
   No provider is connected. Every filing status is simulated and can never mark a real entity formed. */
(function(root){'use strict';
const STATES='AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' ');
const PATHS=['new','existing','help'];
const STEPS=['start','prepare','review','workspace'];
const STRUCTURES=['LLC','Corporation','Sole proprietorship','Partnership','Undecided'];
const QUESTIONS=[['partners','Partners or outside investors','Ownership, voting and exit terms may need tailored documents.'],['structure','Entity structure or tax election undecided','Ask an attorney or accountant before choosing the filing structure.'],['states','Operating or forming in more than one state','Formation and permission to operate in another state are separate questions.'],['contracts','Franchise agreement, lease or personal guarantee needs review','A formation filing does not review your commercial commitments.'],['special','Acquisition, parent entity, trust ownership or regulated activity','These circumstances can change the preparation and review needed.']];
const TASKS=[['documents','Collect formation documents','Articles, operating agreement and state approval','documents'],['ein','Record your EIN evidence','IRS confirmation letter (CP 575 or 147C)','record'],['banking','Prepare for a business bank account','Questions and documents your bank will ask for','banking'],['funding','Review funding needs','Budget, owner contribution and lender requirements','debt'],['expenses','Plan pre-opening expense tracking','Keep receipts separate from personal spending','books'],['deadlines','Record renewals and annual reports','Add due dates from official notices','deadlines']];
/* Filing lifecycle from the formation brief. Only signed provider evidence could ever mark a real approval;
   without a connected provider every status here is a simulation. */
const FILING={none:'Not started',draft:'Draft',awaiting_review:'Awaiting your approval',provider_received:'Provider received',state_pending:'State review pending',needs_correction:'Needs correction',rejected:'Rejected',approved:'Approved',canceled:'Canceled'};
const NEXT={provider_received:'state_pending'};
/* Once submitted (simulated), the approved details are locked: Start and Prepare cannot change what was approved. */
const LOCKED=['provider_received','state_pending','approved'];
const OUTCOMES={success:'approved',correction:'needs_correction',rejected:'rejected'};
const CORRECTION={field:'name',message:'The state reported this name is not distinguishable from an existing record. Choose a different name and approve again.'};
const QUOTE_MINUTES=30;
const text=(x,max=180)=>String(x??'').trim().slice(0,max);
const pick=(x,allowed,fallback)=>allowed.includes(x)?x:fallback;

function assess(answers){const a=answers||{};const flags=QUESTIONS.filter(([k])=>a[k]==='yes').map(([k])=>k),unknown=QUESTIONS.filter(([k])=>!a[k]||a[k]==='unsure').map(([k])=>k);
 return {flags,unknown,title:flags.length?'Bring a specialist into these decisions':unknown.length?'A few decisions are still open':'Your preparation path is clearer',
  note:flags.length?'Keep preparing. Review the flagged decisions with counsel or your accountant before any filing.':unknown.length?'You do not need every answer today. Open questions travel with your brief to whoever helps you.':'No extra review signals in these answers. This is not a legal assessment or confirmation that counsel is unnecessary.'};}

/* Field-level validation for the preparation step. Returns {field: message}. */
function validateDetails(path,d){const e={},name=text(d?.name),state=String(d?.jurisdiction||''),type=String(d?.entity_type||'');
 if(path==='existing'){if(!name)e.name='Enter the legal name on your formation documents.';if(!STATES.includes(state))e.jurisdiction='Choose the state where the entity was formed.';if(!STRUCTURES.includes(type)||type==='Undecided')e.entity_type='Choose the entity type on your formation documents.';}
 else if(path==='new'){if(!name)e.name='Enter a working name. You can change it before anything is filed.';if(state!=='unsure'&&!STATES.includes(state))e.jurisdiction='Choose a state, or “Not sure yet”.';if(!STRUCTURES.includes(type))e.entity_type='Choose a structure, or “Not sure yet”.';}
 else{if(state&&state!=='unsure'&&!STATES.includes(state))e.jurisdiction='Choose a state, or “Not sure yet”.';if(type&&!STRUCTURES.includes(type))e.entity_type='Choose a structure, or “Not sure yet”.';}
 if(name&&name.length<2)e.name='Use at least two characters.';if(name&&!/[A-Za-z0-9]/.test(name))e.name='Use letters or numbers in the name.';
 return e;}

/* Whether a simulated filing may be prepared, and why not. A new LLC or corporation in one chosen state, with no flagged decision. */
function filingReadiness(path,d,answers){if(path!=='new')return {ready:false,reason:path==='existing'?'existing':'adviser'};
 if(Object.keys(validateDetails('new',d)).length)return {ready:false,reason:'details'};
 if(!['LLC','Corporation'].includes(d.entity_type)||!STATES.includes(d.jurisdiction))return {ready:false,reason:'adviser'};
 if(assess(answers).flags.length)return {ready:false,reason:'adviser'};
 return {ready:true,reason:''};}

/* Itemized quote. Unknown is never zero: without a provider every amount is unavailable. */
function quoteRows(){return [['Formation service fee','Provider quote required'],['State filing fee','Provider quote required'],['Expedited processing (optional)','Provider quote required'],['Registered agent, first year','Confirm inclusion with provider'],['Registered agent renewal','Recurring · review separately'],['Compliance services','Optional · review separately'],['Cancellation & refund terms','Provider terms required'],['Total due today','Not available']];}

function simulatedQuote(now=Date.now()){return {id:'SIM-'+Math.random().toString(36).slice(2,8).toUpperCase(),simulated:true,total:null,created_at:new Date(now).toISOString(),expires_at:new Date(now+QUOTE_MINUTES*60000).toISOString()};}
const quoteExpired=(q,now=Date.now())=>!q||!Number.isFinite(Date.parse(q.expires_at))||Date.parse(q.expires_at)<=now;
/* The details a filing approval covers. Changing any of them invalidates an approval. */
const fingerprint=d=>[text(d?.name).toLowerCase(),d?.jurisdiction||'',d?.entity_type||''].join('|');
const FIELD_INDEX={name:0,jurisdiction:1,entity_type:2};
/* A correction is resolved only when the flagged field itself changed from what was approved. */
function correctionResolved(filing,fp){const i=FIELD_INDEX[filing?.correction?.field]??0;return String(fp||'').split('|')[i]!==String(filing?.approved_fingerprint||'').split('|')[i];}

/* Guard for the real provider path (from the formation brief). Nothing calls it with a live quote yet. */
function requireFilingApproval({quote,acceptedQuoteId,buyerApproved,entityVerified}){
 if(!quote?.id||!Number.isFinite(quote.total)||quote.total<0)throw Error('A complete provider quote is required.');
 if(!Number.isFinite(quote.expiresAt)||quote.expiresAt<=Date.now())throw Error('Refresh the expired quote.');
 if(acceptedQuoteId!==quote.id||buyerApproved!==true||entityVerified!==true)throw Error('Buyer review and approval are required.');
 return true;}

/* Provider adapter. Every method is blocked until a verified provider contract, sandbox and credentials exist. */
class ProviderNotConfiguredError extends Error{constructor(){super('A verified formation provider connection is required.');this.code='PROVIDER_NOT_CONFIGURED';}}
const provider=Object.freeze({connected:false,async getQuote(){throw new ProviderNotConfiguredError();},async createHandoff(){throw new ProviderNotConfiguredError();},async getStatus(){throw new ProviderNotConfiguredError();}});

function event(f,status,now){f.status=status;f.events=[...(f.events||[]),{status,at:new Date(now).toISOString()}].slice(-20);return f;}
/* Simulated filing transitions. Throws a readable message when the move is not allowed. */
function transition(filing,action,ctx={}){const now=ctx.now||Date.now(),f={...(filing||{status:'none',events:[]}),simulated:true,events:[...(filing?.events||[])]};
 const s=f.status||'none';
 if(action==='prepare'){if(!['none','canceled','rejected','draft'].includes(s))throw Error('A simulated filing is already in progress.');if(!ctx.ready)throw Error('Complete your details and resolve flagged decisions first.');f.quote=simulatedQuote(now);f.approved_fingerprint='';f.correction=null;f.outcome=pick(ctx.outcome,Object.keys(OUTCOMES),'success');event(f,'awaiting_review',now);return f;}
 if(action==='approve'){if(s!=='awaiting_review')throw Error('There is nothing awaiting your approval.');if(quoteExpired(f.quote,now))throw Error('This simulated quote expired. Refresh it and review again.');if(ctx.confirmed!==true)throw Error('Confirm that you approve these exact details.');if(!ctx.ready)throw Error('Your details changed or need review. Fix them before approving.');f.approved_fingerprint=ctx.fingerprint;f.approved_quote_id=f.quote.id;event(f,'provider_received',now);return f;}
 if(action==='refresh_quote'){if(!['awaiting_review','draft'].includes(s))throw Error('The quote can only be refreshed before approval.');f.quote=simulatedQuote(now);f.approved_fingerprint='';event(f,'awaiting_review',now);return f;}
 if(action==='advance'){if(s==='provider_received'){event(f,NEXT[s],now);return f;}if(s==='state_pending'){const out=OUTCOMES[f.outcome]||'approved';if(out==='needs_correction')f.correction={...CORRECTION};event(f,out,now);return f;}throw Error('No status update is pending.');}
 if(action==='correct'){if(s!=='needs_correction')throw Error('No correction was requested.');if(!ctx.ready)throw Error('Fix the highlighted details first.');if(!correctionResolved(f,ctx.fingerprint))throw Error('Change the flagged detail before resubmitting.');f.quote=simulatedQuote(now);f.approved_fingerprint='';f.outcome='success';event(f,'awaiting_review',now);return f;}
 if(action==='cancel'){if(!['awaiting_review','provider_received','needs_correction','draft'].includes(s))throw Error('This simulated filing can no longer be canceled here.');event(f,'canceled',now);return f;}
 throw Error('Unsupported action.');}


/* Incorporation preparation. Records what the owner decided, kept apart from anything a provider, state or the IRS
   has done: nothing here files, pays, elects or assigns a registered agent. */
const INC_STEPS=['company','owners','taxes','addresses','review'];
const ENDINGS={LLC:['LLC','L.L.C.','Limited Liability Company'],Corporation:['Inc.','Corporation','Corp.']};
const ELECTIONS={default:'Keep the default tax treatment',s_corp:'Request S corporation treatment',c_corp:'Request C corporation treatment',undecided:'Not decided yet'};
const AGENTS={service:'FranWallet registered agent service',own:'Someone I name',later:'Decide later'};
const named=owners=>(Array.isArray(owners)?owners:[]).filter(o=>text(o?.name));
function defaultTax(type,owners){const n=named(owners).length;
 if(type==='LLC')return n>1?{code:'partnership',label:'Partnership',note:'The company files an information return (Form 1065), and each owner reports their share of the profits on their personal tax return.'}:n===1?{code:'disregarded',label:'Taxed with you, the owner',note:'Profits and losses go on your personal tax return. The company doesn’t file its own federal income tax return.'}:{code:'unknown',label:'Depends on the owners',note:'Add the owners to see the default tax treatment.'};
 if(type==='Corporation')return {code:'c_corp',label:'C corporation',note:'The company pays corporate income tax on its profits, and dividends paid to owners are taxed again on their personal returns.'};
 return {code:'unknown',label:'Not known yet',note:'Choose a structure to see its default tax treatment.'};}
const electionsFor=type=>type==='LLC'?['default','s_corp','c_corp','undecided']:type==='Corporation'?['default','s_corp','undecided']:['undecided'];
function ownershipTotal(owners){let t=0;for(const o of named(owners)){const v=Number(o.percentage);if(o.percentage===null||o.percentage===''||!Number.isFinite(v))return null;t+=v;}return Math.round(t*100)/100;}
function normalizeIncorporation(x){if(!x||typeof x!=='object')return null;const iso=v=>{const t=Date.parse(v);return Number.isFinite(t)?new Date(t).toISOString():null;};
 return {step:pick(x.step,INC_STEPS,'company'),ending:pick(x.ending,[...ENDINGS.LLC,...ENDINGS.Corporation],''),name_backup:text(x.name_backup),dba_backup:text(x.dba_backup),tax_election:pick(x.tax_election,Object.keys(ELECTIONS),'undecided'),
  agent:pick(x.agent==='northwest'?'service':x.agent,Object.keys(AGENTS),'later'),agent_name:text(x.agent_name,120),mailing_same:x.mailing_same!==false,mail_interest:x.mail_interest===true,
  confirmed_fingerprint:text(x.confirmed_fingerprint,64),confirmed_at:iso(x.confirmed_at)};}
/* Field errors for one step. Open decisions ("Not sure yet") are allowed while preparing; review lists them. */
function validateIncorporation(step,d,inc){const e={},name=text(d?.name);
 if(step==='company'){if(!name)e.name='Enter the name you want for the company. You can change it before anything is filed.';else if(name.length<2||!/[A-Za-z0-9]/.test(name))e.name='Use at least two letters or numbers.';
  if(!['LLC','Corporation','Undecided'].includes(d?.entity_type))e.entity_type='Choose a structure, or Not sure yet.';
  if(d?.jurisdiction&&d.jurisdiction!=='unsure'&&!STATES.includes(d.jurisdiction))e.jurisdiction='Choose a state, or Not sure yet.';}
 if(step==='owners'){(Array.isArray(d?.owners)?d.owners:[]).forEach((o,i)=>{const v=o?.percentage;if((v!==null&&v!==''&&v!==undefined)&&(!Number.isFinite(Number(v))||Number(v)<0||Number(v)>100))e['owner_'+i]='Use a percentage from 0 to 100.';if(!text(o?.name)&&v!==null&&v!==''&&v!==undefined)e['owner_'+i]='Add this owner’s name, or remove the row.';});}
 if(step==='taxes'&&!electionsFor(d?.entity_type).includes(inc?.tax_election||'undecided'))e.tax_election='Choose an option that fits this structure.';
 if(step==='addresses'&&inc?.agent==='own'&&!text(inc?.agent_name))e.agent_name='Enter the registered agent’s name, or choose Decide later.';
 return e;}
/* What still needs a decision before the details can be confirmed. Each item names the step that resolves it. */
function incorporationGaps(d,inc){const g=[],t=ownershipTotal(d?.owners);
 if(Object.keys(validateIncorporation('company',d,inc)).length)g.push(['company','Company name']);
 if(d?.entity_type==='Undecided'||!d?.entity_type)g.push(['company','Structure: LLC or corporation']);
 if(!STATES.includes(d?.jurisdiction))g.push(['company','Formation state']);
 if(!named(d?.owners).length)g.push(['owners','At least one owner']);else if(t===null)g.push(['owners','Each owner’s percentage']);else if(t!==100)g.push(['owners','Ownership adds up to '+t+'%, not 100%']);
 if(!inc||inc.tax_election==='undecided'||!electionsFor(d?.entity_type).includes(inc.tax_election))g.push(['taxes','Tax treatment']);
 if(!inc||inc.agent==='later')g.push(['addresses','Registered agent']);else if(inc.agent==='own'&&!text(inc.agent_name))g.push(['addresses','Registered agent name']);
 if(!text(d?.physical_address))g.push(['addresses','Business address']);
 return g;}
/* The facts a confirmation covers. Changing any of them means the owner must confirm again. */
function incorporationFingerprint(d,inc){const s=JSON.stringify([text(d?.name).toLowerCase(),text(inc?.name_backup).toLowerCase(),d?.entity_type||'',d?.jurisdiction||'',named(d?.owners).map(o=>[text(o.name).toLowerCase(),o.percentage===null||o.percentage===''?null:Number(o.percentage)]),inc?.tax_election||'',inc?.agent||'',text(inc?.agent_name).toLowerCase(),text(d?.physical_address).toLowerCase(),inc?.mailing_same===false?text(d?.mailing_address).toLowerCase():'same']);
 let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}return 'v1-'+h.toString(16).padStart(8,'0')+'-'+s.length;}

/* Server and client normalization. Anything unrecognized is dropped; statuses are always simulated. */
function normalizeJourney(j){if(!j||typeof j!=='object')return null;const f=j.filing&&typeof j.filing==='object'?j.filing:null;
 const iso=x=>{const t=Date.parse(x);return Number.isFinite(t)?new Date(t).toISOString():null;};
 const filing=f?{status:pick(f.status,Object.keys(FILING),'none'),simulated:true,outcome:pick(f.outcome,Object.keys(OUTCOMES),'success'),
  quote:f.quote&&typeof f.quote==='object'?{id:text(f.quote.id,24),simulated:true,total:null,created_at:iso(f.quote.created_at),expires_at:iso(f.quote.expires_at)}:null,
  approved_fingerprint:text(f.approved_fingerprint,400),approved_quote_id:text(f.approved_quote_id,24),
  correction:f.correction&&typeof f.correction==='object'?{field:pick(f.correction.field,['name','jurisdiction','entity_type'],'name'),message:text(f.correction.message,300)}:null,
  events:(Array.isArray(f.events)?f.events:[]).slice(-20).map(e=>({status:pick(e?.status,Object.keys(FILING),'none'),at:iso(e?.at)})).filter(e=>e.at)}:null;
 return {version:1,path:pick(j.path,PATHS,''),step:pick(j.step,STEPS,'start'),acknowledged:j.acknowledged===true,
  jurisdiction_unsure:j.jurisdiction_unsure===true,tasks:[...new Set((Array.isArray(j.tasks)?j.tasks:[]).filter(t=>TASKS.some(([k])=>k===t)))],
  filing,incorporation:normalizeIncorporation(j.incorporation),updated_at:iso(j.updated_at)};}

/* Where a returning owner resumes when no journey was saved: existing entities go straight to their workspace. */
function infer(entity){const j=normalizeJourney(entity?.formation_journey);if(j)return j;
 if(entity?.stage==='existing'&&text(entity?.name))return {...normalizeJourney({path:'existing',step:'workspace'}),inferred:true};
 return normalizeJourney({});}

const api={STATES,PATHS,STEPS,STRUCTURES,QUESTIONS,TASKS,FILING,OUTCOMES,QUOTE_MINUTES,assess,validateDetails,filingReadiness,quoteRows,simulatedQuote,quoteExpired,fingerprint,correctionResolved,LOCKED,requireFilingApproval,ProviderNotConfiguredError,provider,transition,normalizeJourney,infer,INC_STEPS,ENDINGS,ELECTIONS,AGENTS,defaultTax,electionsFor,ownershipTotal,normalizeIncorporation,validateIncorporation,incorporationGaps,incorporationFingerprint};
root.FranFormationCore=api;if(typeof module==='object'&&module&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
