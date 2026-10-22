/* Fixed-source owner pilot. Uses the site's existing session client, never raw storage credentials. */
(()=>{
 'use strict';
 const intent='fran_bloomfield_sales_pilot';
 const requested=new URLSearchParams(location.search).get('pilot')==='bloomfield-sales';
 if(requested)localStorage.setItem(intent,'1');
 if(!requested&&localStorage.getItem(intent)!=='1')return;
 let dialog=null,starting=false,busy=false,review=null,generation=0;
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
 async function api(action){
  const {data:{session}}=await sb.auth.getSession();
  if(!session)throw Error('Sign in to FranWallet to review this private pilot.');
  const r=await fetch(SUPABASE_URL+'/functions/v1/crumbl-observation-import',{method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify({action})});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Pilot request failed.');return data;
 }
 function close(){generation++;review=null;if(dialog){dialog.close();dialog.remove();dialog=null;}localStorage.removeItem(intent);}
 function shell(){
  const d=el('dialog');d.id='fran-bloomfield-pilot';d.setAttribute('aria-labelledby','pilot-title');d.style.cssText='box-sizing:border-box;width:min(94vw,760px);max-height:90vh;overflow:auto;border:1px solid #cadbd1;border-radius:18px;padding:26px;background:white;color:#183c35;font:15px system-ui;';
  const h=el('h2','Bloomfield sales pilot');h.id='pilot-title';d.append(h);
  const x=el('button','Close');x.type='button';x.onclick=close;x.style.cssText='float:right;padding:8px 14px;';d.prepend(x);d.addEventListener('cancel',event=>{event.preventDefault();close();});document.body.append(d);d.showModal();return d;
 }
 function render(){
  if(!dialog||!review)return;
  const old=dialog.querySelector('[data-pilot-content]');if(old)old.remove();
  const body=el('section');body.dataset.pilotContent='';dialog.append(body);
  body.append(el('p',review.wallet.name+' · '+review.source_period.start+' — '+review.source_period.end));
  const facts=el('p','Observed net '+money(review.net_sales)+' · Gross '+money(review.gross_sales));facts.style.fontWeight='700';body.append(facts);
  body.append(el('p','Seven explicit source dates. Portal reporting timezone and source finalization are unknown. These are provisional actual observations—not an approved forecast, closed books, labor budget or schedule.'));
  body.append(el('p',review.net_sales_definition||'Review the source net-sales definition before using it for forecasting.'));
  if(review.captured_at)body.append(el('p','Source captured '+review.captured_at+'.'));
  body.append(el('p','This action can append only these seven daily records and one weekly summary. It updates or deletes no existing records. An identical repeat makes no changes.'));
  const table=el('table');table.style.cssText='width:100%;border-collapse:collapse;';
  const head=el('tr');for(const label of ['Source date','Net sales'])head.append(el('th',label));table.append(head);
  for(const day of review.daily){const tr=el('tr');tr.append(el('td',day.date),el('td',money(day.net_sales)));table.append(tr);}body.append(table);
  const note=el('p');note.setAttribute('role','status');note.setAttribute('aria-live','polite');body.append(note);
  if(typeof WALLET_ID==='undefined'||WALLET_ID!==review.wallet.id){
   note.textContent='Select Bloomfield Hills before importing.';
   const select=el('button','Use Bloomfield Hills');select.type='button';select.onclick=()=>{const allowed=typeof WALLETS!=='undefined'&&WALLETS.some(w=>w.id===review.wallet.id);if(!allowed){note.textContent='This store is not available in your current wallet session.';return;}setActiveWallet(review.wallet.id);render();};body.append(select);return;
  }
  const button=el('button','Import 8 provisional observations');button.type='button';button.disabled=!review.can_append;button.style.cssText='padding:13px 18px;border:0;border-radius:10px;background:#174f43;color:white;font-weight:700;margin-top:20px;';body.append(button);
  button.onclick=async()=>{
   if(busy)return;if(WALLET_ID!==review.wallet.id){note.textContent='Store changed. Reopen the Bloomfield pilot before importing.';button.disabled=true;return;}
   busy=true;button.disabled=true;note.textContent='Validating and importing the fixed Bloomfield source…';
   try{const receipt=await api('append_pilot');if(receipt.status!=='verified'||receipt.wallet_id!==review.wallet.id||!receipt.readback_verified)throw Error('Receipt is unverified; do not assume the import completed.');note.textContent='Verified: '+receipt.inserted+' records added; '+receipt.unchanged+' unchanged. Seven daily rows and one weekly summary; net '+money(receipt.net_sales)+'. Still provisional. Nothing approved or published.';button.textContent='Verify identical retry makes no changes';button.disabled=false;}
   catch(e){note.textContent=e.message+' Retry only this same fixed source if the result is uncertain.';button.textContent='Retry the same fixed pilot';button.disabled=false;}finally{busy=false;}
  };
 }
 async function start(){
  if(starting||dialog)return;starting=true;const expected=generation;
  try{const {data:{session}}=await sb.auth.getSession();if(!session||expected!==generation)return;if(typeof bootInFlight!=='undefined'&&bootInFlight)await bootInFlight;const result=await api('review');if(expected!==generation)return;review=result;dialog=shell();render();}
  catch(e){if(expected!==generation)return;dialog=shell();const p=el('p',e.message);p.setAttribute('role','alert');dialog.append(p);}
  finally{starting=false;}
 }
 sb.auth.onAuthStateChange(event=>{if(event==='SIGNED_IN')setTimeout(start,0);if(event==='SIGNED_OUT')close();});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
