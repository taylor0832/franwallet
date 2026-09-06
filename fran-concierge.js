/* A calm entry point over the existing live, location-scoped workspace. */
(()=>{'use strict';
const $=id=>document.getElementById(id),sidebar=document.querySelector('#view-wallet .sidebar');if(!sidebar)return;
const titles={dashboard:'My wallet',dataroom:'My records',readiness:'My plan',services:'Get help'};
const tools=document.createElement('details');tools.className='concierge-tools';const summary=document.createElement('summary');summary.textContent='More tools';tools.append(summary);
const primary=document.createElement('div');primary.className='concierge-primary';
const nodes=[...sidebar.querySelectorAll('.nav-item')];
for(const [key,title] of Object.entries(titles)){const node=nodes.find(n=>n.dataset.page===key);if(node){node.replaceChildren(document.createTextNode(title));primary.append(node);}}
for(const node of nodes){if(!titles[node.dataset.page]&&node.dataset.page!=='admin')tools.append(node);}
const anchor=sidebar.querySelector('.sb-plan')||sidebar.querySelector('.sb-user');sidebar.insertBefore(primary,anchor);sidebar.insertBefore(tools,anchor);
const original=window.switchTab;window.switchTab=function(name,...args){const node=nodes.find(n=>n.dataset.page===name);if(node&&tools.contains(node))tools.open=true;original(name,...args);};
for(const [key,title] of Object.entries(titles)){const h=$('page-'+key)?.querySelector('.main-hdr h1');if(h&&key!=='dashboard')h.textContent=title;}
// Financial overview and shortcuts are useful after setup, but not competing onboarding tasks.
const home=$('page-dashboard');const financial=home?.querySelector('.cmd-hero');if(financial){const details=document.createElement('details');details.className='concierge-financial';const label=document.createElement('summary');label.textContent='Financial overview & connections';details.append(label);financial.before(details);details.append(financial);const actions=home.querySelector('.quick-actions');if(actions)details.append(actions);}
const providerCard=$('tool-grid')?.closest('.card');if(providerCard){const d=document.createElement('details');d.className='concierge-cloud';const s=document.createElement('summary');s.textContent='Browse provider websites';d.append(s);providerCard.before(d);d.append(providerCard);}
const call=$('book-call')?.closest('.card');if(call)$('page-services')?.append(call);
const requests=document.createElement('section');requests.id='concierge-requests';requests.className='concierge-requests';home?.querySelector('#fw-readiness')?.after(requests);
const labels={payroll:'Payroll',books:'Bookkeeping',insurance:'Insurance',debt:'Financing preparation'};
const states={requested:'Waiting for review',contacted:'Conversation started',quoted:'Proposal ready',active:'Service active',closed:'Closed'};
window.addEventListener('fran:location',e=>{requests.replaceChildren();const s=e.detail;if(!s||s.wallet?.access_role==='payroll_editor')return;const rows=s.records.filter(r=>r.kind==='service'&&r.data.status!=='closed');if(!rows.length)return;const heading=document.createElement('h2');heading.textContent='Your team requests';requests.append(heading);for(const r of rows){const row=document.createElement('button');row.type='button';row.className='concierge-request';const title=document.createElement('strong');title.textContent=labels[r.data.service]||r.data.service;const status=document.createElement('span');status.textContent=states[r.data.status]||r.data.status;row.append(title,status);row.onclick=()=>window.switchTab('services');requests.append(row);}});
// Keep cloud import options secondary to the working private-upload path.
const simplifyRecords=()=>{document.querySelectorAll('.concierge-source-options').forEach(n=>{if(!n.querySelector('.fw-shell'))n.remove();});const cloud=[...document.querySelectorAll('#page-dataroom .fw-shell')].find(n=>n.querySelector('h3,h2')?.textContent==='Bring your existing documents');if(cloud&&!cloud.closest('.concierge-cloud')){const details=document.createElement('details');details.className='concierge-cloud concierge-source-options';const label=document.createElement('summary');label.textContent='Import options & source links';details.append(label);cloud.before(details);details.append(cloud);}}
window.addEventListener('fran:readiness',simplifyRecords);
})();
