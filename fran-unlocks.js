/* Feature introductions: each part of the wallet is introduced when the owner's progress makes it useful,
   one at a time, on Home. Nothing is locked; the menu still reaches everything. This only decides what to
   point out, when, and why it matters now. */
(()=>{'use strict';
const $=id=>document.getElementById(id),E=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let loc=null;
const SNOOZE_DAYS=7;

/* ---------- what the owner has done ---------- */
function entity(){return (loc?.records||[]).find(r=>r.kind==='entity')?.data||{};}
function part(slot){try{return !!window.FRAN_JOURNEY?.saved?.(slot);}catch{return false;}}
function formation(){const f=window.FranFormation?.status?.();return f&&f.walletId===loc?.wallet?.id?f.phase:'';}
function facts(){const e=entity(),phase=formation();
 return {
  preopening:e.operating_status==='preopening'||e.stage==='planning',
  setupStarted:!!e.formation_journey?.path||part('entity'),
  withTeam:['preparing','quote','filing','payment','resend','locked'].includes(phase),
  formed:!!(e.effective_date||e.formation_date)||e.stage==='existing'||phase==='done',
  lease:part('lease'),bank:part('banking'),books:part('accounting'),payroll:part('payroll'),insurance:part('insurance'),
  allSix:['entity','lease','banking','insurance','accounting','payroll'].every(part)};}

/* ---------- the introductions, in the order an owner usually reaches them ----------
   when: the moment it becomes useful. next: how the owner reaches that moment, shown as "coming up". */
const INTROS=[
 {id:'invite-help',when:f=>f.withTeam,next:'once your company details are with your formation team',
  title:'Bring in your attorney or business partner',
  why:'Your formation team is preparing the quote. If someone is advising you, invite them to review the company details here. They see only this location, and only what you share.',
  cta:'Invite someone',go:()=>dispatchEvent(new CustomEvent('fran:invite-provider',{detail:{scope:'entity'}}))},
 {id:'bizplan',route:'bizplan',when:f=>f.preopening&&(f.withTeam||f.formed),next:'once your company details are sent',
  title:'Start your opening budget',
  why:'Lenders, landlords and your brand all ask what opening will cost. Your business plan keeps the startup budget, funding and timeline together, and you can share it when they ask.',
  cta:'Open my business plan',go:()=>window.FranBizPlan?.open?.()||window.switchTab?.('bizplan')},
 {id:'data-room',route:'documents',when:f=>f.formed,next:'once your company is formed',
  title:'Keep your company papers together',
  why:'Your formation documents, EIN letter and operating agreement are what the bank, landlord and insurer ask for next. Store them once here and share them when you need to.',
  cta:'Open data rooms',go:()=>window.switchTab?.('documents')},
 {id:'deadlines',route:'entity',when:f=>f.lease||f.formed,next:'once your lease or company is on file',
  title:'Never miss a renewal',
  why:'Annual reports, registered agent renewals and lease dates come around quietly. Add the due dates from your notices and they show up here before they’re due.',
  cta:'Add a deadline',go:()=>{window.switchTab?.('entity');requestAnimationFrame(()=>{const d=$('life-task-details');if(d){d.open=true;d.scrollIntoView({block:'start'});}});}},
 {id:'budget',route:'plan',when:f=>f.bank,next:'once your bank account is connected',
  title:'See cash against your plan',
  why:'With your bank connected, Budget & forecast compares what’s in the account with what’s coming up, so you see a shortfall before it happens.',
  cta:'Open budget & forecast',go:()=>window.switchTab?.('plan')},
 {id:'books-team',when:f=>f.books,next:'once your books are connected',
  title:'Your monthly numbers, explained',
  why:'Your books are connected, so Home now explains each month’s profit and costs. If anything looks off, your FranWallet accounting team can review it with you.',
  cta:'Review my books',go:()=>window.switchTab?.('books')},
 {id:'routines',route:'routines',when:f=>f.payroll&&!f.preopening,next:'once you’re open and running payroll',
  title:'Put payroll on a weekly rhythm',
  why:'Sales in, timesheets closed, schedules published, payroll run. Routines reminds the right person before each step is due.',
  cta:'Set up routines',go:()=>window.switchTab?.('routines')},
 {id:'sharing',route:'dataroom',when:f=>f.allSix,next:'once all six parts of your wallet are saved',
  title:'Share what a lender or your brand asks for',
  why:'All six parts of your wallet are saved. Share a data room with exactly the records someone needs, and see when they’ve opened it.',
  cta:'Set up sharing',go:()=>window.switchTab?.('dataroom')},
 {id:'readiness',route:'readiness',when:f=>f.allSix&&f.preopening,next:'once all six parts are saved',
  title:'Check what’s left before opening',
  why:'Readiness lists what’s still missing or out of date across your records, so the last weeks before opening hold no surprises.',
  cta:'Open readiness',go:()=>window.switchTab?.('readiness')},
];

/* ---------- per-wallet memory on this device ---------- */
const key=id=>'fran_intro:'+loc.wallet.id+':'+id;
function seen(id){try{const v=JSON.parse(localStorage.getItem(key(id))||'null');if(!v)return false;if(v.done)return true;return v.until>Date.now();}catch{return false;}}
function remember(id,v){try{localStorage.setItem(key(id),JSON.stringify(v));}catch{}}
function opened(id){try{return !!JSON.parse(localStorage.getItem(key(id))||'null')?.done;}catch{return false;}}
function track(event,intro,extra={}){try{posthog.capture(event,{intro:intro.id,wallet_parts_saved:['entity','lease','banking','insurance','accounting','payroll'].filter(part).length,preopening:facts().preopening,...extra});}catch{}}

function owned(){return !!loc?.wallet?.id&&loc.wallet.id!=='all'&&!loc.wallet.access_role;}
/* Nothing competes with the first job: introductions start once the company is sent to the team or already on file. */
function ready(f){return f.withTeam||f.formed;}
function current(){if(!owned())return null;const f=facts();if(!ready(f))return null;return INTROS.find(i=>i.when(f)&&!seen(i.id))||null;}
function upcoming(after){const f=facts(),from=INTROS.indexOf(after)+1;return INTROS.slice(from).find(i=>!i.when(f)&&!(i.id==='readiness'&&!f.preopening))||null;}

/* ---------- Home card ---------- */
let shownFor='';
function renderCard(){
 const dash=$('page-dashboard');let card=$('fran-intro');
 const intro=dash&&current();
 if(!intro){card?.remove();return;}
 if(!card){card=document.createElement('section');card.id='fran-intro';card.className='fran-intro';card.setAttribute('aria-labelledby','fran-intro-title');}
 const anchor=$('fj-home')||$('finc-home')||dash.querySelector('.main-hdr');
 if(anchor&&card.previousElementSibling!==anchor)anchor.after(card);
 const next=upcoming(intro),label=intro.title;
 card.innerHTML='<div class="fran-intro-copy"><p class="fran-intro-eyebrow">Unlocked for you</p><h2 id="fran-intro-title">'+E(label)+'</h2><p>'+E(intro.why)+'</p>'
  +(next?'<p class="fran-intro-next">Coming up: '+E(next.title)+', '+E(next.next)+'.</p>':'')+'</div>'
  +'<div class="fran-intro-actions"><button type="button" class="fran-intro-go" data-intro-go>'+E(intro.cta)+' <span aria-hidden="true">→</span></button><button type="button" class="fran-intro-later" data-intro-later>Not now</button></div>';
 card.querySelector('[data-intro-go]').onclick=()=>{remember(intro.id,{done:true,at:Date.now()});track('feature_intro_opened',intro);card.remove();intro.go();renderNav();};
 card.querySelector('[data-intro-later]').onclick=()=>{remember(intro.id,{until:Date.now()+SNOOZE_DAYS*864e5});track('feature_intro_snoozed',intro);renderCard();};
 const tag=loc.wallet.id+':'+intro.id;if(shownFor!==tag){shownFor=tag;track('feature_intro_shown',intro);}
}

/* ---------- menu: a small "New" marker until the owner has opened what was introduced ---------- */
const NAV_OF={documents:'documents',dataroom:'documents',readiness:'documents',plan:'banking',entity:'company',routines:'routines',bizplan:'bizplan'};
function renderNav(){
 document.querySelectorAll('#release-nav .fran-new').forEach(n=>n.remove());
 if(!owned())return;const f=facts();if(!ready(f))return;
 for(const i of INTROS){if(!i.route||!i.when(f)||opened(i.id))continue;const b=document.querySelector('#release-nav [data-page="'+NAV_OF[i.route]+'"]');if(b&&!b.querySelector('.fran-new')){const s=document.createElement('span');s.className='fran-new';s.textContent='New';s.setAttribute('aria-label','New for you');b.append(s);}}
}
/* Visiting the page counts as opening what was introduced. */
const prev=window.switchTab;
if(typeof prev==='function')window.switchTab=function(route,...a){const r=prev.call(this,route,...a);if(owned()){const f=facts();for(const i of INTROS)if(i.route===route&&i.when(f)&&!opened(i.id)){remember(i.id,{done:true,at:Date.now()});track('feature_intro_opened',i,{via:'menu'});}renderNav();if(route==='dashboard')requestAnimationFrame(renderCard);}return r;};

/* ---------- keep it current ---------- */
let queued=false;function refresh(){if(queued)return;queued=true;setTimeout(()=>{queued=false;renderCard();renderNav();},60);}
window.addEventListener('fran:location',e=>{loc=e.detail;shownFor='';refresh();});
window.addEventListener('fran:formation-status',refresh);
window.addEventListener('fran:readiness',refresh);
window.addEventListener('fran:service-changed',refresh);
/* Home is redrawn by other scripts; put the card back after a redraw drops it. */
const dash=$('page-dashboard');if(dash)new MutationObserver(()=>{if(!$('fran-intro')&&current())refresh();}).observe(dash,{childList:true,subtree:true});
window.FranUnlocks={intros:()=>INTROS.map(i=>({id:i.id,title:i.title,unlocked:!!(loc&&i.when(facts())),seen:loc?seen(i.id):false})),refresh};
})();
