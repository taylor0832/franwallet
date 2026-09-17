/* Location billing: every price and entitlement is verified by the server. */
(()=>{
'use strict';
let timer,sequence=0,busy=false,draftWallet=null,loading=false;
const el=id=>document.getElementById(id),E=value=>escapeHtml(String(value??''));
async function call(action,body={}){
  const {data:{session}}=await sb.auth.getSession();
  if(!session)throw Error('Please sign in again.');
  const response=await fetch(SUPABASE_URL+'/functions/v1/billing',{method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify({action,wallet_id:WALLET_ID,...body})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Billing could not load.');
  return data;
}
function message(text){const node=el('fw-billing-status');if(node)node.textContent=text;}
function money(value){return '$'+Number(value||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});}
function storeReturn(question,context){
  if(!question)return;
  sessionStorage.setItem('fran-ai-checkout-return',JSON.stringify({wallet_id:WALLET_ID,question,context:context||'books',saved_at:Date.now()}));
}
async function runAction(button,type,body={}){
  if(busy)return;
  busy=true;window.locationWorkspaceBusy=true;button.disabled=true;
  message('Opening secure Stripe billing…');
  try{
    const data=await call(type,body);
    if(data.url){
      const url=new URL(data.url);
      if(url.protocol!=='https:'||!['checkout.stripe.com','billing.stripe.com'].includes(url.hostname))throw Error('Unexpected billing destination.');
      location.assign(data.url);
    }else message(data.message||'Saved.');
  }catch(error){message(error.message);}
  finally{busy=false;window.locationWorkspaceBusy=false;button.disabled=false;}
}
function planCopy(status){
  if(status.founding)return {badge:'Founding lifetime',headline:'Your Pro workspace stays included.',detail:'Fran AI is available as a separate monthly add-on.'};
  if(status.pilot_access)return {badge:'Launch pilot',headline:'Your wallet is active during the launch pilot.',detail:'Upgrade when you are ready to keep Fran AI and Location Pro active after the pilot.'};
  if(status.pro)return {badge:'Location Pro',headline:'Location Pro is active.',detail:'Your current period and invoices are managed through Stripe.'};
  return {badge:'Free setup',headline:'Your wallet and records are available.',detail:'Upgrade only when this location needs Fran AI and the full Pro workflow.'};
}
function discountCopy(status){
  if(status.credit_active)return '<div class="fw-credit-confirmed"><strong>Your CoverPanda service credit is verified</strong><span>Active '+E((status.eligible_services||[]).join(' + ')||'bookkeeping or payroll')+' lowers this location from $49 to <b>$29/month</b>.</span></div>';
  return '<p class="fw-subtle">Active CoverPanda bookkeeping or managed payroll qualifies for a verified $20 monthly software credit. Ask your team to verify the service before checkout.</p>';
}
function checkoutDetails(status){
  return '<details class="fw-checkout-details"><summary>What happens after I pay?</summary><ul><li>Stripe processes the payment. Plaid never sees or charges your card.</li><li>FranWallet confirms access only after Stripe verifies payment.</li><li>A FranWallet payment confirmation is sent to your account email.</li><li>Your card statement shows <strong>'+E(status.statement_descriptor||'FRANWALLET')+'</strong>.</li><li>Invoices, payment methods and cancellation remain available in secure Stripe billing.</li></ul></details>';
}
function offer(status,{inline=false,question='',context='books',aiOnly=false}={}){
  const price=Number(status.monthly_amount||49);
  const id=inline?'fw-inline-checkout-form':'fw-checkout-form';
  return '<section class="fw-upgrade-card'+(inline?' inline':'')+'"><div class="fw-upgrade-heading"><div><span class="fw-kicker">'+(aiOnly?'Fran AI add-on':'Location Pro')+' · '+money(price)+'/month</span><h3>'+(inline?'Continue with a cited Fran AI answer':aiOnly?'Add cited answers to your founding workspace':'Turn this wallet into an active operating workspace')+'</h3></div><span class="fw-badge">100 AI requests</span></div>'+(inline&&question?'<blockquote>'+E(question)+'</blockquote>':'')+'<p>Ask across this location’s saved books, policies, payroll and company records. Fran cites the evidence it uses and keeps every answer scoped to this wallet.</p>'+(aiOnly?'':discountCopy(status))+'<div class="fw-plan-facts"><span><b>100</b> requests each paid month</span><span><b>No</b> automatic overages</span><span><b>Cancel</b> for a future renewal</span></div>'+checkoutDetails(status)+(status.checkout_ready?'<form id="'+id+'" data-checkout-action="'+(aiOnly?'checkout_ai':'checkout')+'"><label class="fw-inline"><input type="checkbox" required>I agree to '+money(price)+' per month plus applicable tax, renewing until canceled, and the <a href="terms.html" target="_blank" rel="noopener">terms and AI allowance</a>.</label><button class="btn btn-primary">Continue to secure checkout · '+money(price)+'/month</button></form>':'<p class="fw-note">Checkout is being finalized. Your wallet and records remain available.</p>')+'<p id="fw-billing-status" class="fw-status" role="status"></p></section>';
}
function bindOffer(host,status,{question='',context='books'}={}){
  const form=host.querySelector('form');
  if(!form)return;
  form.addEventListener('change',event=>{draftWallet=event.target.checked?WALLET_ID:null;});
  form.addEventListener('submit',event=>{event.preventDefault();storeReturn(question,context);runAction(form.querySelector('button'),form.dataset.checkoutAction||'checkout',{consent:true});});
}
async function resumeAfterCheckout(status){
  const params=new URLSearchParams(location.search),flow=params.get('billing');
  if(!flow)return;
  const pending=JSON.parse(sessionStorage.getItem('fran-ai-checkout-return')||'null');
  if(flow==='success'&&status.ai_active&&pending?.wallet_id===WALLET_ID){
    sessionStorage.removeItem('fran-ai-checkout-return');
    history.replaceState({},'',location.pathname+location.hash);
    const route={books:'books',payroll:'payroll',insurance:'insurance',entity:'entity',company:'entity',spend:'banking',debt:'debt'}[pending.context]||'dashboard';
    switchTab(route);setTimeout(()=>window.openFranAI?.(pending.question,pending.context),250);return;
  }
  switchTab('billing');
  message(flow==='cancel'?'Checkout closed. Nothing was charged and your records are safe.':status.ai_active?'Payment is confirmed. Fran AI is ready for this location.':'Stripe returned you safely. Refresh payment status if confirmation is still processing.');
}
async function load(force=false){
  if(loading)return;
  const target=el('fw-billing'),request=++sequence,wallet=WALLET_ID;
  if(!target||!ME)return;
  if(!wallet||wallet==='all'){target.innerHTML='<div class="fw-shell"><h2>Choose a location</h2><p>Each plan belongs to one location.</p></div>';return;}
  if(!force&&draftWallet===wallet&&target.querySelector('input')?.checked)return;
  target.innerHTML='<p class="fw-loading" role="status">Checking this location’s plan…</p>';loading=true;
  try{
    const status=await call('status');if(request!==sequence||wallet!==WALLET_ID)return;
    const copy=planCopy(status),period=status.period_end?new Date(status.period_end).toLocaleDateString():'not recorded';
    target.innerHTML='<div class="fw-shell fw-plan-summary"><div class="fw-head"><div><span class="fw-kicker">Plan & billing</span><h2>'+E(copy.headline)+'</h2><p>'+E(copy.detail)+'</p></div><span class="fw-badge">'+E(copy.badge)+'</span></div>'+(status.can_manage?'<div class="fw-current-plan"><span><strong>'+E(status.billing_product==='franwallet_ai_monthly'?'Fran AI add-on':'Location Pro')+'</strong><small>'+E(String(status.status||'').replaceAll('_',' '))+' · '+(status.cancel_at_period_end?'Ends ':'Renews through ')+E(period)+'</small></span><button class="btn btn-ghost" id="fw-manage-billing">Manage billing & invoices</button></div>':'')+'</div>'+(status.can_subscribe?offer(status):'')+(status.can_subscribe_ai?offer({...status,monthly_amount:status.ai_monthly_amount},{aiOnly:true}):'')+'<div class="fw-shell fw-billing-help"><h3>Billing questions</h3><p>Charges are processed by Stripe for FranWallet. Plaid only powers connected bank data.</p>'+checkoutDetails(status)+'<button class="fw-link" id="fw-refresh-billing">Refresh payment status</button></div>';
    target.querySelector('#fw-manage-billing')?.addEventListener('click',event=>runAction(event.currentTarget,'portal'));
    target.querySelector('#fw-refresh-billing')?.addEventListener('click',()=>load(true));
    bindOffer(target,status);
    await resumeAfterCheckout(status);
  }catch(error){if(request===sequence){target.innerHTML='<div class="fw-shell"><h2>Billing is temporarily unavailable</h2><p role="alert">'+E(error.message)+'</p><button class="btn btn-ghost" id="fw-refresh-billing">Try again</button></div>';el('fw-refresh-billing').onclick=()=>load(true);}}
  finally{loading=false;if(wallet!==WALLET_ID)window.refreshBilling();}
}
window.mountFranAIUpgrade=async(target,{question='',context='books'}={})=>{
  target.innerHTML='<p class="fw-loading" role="status">Checking the plan for this location…</p>';
  try{
    const status=await call('status');
    if(status.ai_active){target.innerHTML='<p class="fw-note">Fran AI access is active. Ask your question again.</p>';return;}
    if(!status.can_subscribe){target.innerHTML='<p class="fw-note">This location’s plan is managed by its owner. Ask the owner to enable Fran AI.</p>';return;}
    target.innerHTML='<div class="fw">'+offer(status,{inline:true,question,context})+'</div>';
    bindOffer(target,status,{question,context});
  }catch(error){target.innerHTML='<p class="fw-note fw-error" role="alert">'+E(error.message)+'</p>';}
};
window.requireLocationPro=async()=>{const status=await call('status');if(status.pro)return true;switchTab('billing');await load();message('Location Pro is required to publish a new room. Your work is saved.');return false;};
let metricsAt=0;
async function metrics(){
  if(ME?.email!=='taylor@coverpanda.co'||Date.now()-metricsAt<60000)return;
  metricsAt=Date.now();const target=el('fw-growth-admin');if(!target)return;
  try{const m=await call('metrics'),labels={owners:'Owners with locations',locations:'Locations',new_locations_7d:'New locations · 7 days',prepared_locations:'All five setup items ready',published_locations:'Locations that published a room',active_monthly_locations:'Active monthly locations',founding_accounts:'Founding accounts'};target.innerHTML='<div class="fw-shell"><h3>Founder launch scorecard</h3><div class="fw-grid">'+Object.entries(labels).map(([key,label])=>'<div><b>'+label+'</b><div class="fw-value">'+Number(m[key]||0)+'</div></div>').join('')+'</div></div>';}catch{target.textContent='The launch scorecard could not load. Refresh to retry.';}
}
window.refreshBilling=()=>{metrics();clearTimeout(timer);timer=setTimeout(()=>{if(!busy)load();},200);};
window.manageLocationCredit=(wallet,name)=>{
  const target=el('fw-credit-admin');if(!target)return;
  target.innerHTML='<div class="fw-shell"><h3>Service credit · '+E(name)+'</h3><p>Apply after verifying active CoverPanda bookkeeping or managed payroll.</p><form id="fw-credit-form"><label>Verified agreement reference or reason for removal<input name="agreement" minlength="8" maxlength="500" required></label><label class="fw-inline"><input name="active" type="checkbox">Activate $20 monthly service credit</label><label class="fw-inline"><input type="checkbox" required>I verified eligibility and communicated the billing terms.</label><button class="btn btn-primary">Save eligibility</button></form><p id="fw-credit-status" role="status"></p></div>';
  el('fw-credit-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{const result=await call('credit',{wallet_id:wallet,active:event.target.elements.active.checked,agreement:event.target.elements.agreement.value});el('fw-credit-status').textContent=result.message;}catch(error){el('fw-credit-status').textContent=error.message;}finally{button.disabled=false;}};
  target.scrollIntoView({behavior:'smooth',block:'start'});
};
window.refreshBilling();
})();
