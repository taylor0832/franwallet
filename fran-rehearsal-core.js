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
  filing,updated_at:iso(j.updated_at)};}

/* Where a returning owner resumes when no journey was saved: existing entities go straight to their workspace. */
function infer(entity){const j=normalizeJourney(entity?.formation_journey);if(j)return j;
 if(entity?.stage==='existing'&&text(entity?.name))return {...normalizeJourney({path:'existing',step:'workspace'}),inferred:true};
 return normalizeJourney({});}

const api={STATES,PATHS,STEPS,STRUCTURES,QUESTIONS,TASKS,FILING,OUTCOMES,QUOTE_MINUTES,assess,validateDetails,filingReadiness,quoteRows,simulatedQuote,quoteExpired,fingerprint,correctionResolved,LOCKED,requireFilingApproval,ProviderNotConfiguredError,provider,transition,normalizeJourney,infer};
root.FranFormationCore=api;if(typeof module==='object'&&module&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
