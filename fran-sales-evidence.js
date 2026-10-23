/* Shared read-only qualification. Source dates and finality never follow schedule dates. */
(function(root){'use strict';
const iso=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v||''))return false;const d=new Date(v+'T12:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===v;};
const add=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
const dates=(start,end)=>{if(!iso(start)||!iso(end)||end<start)return [];const n=Math.round((Date.parse(end)-Date.parse(start))/864e5)+1;return n>31?[]:Array.from({length:n},(_,i)=>add(start,i));};
const cents=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?Math.round(v*100):null;
function observations(records,walletId){
 if(!walletId)return [];
 const scoped=(records||[]).filter(r=>r.wallet_id===walletId&&r.data?.source_observation===true&&r.data?.evidence_schema==='crumbl-observed-sales-v1');
 const summaries=scoped.filter(r=>r.kind==='sales_week').sort((a,b)=>String(b.data.end||'').localeCompare(String(a.data.end||''))||Number(b.data.revision)-Number(a.data.revision)||String(b.data.collected_at||'').localeCompare(String(a.data.collected_at||'')));
 const signature=d=>JSON.stringify([d.observation_hash,d.net_sales,d.gross_sales,d.csv_sha256,d.collected_at,d.net_sales_definition,d.source_report_timezone]);
 const seen=new Set();
 return summaries.filter(w=>{const key=JSON.stringify([w.data.start,w.data.end,w.data.revision,signature(w.data)]);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,8).map(w=>{
  const d=w.data,expected=dates(d.start,d.end),peers=summaries.filter(r=>r.data.start===d.start&&r.data.end===d.end&&r.data.revision===d.revision),ambiguous=new Set(peers.map(r=>signature(r.data))).size>1;
  const raw=scoped.filter(r=>r.kind==='sales'&&r.data.observation_hash===d.observation_hash&&r.data.revision===d.revision).map(r=>r.data),byDate=new Map();
  for(const r of raw){const rows=byDate.get(r.date)||[];rows.push(r);byDate.set(r.date,rows);}
  const duplicate_dates=expected.filter(date=>(byDate.get(date)||[]).length>1),missing_days=expected.filter(date=>!byDate.has(date)),invalid_dates=expected.filter(date=>{const rows=byDate.get(date)||[];return rows.length===1&&cents(rows[0].net)===null;});
  const daily=[...byDate].sort(([a],[b])=>String(a).localeCompare(String(b))).map(([date,rows])=>({date,net_sales:rows.length===1&&cents(rows[0].net)!==null?rows[0].net:null,gross_sales:rows.length===1&&cents(rows[0].gross)!==null?rows[0].gross:null}));
  const identity=typeof d.observation_hash==='string'&&d.observation_hash.length>0&&Number.isInteger(d.revision)&&d.revision>0&&Number.isFinite(Date.parse(d.collected_at));
  const complete=!ambiguous&&identity&&expected.length===7&&raw.length===7&&!duplicate_dates.length&&!missing_days.length&&!invalid_dates.length&&cents(d.net_sales)!==null&&daily.reduce((n,r)=>n+(cents(r.net_sales)||0),0)===cents(d.net_sales);
  return {source_period:{start:d.start,end:d.end,reported_timezone:d.source_report_timezone??null},metric:'net_sales',net_sales:complete?d.net_sales:null,gross_sales:complete?d.gross_sales:null,daily,duplicate_dates,missing_days,invalid_dates,ambiguous_revision:ambiguous,complete_daily_observation:complete,status:ambiguous?'ambiguous_observation_revision':complete?'provisional_observed_actuals':'incomplete_observation_revision',source_finalized:null,source_finalization_status:'unknown_not_observed',formal_book_close:null,collected_at:d.collected_at,revision:d.revision,observation_hash:d.observation_hash,provenance:{provider:d.provider,report_url:d.source_url,csv_sha256:d.csv_sha256,net_sales_definition:d.net_sales_definition,source_library:d.source_library||[]},note:'Read-only observed evidence; source finalization is unverified.'};
 });
}
function forPeriod(records,walletId,start,end){
 const expected=dates(start,end);if(!expected.length)return null;
 const candidates=observations(records,walletId).filter(o=>o.source_period.start<=end&&o.source_period.end>=start);
 if(!candidates.length)return null;
 // Never combine report revisions or select an arbitrary conflicting summary.
 const o=candidates.find(o=>o.source_period.start<=start&&o.source_period.end>=end)||candidates[0],rows=o.daily.filter(r=>r.date>=start&&r.date<=end),duplicate_dates=o.duplicate_dates.filter(d=>d>=start&&d<=end),invalid_dates=o.invalid_dates.filter(d=>d>=start&&d<=end),missing_days=expected.filter(d=>!rows.some(r=>r.date===d));
 const complete=o.complete_daily_observation&&!missing_days.length&&!duplicate_dates.length&&!invalid_dates.length,valid=rows.filter(r=>cents(r.net_sales)!==null),total=!o.ambiguous_revision&&valid.length?valid.reduce((n,r)=>n+cents(r.net_sales),0)/100:null;
 return {start,end,amount:complete?total:null,observed_amount:total,metric:'net_sales',coverage_complete:complete,missing_days,duplicate_dates,invalid_dates,ambiguous_revision:o.ambiguous_revision,source_period:o.source_period,source:o.provenance.provider||'Point of sale observed sales',definition:o.provenance.net_sales_definition,through:valid.at(-1)?.date||null,collected_at:o.collected_at,revision:o.revision,observation_hash:o.observation_hash,final:false,status:o.ambiguous_revision?'ambiguous_observation_revision':complete?'provisional_observed_actuals':'incomplete_period',source_finalization_status:o.source_finalization_status};
}
function aggregateForPeriod(record,start,end){
 const raw=record?.sales||record?.operating_sales;if(!raw)return null;
 const sourceStart=raw.source_period?.start||record.week_start,sourceEnd=raw.source_period?.end||raw.through,expected=dates(start,end),covered=dates(sourceStart,sourceEnd).filter(d=>iso(raw.through)&&d<=raw.through),exact=sourceStart===start&&sourceEnd===end&&iso(raw.through)&&raw.through>=end&&cents(raw.amount)!==null;
 const contained=iso(sourceStart)&&iso(sourceEnd)&&sourceStart>=start&&sourceEnd<=end;
 return {...raw,start,end,source_period:{start:sourceStart,end:sourceEnd},amount:exact?raw.amount:null,observed_amount:contained&&cents(raw.amount)!==null?raw.amount:null,coverage_complete:exact,missing_days:expected.filter(d=>!covered.includes(d)),final:exact&&raw.final===true&&raw.metric==='net_sales',source_finalized:raw.final===true,status:exact?(raw.final===true?'finalized_source':'provisional_aggregate'):'period_mismatch'};
}
function latest(records,walletId){const o=observations(records,walletId)[0];return o?forPeriod(records,walletId,o.source_period.start,o.source_period.end):null;}
// Operating sales weeks are Sunday–Saturday. Completion is coverage, never formal finalization.
function selectOperatingWeek(input,options={}){
 const instant=Date.parse(options.as_of||new Date().toISOString());if(!Number.isFinite(instant))return null;
 const today=new Date(instant).toISOString().slice(0,10),cutoff=options.schedule_start&&options.schedule_start<today?options.schedule_start:today;
 const ordered=[...(input||[])].sort((a,b)=>String(b.source_period?.end||'').localeCompare(String(a.source_period?.end||''))||Number(b.revision)-Number(a.revision));
 const seen=new Set();
 for(const o of ordered){
  const p=o.source_period||{},key=p.start+'/'+p.end;if(seen.has(key))continue;seen.add(key);
  if(!iso(p.start)||!iso(p.end)||dates(p.start,p.end).length!==7||new Date(p.start+'T12:00:00Z').getUTCDay()!==0||new Date(p.end+'T12:00:00Z').getUTCDay()!==6||p.end>=cutoff)continue;
  if(options.source_start&&(p.start!==options.source_start||p.end!==options.source_end))continue;
  if(!o.complete_daily_observation||o.ambiguous_revision||!Number.isFinite(Date.parse(o.collected_at))||Date.parse(o.collected_at)>instant)continue;
  return {...o,selection_basis:options.source_start?'explicit_exact_operating_week':'latest_available_complete_operating_week',evaluated_at:new Date(instant).toISOString(),schedule_period_separate:true,outlook_approved:false};
 }
 return null;
}
const api={observations,forPeriod,aggregateForPeriod,latest,dates,selectOperatingWeek};root.FranSalesEvidence=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
