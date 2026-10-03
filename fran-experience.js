(() => {
'use strict';
const demo=!!document.getElementById('s-dash');
const shell=document.querySelector(demo?'.dash-screen .main':'#view-wallet .main');
if(!shell)return;
const nav=[...document.querySelectorAll('.sidebar .nav-item')];
const way=document.createElement('div');way.className='ux-wayfinder';
const label=document.createElement('label');label.htmlFor='ux-jump';label.textContent='Go to';
const select=document.createElement('select');select.id='ux-jump';
for(const item of nav){const key=demo?item.getAttribute('onclick')?.match(/switchTab\('([^']+)'/)?.[1]:item.dataset.page;if(!key)continue;const option=new Option(item.textContent.trim().replace(/^[^\p{L}]+/u,''),key);if(!item.classList.contains('hidden'))select.add(option);item.setAttribute('role','button');if(item.tagName!=='BUTTON'){item.tabIndex=0;item.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();item.click();}});}}
way.append(label,select);shell.prepend(way);
select.addEventListener('change',()=>window.switchTab(select.value));
const original=window.switchTab;
window.switchTab=function(name,...args){const target=document.getElementById((demo?'t-':'page-')+name);if(!target)return;original(name,...args);select.value=name;target.classList.remove('ux-enter');requestAnimationFrame(()=>target.classList.add('ux-enter'));const heading=target.querySelector('h1,h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}};
if(!demo){
 // Charts retain the source values, with a touch/keyboard equivalent to hover.
 const enhanceCharts=()=>{shell.querySelectorAll('.vchart-wrap').forEach(chart=>{
  if(chart.dataset.uxEnhanced)return;
  const columns=[...chart.querySelectorAll('.vcol[title]')];if(!columns.length)return;
  chart.dataset.uxEnhanced='true';
  const output=document.createElement('p');output.className='ux-chart-reading';output.setAttribute('aria-live','polite');output.textContent='Select a month to inspect its value.';
  const details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ul');summary.textContent='View chart values';list.className='ux-chart-values';details.append(summary,list);
  columns.forEach(column=>{const value=column.title;column.tabIndex=0;column.setAttribute('role','button');column.setAttribute('aria-label',value);const inspect=()=>{output.textContent=value;columns.forEach(c=>c.classList.toggle('ux-selected',c===column));};column.addEventListener('click',inspect);column.addEventListener('focus',inspect);column.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inspect();}});const row=document.createElement('li');row.textContent=value;list.append(row);});chart.append(output,details);
 });};
 let frame=0;new MutationObserver(()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;enhanceCharts();});}).observe(shell,{childList:true,subtree:true});enhanceCharts();
 // Keep destination options aligned with role-specific navigation visibility.
 new MutationObserver(()=>nav.forEach(item=>{const option=[...select.options].find(o=>o.value===item.dataset.page);if(item.classList.contains('hidden')){option?.remove();}else if(!option&&item.dataset.page){select.add(new Option(item.textContent.trim(),item.dataset.page));}})).observe(document.querySelector('.sidebar'),{subtree:true,attributes:true,attributeFilter:['class']});
 return;
}
// Exploration starts immediately. No timed tutorial, fake activity, or tab coachmarks.
window.startDemoInteractionLayer=function(){};
window.showWelcomeTour=function(){};
window.maybeShowTabIntro=function(){};
const tourButton=document.querySelector('[onclick="restartFullTour()"]');if(tourButton){tourButton.textContent='Explore outcomes';tourButton.onclick=()=>window.switchTab('dashboard');}
const bannerElement=document.getElementById('demo-banner');if(bannerElement)shell.insertBefore(bannerElement,way);
const banner=document.querySelector('.db-text');if(banner)banner.textContent='Sample business · Explore your outcomes, then start with your own records.';
const badge=document.querySelector('.db-label');if(badge)badge.textContent='Interactive preview';
const home=document.getElementById('t-dashboard');
home.innerHTML=`<section class="ux-intro"><h1>One location. A clearer next move.</h1><p>See how your financial records become a useful business wallet. Explore this sample location, then build your own.</p><div class="ux-tabs" aria-label="Explore an outcome"><button data-outcome="health" aria-pressed="true">Understand performance</button><button data-outcome="lender" aria-pressed="false">Prepare for financing</button><button data-outcome="buyer" aria-pressed="false">Get exit ready</button></div></section><section class="ux-workbench" id="ux-workbench" aria-label="Outcome preview"></section><a class="ux-link" href="wallet.html">Build my location wallet →</a><p class="ux-note">Illustrative data and workflows. Live services depend on provider availability. Financial readiness does not guarantee financing or a sale.</p>`;
let mode='health';const checked=new Set(['financials','debt']);
const docs=[['financials','P&L and balance sheet','Monthly financial performance'],['debt','Debt schedule','Reported loan balances and payments'],['franchise','Franchise agreement','Term, renewal and transfer provisions'],['lease','Lease and amendments','Occupancy term and assignment conditions'],['bank','Bank statements','Lender review of cash activity']];
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
function render(){
 const work=document.getElementById('ux-workbench');
 if(mode==='health'){
 const revenue=[14200,15700,15100,17800,18200,19600],cost=[11800,12600,12300,13900,14500,15200],months=['Mar','Apr','May','Jun','Jul','Aug'];
 const line=data=>data.map((n,i)=>`${48+i*88},${230-n/100}`).join(' ');
 work.innerHTML=`<div><h2>Revenue is growing faster than costs.</h2><p>Explore six sample months. The full figures stay available beneath the chart.</p><svg class="ux-chart" viewBox="0 0 540 270" role="img" aria-label="Sample monthly revenue grows from 14,200 to 19,600 dollars; costs from 11,800 to 15,200 dollars. Detailed values below."><path d="M48 30H510 M48 130H510 M48 230H510" fill="none" stroke="#e2e9e6"/><text x="0" y="34">$20k</text><text x="0" y="134">$10k</text><text x="12" y="234">$0</text><polyline points="${line(revenue)}" fill="none" stroke="#216b64" stroke-width="3"/><polyline points="${line(cost)}" fill="none" stroke="#68769c" stroke-width="2.5" stroke-dasharray="6 4"/>${months.map((m,i)=>`<circle cx="${48+i*88}" cy="${230-revenue[i]/100}" r="4" fill="#216b64"/><text x="${48+i*88}" y="258" text-anchor="middle">${m}</text>`).join('')}</svg><div class="ux-legend"><span>— Revenue</span><span>┄ Operating costs</span></div><details><summary>View monthly figures</summary><table class="ux-data"><thead><tr><th>Month</th><th>Revenue</th><th>Costs</th><th>Difference</th></tr></thead><tbody>${months.map((m,i)=>`<tr><th>${m}</th><td>${money(revenue[i])}</td><td>${money(cost[i])}</td><td>${money(revenue[i]-cost[i])}</td></tr>`).join('')}</tbody></table></details></div><aside><h2>What changed?</h2><label for="ux-month">Compare a month with March</label><select id="ux-month">${months.map((m,i)=>`<option value="${i}" ${i===5?'selected':''}>${m}</option>`).join('')}</select><div id="ux-month-result" class="ux-result" aria-live="polite"></div><p class="ux-note">Sample operating figures, before debt service, tax and owner distributions.</p><button class="ux-link" id="ux-to-packet">Use these records for financing →</button></aside>`;
 const update=()=>{let i=Number(document.getElementById('ux-month').value);work.querySelectorAll('.ux-chart circle').forEach((circle,index)=>{circle.setAttribute('r',index===i?'7':'4');circle.setAttribute('fill',index===i?'#ad4526':'#216b64');});document.getElementById('ux-month-result').innerHTML=`<p><strong>${months[i]} leaves ${money(revenue[i]-cost[i])}</strong> after the operating costs shown.</p><p>Revenue is ${Math.round((revenue[i]/revenue[0]-1)*100)}% above March; operating costs are ${Math.round((cost[i]/cost[0]-1)*100)}% above March.</p>`;};document.getElementById('ux-month').onchange=update;update();document.getElementById('ux-to-packet').onclick=()=>choose('lender');
 }else{
 const visible=docs.filter(d=>mode==='lender'||d[0]!=='bank');
 work.innerHTML=`<div><h2>${mode==='lender'?'Build a lender’s first look.':'See your location through a buyer’s eyes.'}</h2><p>Select sample records. Your packet updates here as you curate it.</p>${visible.map(d=>`<label class="ux-evidence"><input type="checkbox" value="${d[0]}" ${checked.has(d[0])?'checked':''}><span>${d[1]}<small>${d[2]}</small></span></label>`).join('')}<p class="ux-note">In your real wallet, you review evidence and dates before preparing a packet.</p></div><aside><h2>${mode==='lender'?'Lender':'Buyer'} packet preview</h2><div id="ux-packet-result" class="ux-result" aria-live="polite"></div><p class="ux-note">${mode==='lender'?'Personal guarantor documents belong in a separate private channel. Each lender sets its requirements.':'A buyer also needs verified earnings adjustments, transfer approval and a review of open obligations.'} Nothing is shared from this demo.</p><a class="ux-link" href="wallet.html">Create my private data room →</a></aside>`;
 const update=()=>{const chosen=visible.filter(d=>checked.has(d[0])),missing=visible.filter(d=>!checked.has(d[0]));document.getElementById('ux-packet-result').innerHTML=`<p><strong>${chosen.length} of ${visible.length} sample records selected</strong></p>${chosen.length?'<ul>'+chosen.map(d=>'<li>'+d[1]+'</li>').join('')+'</ul>':'<p>Choose a record to begin your packet.</p>'}<p>${missing.length?'Still to gather: '+missing.map(d=>d[1].toLowerCase()).join(', ')+'.':'This sample set is assembled. In your wallet, review coverage and freshness before sharing.'}</p>`;};work.querySelectorAll('input').forEach(input=>input.onchange=()=>{input.checked?checked.add(input.value):checked.delete(input.value);update();});update();
 }
 work.classList.remove('ux-enter');requestAnimationFrame(()=>work.classList.add('ux-enter'));
}
function choose(value){mode=value;home.querySelectorAll('[data-outcome]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.outcome===mode)));render();}
home.querySelectorAll('[data-outcome]').forEach(b=>b.onclick=()=>choose(b.dataset.outcome));render();
})();
