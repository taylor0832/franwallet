/* Business plan math: projections from a few assumptions, yearly rollups, debt coverage, break-even, sources and
   uses, prefills from what the Wallet already knows (each with its source), and plan versus actual.
   Pure functions; results are calculated, never stored. */
(function(root){'use strict'
const r2=n=>Math.round(n*100)/100
const n0=x=>Number.isFinite(Number(x))&&x!==null&&x!==''?Number(x):0
function addMonth(ym,k){const [y,m]=ym.split('-').map(Number),d=new Date(Date.UTC(y,m-1+k,1));return d.toISOString().slice(0,7)}
function thisMonth(){return new Date().toISOString().slice(0,7)}
/* Monthly projection. Revenue ramps from ramp_start_pct to 100% over ramp_months, then grows at growth_pct a year. */
function project(a){const months=Math.min(60,Math.max(12,Math.round(n0(a.months)||36))),start=/^\d{4}-\d{2}$/.test(a.start_month||'')?a.start_month:thisMonth(),base=n0(a.revenue_start)
 if(!(base>0))return null;const ramp=Math.round(n0(a.ramp_months)),from=a.ramp_start_pct===null||a.ramp_start_pct===undefined||a.ramp_start_pct===''?100:n0(a.ramp_start_pct),g=n0(a.growth_pct)/100
 const pct=k=>n0(a[k])/100,rows=[];let cumulative=0,endingCash=n0(a.opening_cash)
 for(let i=0;i<months;i++){const rampF=ramp>0&&i<ramp?(from+(100-from)*(i/ramp))/100:1,growF=Math.pow(1+g,i/12),revenue=r2(base*rampF*growF)
  const cogs=r2(revenue*pct('cogs_pct')),labor=r2(revenue*pct('labor_pct')),royalty=r2(revenue*pct('royalty_pct')),marketing=r2(revenue*pct('marketing_pct')),occupancy=r2(n0(a.rent_monthly)),other=r2(n0(a.other_monthly))
  const ebitda=r2(revenue-cogs-labor-royalty-marketing-occupancy-other),debt=r2(n0(a.debt_service_monthly)),cash=r2(ebitda-debt);cumulative=r2(cumulative+cash)
  const taxes=n0(a.taxes_monthly),capex=n0(a.capex_monthly),workingCapital=n0(a.working_capital_monthly),distributions=n0(a.distributions_monthly),cashMovement=r2(cash-taxes-capex-workingCapital-distributions);endingCash=r2(endingCash+cashMovement);
  rows.push({taxes,capex,workingCapital,distributions,cashMovement,endingCash,n:i+1,month:addMonth(start,i),revenue,cogs,labor,royalty,marketing,occupancy,other,ebitda,debt,cash,cumulative})}
 const years=[];for(let y=0;y*12<rows.length;y++){const slice=rows.slice(y*12,y*12+12),sum=k=>r2(slice.reduce((t,r)=>t+r[k],0));const o={year:y+1,months:slice.length};for(const k of ['revenue','cogs','labor','royalty','marketing','occupancy','other','ebitda','debt','cash','taxes','capex','workingCapital','distributions','cashMovement'])o[k]=sum(k);o.endingCash=slice.at(-1).endingCash;o.margin=o.revenue?r2(o.ebitda/o.revenue*100):0;o.dscr=o.debt>0?r2(o.ebitda/o.debt):null;years.push(o)}
 const be=rows.find(r=>r.ebitda>0),beCash=rows.find(r=>r.cash>0),payback=rows.find(r=>r.cumulative>0)
 return {rows,years,start,months,break_even:be?.month||'',cash_positive:beCash?.month||'',cumulative_positive:payback?.month||''}}
function fundingGap(plan){const uses=r2((plan.uses||[]).reduce((t,u)=>t+n0(u.amount),0)),sources=r2((plan.sources||[]).reduce((t,s)=>t+n0(s.amount),0));return {uses,sources,gap:r2(uses-sources)}}
/* What the Wallet already knows, with where it came from. */
function prefill({lease,loans,finances,loanSchedule}){const out={},src={}
 if(lease){const monthly=(amt,p)=>amt===null||amt===undefined||amt===''?null:p==='year'?n0(amt)/12:p==='month'||!p?n0(amt):null;const rent=monthly(lease.base_rent,lease.base_rent_period),cam=monthly(lease.cam,lease.cam_period)
  if(rent!==null){out.rent_monthly=r2(rent+(cam||0));src.rent_monthly='From your lease'+(cam?': base rent + CAM':'')}}
 const pays=(loans||[]).map(l=>loanSchedule?loanSchedule(l)?.payment:null).filter(x=>x>0);if(pays.length){out.debt_service_monthly=r2(pays.reduce((t,x)=>t+x,0));src.debt_service_monthly='From your '+(pays.length===1?'loan':pays.length+' loans')+' payment schedule'}
 const done=(finances||[]).filter(p=>!p.partial&&n0(p.income)>0).slice(-3)
 if(done.length){const inc=done.reduce((t,p)=>t+n0(p.income),0);out.revenue_start=r2(inc/done.length);src.revenue_start='QuickBooks: average of '+done.map(p=>p.label||p.key).join(', ')
  const cogs=done.filter(p=>p.cogs!==null&&p.cogs!==undefined);if(cogs.length===done.length){out.cogs_pct=r2(cogs.reduce((t,p)=>t+Math.max(0,n0(p.cogs)-(p.labor_in_cogs===true?n0(p.labor):0)),0)/inc*100);src.cogs_pct=done.some(p=>p.labor_in_cogs===true)?'QuickBooks cost of goods less labor already included; labor shown separately':'QuickBooks, same months'}
  const lab=done.filter(p=>p.labor!==null&&p.labor!==undefined);if(lab.length===done.length){out.labor_pct=r2(lab.reduce((t,p)=>t+n0(p.labor),0)/inc*100);src.labor_pct='QuickBooks, same months'}}
 return {values:out,sources:src}}
/* Plan versus actual by month: actuals from the books when present, otherwise what the owner entered. */
function compare(projection,{finances=[],entered={}}={}){if(!projection)return [];const books=Object.fromEntries(finances.filter(p=>!p.partial&&p.key&&n0(p.income)>0).map(p=>[p.key,n0(p.income)]))
 return projection.rows.filter(r=>r.month<=thisMonth()).map(r=>{const actual=books[r.month]??(entered[r.month]!==undefined?n0(entered[r.month]):null),source=books[r.month]!==undefined?'books':entered[r.month]!==undefined?'entered':'';return {month:r.month,plan:r.revenue,actual,source,variance:actual===null?null:r2(actual-r.revenue),pct:actual===null||!r.revenue?null:r2((actual-r.revenue)/r.revenue*100)}})}
const api={project,fundingGap,prefill,compare,addMonth,thisMonth}
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FranBizPlanCore=api
})(typeof window!=='undefined'?window:globalThis);
