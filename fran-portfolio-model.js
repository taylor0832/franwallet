/* Period-safe portfolio calculations. All values are scoped to the supplied rows. */
(function(root){'use strict';
const day=864e5,iso=d=>new Date(d).toISOString().slice(0,10),date=s=>Date.parse(s+'T12:00:00Z'),add=(s,n)=>iso(date(s)+n*day),monthEnd=k=>iso(Date.UTC(+k.slice(0,4),+k.slice(5,7),0,12)),num=v=>v!=null&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
const sum=(xs,k)=>xs.length&&xs.every(x=>num(x[k])!==null)?xs.reduce((a,x)=>a+Number(x[k]),0):null;
function range(mode,offset=0,today=iso(new Date())){const d=new Date(date(today));let start,end,label;
 if(mode==='week'){const dow=(d.getUTCDay()+6)%7;start=add(today,-dow+offset*7);end=add(start,6);label='Week of '+format(start);}
 else if(mode==='quarter'){const q=Math.floor(d.getUTCMonth()/3)+offset;start=iso(Date.UTC(d.getUTCFullYear(),q*3,1,12));end=iso(Date.UTC(d.getUTCFullYear(),q*3+3,0,12));label='Q'+(Math.floor(+start.slice(5,7)/3-.01)+1)+' '+start.slice(0,4);}
 else if(mode==='year'){start=(d.getUTCFullYear()+offset)+'-01-01';end=(d.getUTCFullYear()+offset)+'-12-31';label=start.slice(0,4)+(offset===0?' year to date':'');}
 else{start=iso(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+offset,1,12));end=monthEnd(start.slice(0,7));label=new Date(date(start)).toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});}
 return {mode,offset,start,end:end>today?today:end,fullEnd:end,partial:end>=today,label};}
function format(s){return s?new Date(date(s.slice(0,10))).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}):'Not updated';}
function keys(r){let k=r.start.slice(0,7),out=[];while(k<=r.end.slice(0,7)){out.push(k);const d=new Date(date(k+'-01'));k=iso(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1,12)).slice(0,7);}return out;}
function financial(s,r){
 if(r.mode==='week')return null;
 const expected=keys(r),points=expected.map(k=>(s.financial||[]).find(f=>f.key===k)).filter(p=>p&&(!p.start||p.start>=r.start)&&(!p.end||p.end<=r.end));
 if(!points.length)return null;
 const coverage={},result={};
 for(const field of ['income','operating','gross','cogs']){
  const known=points.filter(p=>num(p[field])!==null),missing=expected.filter(k=>!known.some(p=>p.key===k));
  result[field]=sum(known,field);
  coverage[field]={keys:known.map(p=>p.key),missing,expected:expected.length,count:known.length,partial:known.some(p=>p.partial)||missing.length>0,through:known.at(-1)?.end|| (known.length?monthEnd(known.at(-1).key):null)};
 }
 return {...result,coverage,partial:r.partial||coverage.income.partial||coverage.operating.partial};
}
function payroll(s,r){const ms=(s.pay?.months||[]).filter(m=>m.start>=r.start&&m.end<=r.end).sort((a,b)=>a.start.localeCompare(b.start));let next=r.start;for(const m of ms){if(m.start!==next||m.overlap)return null;next=add(m.end,1);}if(!ms.length||next!==add(r.end,1))return null;return {cost:sum(ms,'cost'),hours:sum(ms,'hours'),overtime:sum(ms,'overtime'),partial:r.partial};}
function schedule(s,r){const x=s.scheduling;if(!x||x.start>r.start||x.end<r.end||!Array.isArray(x.days))return null;const days=x.days.filter(d=>d.date>=r.start&&d.date<=r.end);return {hours:days.length?sum(days,'hours'):0,shifts:days.reduce((n,d)=>n+d.shifts,0),partial:r.partial};}
function spend(s,r){const b=s.bill;if(!b?.connected||b.incomplete||!b.synced||b.start>r.start||b.synced.slice(0,10)<r.end)return null;return {amount:(b.days||[]).filter(d=>d.date>=r.start&&d.date<=r.end).reduce((n,d)=>n+Number(d.amount),0)};}
function aggregate(rows,r,type,field){const fn={financial,payroll,schedule,spend}[type];const covered=rows.map(row=>({row,value:row.error?null:fn(row.summary,r)})).filter(x=>num(x.value?.[field])!==null),total=covered.length?covered.reduce((n,x)=>n+Number(x.value[field]),0):null;return {total,count:covered.length,average:covered.length?total/covered.length:null,covered,...(type==='financial'?{reports:covered.reduce((n,x)=>n+x.value.coverage[field].count,0),expected:keys(r).length*rows.length,partial:covered.some(x=>x.value.coverage[field].partial),complete:covered.filter(x=>!x.value.coverage[field].partial).length}:{})};}
function change(rows,r,type,field,today){if(r.partial)return null;const prev=range(r.mode,r.offset-1,today),fn={financial,payroll,schedule,spend}[type],pairs=rows.map(row=>({a:row.error?null:fn(row.summary,r),b:row.error?null:fn(row.summary,prev)})).filter(x=>num(x.a?.[field])!==null&&num(x.b?.[field])!==null&&!x.a.partial&&!x.b.partial);if(!pairs.length)return null;const now=pairs.reduce((n,x)=>n+x.a[field],0),before=pairs.reduce((n,x)=>n+x.b[field],0);return {delta:now-before,percent:before>0?(now-before)/before*100:null,count:pairs.length};}
root.FranPortfolioModel={range,format,keys,financial,payroll,schedule,spend,aggregate,change,sum,num};if(typeof module==='object'&&module.exports)module.exports=root.FranPortfolioModel;
})(typeof globalThis!=='undefined'?globalThis:this);
