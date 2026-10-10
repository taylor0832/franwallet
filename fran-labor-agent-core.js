/* Deterministic labor planning. No employee assignment or provider submission. */
(function(root){'use strict';
const DAY_NAMES=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const n=v=>v!==null&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
const round=(v,p=1)=>{const m=10**p;return Math.round((Number(v)+Number.EPSILON)*m)/m;};
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
function required(value,name,{min=0,max=1e9}={}){const x=n(value);if(x===null||x<min||x>max)throw Error(name+' is missing or outside its allowed range.');return x;}
function provenance(value,source,type='operator-set',asOf=null){return {value:n(value),source:String(source||'Source not recorded'),type,as_of:asOf||null};}
function normalizedShape(shape,openDays){const values=DAY_NAMES.map((day,i)=>(openDays?.[i]===false||openDays?.[i]===0)?0:Math.max(0,n(shape?.[i])||0)),total=values.reduce((a,b)=>a+b,0);if(total<=0)throw Error('Day-of-week demand shape is required.');return values.map(v=>v/total);}
function chooseForecast(input,config){
 const last=n(input.last_week_sales),adjustment=n(input.adjustment_percent);
 if(last!==null&&last>0&&adjustment!==null){const sales=last*(1+clamp(adjustment,-90,300)/100);return {sales:round(sales,2),base_sales:round(last,2),adjustment_percent:round(adjustment),method:'operator_adjusted_last_week',confidence:'high',provenance:input.projection_provenance||provenance(sales,input.last_week_source||'Prior-week POS sales plus operator adjustment','derived',input.as_of)};}
 const manual=n(input.projected_sales);if(manual!==null&&manual>0)return {sales:manual,method:'manual_projection',confidence:'high',provenance:input.projection_provenance||provenance(manual,'Operator projection','operator-set',input.as_of)};
 const history=(input.trailing_sales||[]).map(n).filter(v=>v!==null&&v>0).slice(-4),deadband=clamp(n(config.deadband_percent)??10,0,50)/100;
 if(history.length){const avg=history.reduce((a,b)=>a+b,0)/history.length,chosen=last!==null&&Math.abs(last-avg)/avg>deadband?last:avg;return {sales:round(chosen,2),method:last!==null&&chosen===last?'last_week_outside_deadband':'trailing_average',confidence:history.length===4?'high':'medium',provenance:provenance(chosen,'Imported weekly sales history','derived',input.as_of)};}
 const baseline=required(config.baseline_sales,'Baseline weekly sales',{min:1});return {sales:baseline,method:'operator_baseline',confidence:'medium',provenance:config.baseline_sales_provenance||provenance(baseline,'Confirmed operating budget baseline','operator-set',config.updated_at)};
}
function modelHours(sales,config,lean=null){
 if(config.planning_mode==='revenue')return revenueHours(sales,config,lean);
 const floor=required(config.minimum_hours,'Minimum weekly hours',{min:0,max:1000}),baselineHours=required(config.baseline_hours,'Baseline weekly hours',{min:1,max:1000}),baselineSales=required(config.baseline_sales,'Baseline weekly sales',{min:1}),deadband=clamp(n(config.deadband_percent)??10,0,50)/100;
 if(config.planning_mode==='store_framework'){
  const reviewBelow=n(config.review_below_sales),maximum=n(config.maximum_hours),event=n(config.event_hours)??0,target=Math.max(floor,baselineHours),hours=maximum===null?target+event:Math.min(maximum,target+event),review=reviewBelow!==null&&sales<reviewBelow;
  return {hours:round(hours),raw_hours:round(hours),method:review?'store_framework_downside_review':'store_framework_target',confidence:'high',floor_bound:hours<=floor,review_required:review,crew_dollars:null,inputs:{target_hours:target,minimum_hours:floor,maximum_hours:maximum,review_below_sales:reviewBelow,event_hours:event}};
 }
 const wage=n(config.blended_hourly_cost),target=n(config.target_labor_percent),burden=n(config.noncontrollable_percent),salary=n(config.weekly_salaried_cost)??0,shared=n(config.weekly_shared_leadership_cost)??0;
 if(config.economic_inputs_confirmed===true&&wage!==null&&wage>0&&target!==null&&burden!==null&&target>burden){const dollars=sales*((config.hourly_cost_basis==='employer_cost'?target:target-burden)/100)-salary-shared,raw=Math.max(0,dollars/wage)+(config.budget_hours_basis==='total_hours'?(n(config.salaried_schedule_hours)??0):0),hours=Math.max(floor,raw);return {hours:round(hours),raw_hours:round(raw),method:'economic_capacity',confidence:'high',floor_bound:raw<floor,crew_dollars:round(Math.max(0,dollars),2),inputs:{wage,target,burden,salary,shared}};}
 const change=(sales-baselineSales)/baselineSales,raw=Math.abs(change)<=deadband?baselineHours:baselineHours*(sales/baselineSales),hours=Math.max(floor,raw);return {hours:round(hours),raw_hours:round(raw),method:Math.abs(change)<=deadband?'calibrated_deadband_hold':'calibrated_sales_scaling',confidence:'medium',floor_bound:raw<floor,crew_dollars:null,inputs:{baseline_hours:baselineHours,baseline_sales:baselineSales,deadband_percent:deadband*100}};
}
// Revenue mode (owner rules, Oct 6): hours follow projected sales, always total hours (crew + salaried), tips never
// count as labor cost, skeleton floor 110 h, and a bias to under-budget: the lower of the labor-target check (A) and the
// lean check (B: last comparable week's worked total hours scaled to projected sales), rounded down to 0.5 h.
function revenueHours(sales,c,lean,salesKnown=true){
 const floor=n(c.minimum_hours)??110,rate=n(c.blended_hourly_cost),target=n(c.target_labor_percent),salary=n(c.weekly_salaried_cost)??0,shared=n(c.weekly_shared_leadership_cost)??0,salHours=n(c.salaried_schedule_hours)??0,down=v=>Math.floor(v*2+1e-9)/2;
 const laborDollars=rate&&rate>0&&target!==null?round(sales*target/100,2):null,crewDollars=laborDollars===null?null:round(laborDollars-salary-shared,2),A=crewDollars===null?null:round(Math.max(0,crewDollars)/rate+salHours,2);
 const lh=n(lean?.hours),ls=n(lean?.sales),B=lh!==null&&lh>0&&ls!==null&&ls>0&&sales>0?round(lh*sales/ls,2):null;
 let candidate,binding;
 if(A!==null){candidate=B!==null&&B<A?B:A;binding=B!==null&&B<A?'lean_check':'labor_target';}
 else{const base=n(c.baseline_hours);candidate=B!==null&&base!==null?Math.min(B,base):(B??base);binding=B!==null&&(base===null||B<base)?'lean_check':'saved_budget';}
 // Without real sales (baseline fallback) the projection is not revenue evidence: never exceed the saved budget.
 const base0=n(c.baseline_hours);if(!salesKnown&&base0!==null&&candidate>base0){candidate=base0;binding='saved_budget';}
 let hours=down(candidate);if(hours<floor){hours=floor;binding='floor';}
 return {hours,raw_hours:round(candidate,1),method:'revenue_'+binding,confidence:A!==null&&c.economic_inputs_confirmed===true?'high':'medium',floor_bound:binding==='floor',review_required:false,crew_dollars:crewDollars,inputs:{sales:round(sales,2),target_percent:target,labor_dollars:laborDollars,salaried_cost:salary,shared_cost:shared,crew_dollars:crewDollars,crew_rate:rate,salaried_hours:salHours,affordable_hours:A,lean:B!==null?{hours:lh,sales:ls,week_start:lean.week_start||null,week_end:lean.week_end||null,source:String(lean.source||'').slice(0,300)||null,final:lean.final===true,scaled_hours:B}:null,lean_hours:B,binding,floor,headroom_hours:A===null?null:round(Math.max(0,A-hours),1)}};
}
function dailyEnvelope(hours,config){
 const shape=normalizedShape(config.day_shape,config.open_days),mins=DAY_NAMES.map((_,i)=>(config.open_days?.[i]===false||config.open_days?.[i]===0)?0:Math.max(0,n(config.minimum_day_hours?.[i])||0));
 if(mins.reduce((a,b)=>a+b,0)>hours+0.001)throw Error('Weekly hours cannot cover the configured daily minimums. Review coverage before cutting hours.');
 // Water-fill demand weights around protected minimums; never hide a shortage in Saturday.
 let remaining=hours,active=shape.map((v,i)=>v>0?i:null).filter(i=>i!==null),values=mins.map(()=>0);
 while(active.length){const weight=active.reduce((sum,i)=>sum+shape[i],0),bound=active.filter(i=>remaining*shape[i]/weight<mins[i]);if(!bound.length){for(const i of active)values[i]=remaining*shape[i]/weight;break;}for(const i of bound){values[i]=mins[i];remaining-=mins[i];}active=active.filter(i=>!bound.includes(i));}
 const units=values.map(v=>Math.floor((v+1e-8)*10)),target=Math.round(hours*10),order=values.map((v,i)=>({i,remainder:v*10-units[i]})).filter(x=>shape[x.i]>0).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);
 const leftover=target-units.reduce((a,b)=>a+b,0);
 for(let k=0;k<leftover;k++)units[order[k%order.length].i]++;
 return DAY_NAMES.map((day,i)=>({day,index:i,hours:units[i]/10,share:round(shape[i]*100),open:(config.open_days?.[i]!==false&&config.open_days?.[i]!==0),minimum:mins[i]}));
}
function evaluateSchedule(envelope,scheduled){const rows=DAY_NAMES.map((day,i)=>{const plan=envelope[i]?.hours??0,value=n(Array.isArray(scheduled)?scheduled[i]:scheduled?.[day]??scheduled?.[day.toLowerCase()]);return {day,planned_hours:plan,scheduled_hours:value,variance:value===null?null:round(value-plan),status:value===null?'missing':value>plan+0.5?'over':value<plan-0.5?'under':'on_plan'};}),known=rows.filter(r=>r.scheduled_hours!==null),scheduledHours=known.length===7?round(known.reduce((s,r)=>s+r.scheduled_hours,0)):null,plannedHours=round(rows.reduce((s,r)=>s+r.planned_hours,0));return {days:rows,planned_hours:plannedHours,scheduled_hours:scheduledHours,variance:scheduledHours===null?null:round(scheduledHours-plannedHours),coverage:known.length};}
	function plan(config,input={}){if(config.planning_mode==='revenue')config={...config,budget_hours_basis:'total_hours',hourly_cost_basis:'employer_cost'};const forecast=chooseForecast(input,config),modeled=config.planning_mode==='revenue'?revenueHours(forecast.sales,config,input.lean_reference,forecast.method!=='operator_baseline'):modelHours(forecast.sales,{...config,event_hours:input.event_hours},input.lean_reference),confirmed=n(input.confirmed_hours),hours=confirmed!==null?required(confirmed,'Confirmed hours',{min:0,max:1000}):modeled.hours,envelope=dailyEnvelope(required(hours,'Weekly hours',{min:required(config.minimum_hours,'Minimum weekly hours'),max:1000}),config),schedule=evaluateSchedule(envelope,input.scheduled_hours),wage=n(config.blended_hourly_cost),salary=n(config.weekly_salaried_cost)??0,shared=n(config.weekly_shared_leadership_cost)??0,target=n(config.target_labor_percent),floor=n(config.minimum_hours),costHours=schedule.scheduled_hours??hours,laborCost=wage===null?null:round(Math.max(0,costHours-(config.budget_hours_basis==='total_hours'?(n(config.salaried_schedule_hours)??0):0))*wage+salary+shared,2),goalHours=wage&&target?round(Math.max(0,(forecast.sales*(config.hourly_cost_basis==='gross_wage'?target-(n(config.noncontrollable_percent)??0):target)/100-salary-shared)/wage)+(config.budget_hours_basis==='total_hours'?(n(config.salaried_schedule_hours)??0):0)):null,financials={basis:schedule.scheduled_hours===null?'hour_budget':'imported_schedule',hours:round(costHours),estimated_labor_cost:laborCost,estimated_labor_percent:laborCost===null?null:round(laborCost/forecast.sales*100),cost_basis:config.hourly_cost_basis||'unconfirmed',hours_basis:config.budget_hours_basis||'unconfirmed',salaried_schedule_hours:n(config.salaried_schedule_hours),labor_goal_percent:config.hourly_cost_basis==='gross_wage'?target-(n(config.noncontrollable_percent)??0):target,goal_hours_supported:goalHours,coverage_floor_hours:floor,goal_below_coverage_floor:goalHours!==null&&floor!==null&&goalHours<floor,provisional:config.economic_inputs_confirmed!==true||!config.hourly_cost_basis||config.hourly_cost_basis==='unconfirmed'||!config.budget_hours_basis||config.budget_hours_basis==='unconfirmed',measured_cost_as_of:config.measured_cost_as_of||null};return {version:'labor-v2',week_start:String(input.week_start||''),week_end:String(input.week_end||''),forecast,model:{...modeled,recommended_hours:modeled.hours},decision:{hours:round(hours),state:confirmed!==null?'operator_confirmed':'recommended',source:confirmed!==null?'Operator confirmation':config.planning_mode==='revenue'?'FranWallet revenue recommendation':'FranWallet store framework'},financials,envelope,schedule,criteria:{biggest_day:envelope.reduce((a,b)=>b.hours>a.hours?b:a).day,cut_order:envelope.filter(d=>d.open).sort((a,b)=>a.share-b.share).map(d=>d.day),notes:Array.isArray(config.criteria)?config.criteria.slice(0,12):[]},readiness:{economic_model:modeled.method==='economic_capacity',missing:[wageMissing(config),economicsMissing(config),coverageMissing(config)].filter(Boolean)},confidence:modeled.confidence};}
function wageMissing(c){return n(c.blended_hourly_cost)===null?'Measured blended employer cost':null;}
function economicsMissing(c){return c.economic_inputs_confirmed===true?null:'Confirm labor target, payroll burden and leadership allocation';}
function coverageMissing(c){return (c.minimum_day_hours||[]).some(v=>n(v)!==null)?null:'Opening, closing and peak coverage minimums';}

function calendarWeeks(month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Choose a valid calendar month.');
 const first=month+'-01',add=(s,d)=>new Date(Date.parse(s+'T12:00:00Z')+d*86400000).toISOString().slice(0,10),day=(new Date(first+'T12:00:00Z').getUTCDay()+6)%7,weeks=[];
 for(let start=add(first,-day);start.slice(0,7)<=month;start=add(start,7))weeks.push(start);
 return weeks;
}
function budgetCost(config,hours){
 const wage=n(config.blended_hourly_cost),salary=n(config.weekly_salaried_cost),shared=n(config.weekly_shared_leadership_cost);
 return wage===null||salary===null?null:round(Math.max(0,hours-(config.budget_hours_basis==='total_hours'?(n(config.salaried_schedule_hours)??0):0))*wage+salary+(shared??0),2);
}
function monthSummary(month,portfolios){
 const weeks=calendarWeeks(month),byWeek=new Map(portfolios.map(p=>[p.week_start,p])),stores=new Map(),add=(s,d)=>new Date(Date.parse(s+'T12:00:00Z')+d*86400000).toISOString().slice(0,10);
 for(const start of weeks){const portfolio=byWeek.get(start);if(!portfolio)throw Error('Month is missing planning week '+start+'.');
 for(const row of portfolio.locations){const plan=row.run?.plan||row.preview,c=row.run?.config_snapshot||row.config,open=plan.envelope.filter(d=>d.open).length;let store=stores.get(row.wallet.id);if(!store){store={wallet:row.wallet,hours:0,cost:0,sales:0,unknown_cost:false,provisional:false,days:0,weeks:[],daily:[],confirmed_weeks:0};stores.set(row.wallet.id,store);}
 let counted=0,weekHours=0;for(const day of plan.envelope){const date=add(start,day.index);if(date.slice(0,7)!==month)continue;const hours=Number(day.hours),salary=n(c.weekly_salaried_cost),wage=n(c.blended_hourly_cost),cost=wage===null||salary===null?null:Math.max(0,hours-(day.open&&open&&c.budget_hours_basis==='total_hours'?(n(c.salaried_schedule_hours)??0)/open:0))*wage+(day.open&&open?(salary+(n(c.weekly_shared_leadership_cost)??0))/open:0),sales=day.open&&open?plan.forecast.sales/open:0;store.daily.push({date,week_start:start,hours,cost:cost===null?null:round(cost,2),sales:round(sales,2),status:row.run?.status||'recommendation'});store.hours+=hours;weekHours+=hours;store.sales+=sales;if(cost===null)store.unknown_cost=true;else store.cost+=cost;if(day.open){store.days++;counted++;}}
 store.provisional ||= c.economic_inputs_confirmed!==true;store.weeks.push({start,hours:round(weekHours),open_days:counted,status:row.run?.status||'recommendation',source_as_of:plan.forecast.provenance?.as_of||null,stale:row.prior_week_sales?.stale===true});if(row.run?.status==='confirmed')store.confirmed_weeks++;
 }}
 const rows=[...stores.values()].map(s=>({...s,hours:round(s.hours),cost:s.unknown_cost?null:round(s.cost,2),sales:round(s.sales,2)})).sort((a,b)=>a.wallet.name.localeCompare(b.wallet.name)),known=rows.filter(s=>s.cost!==null);
 return {month,weeks,stores:rows,hours:round(rows.reduce((sum,s)=>sum+s.hours,0)),known_cost:round(known.reduce((sum,s)=>sum+s.cost,0),2),known_cost_stores:known.length,total_stores:rows.length,sales:round(rows.reduce((sum,s)=>sum+s.sales,0),2)};
}
function reviewSchedule(config,plan,items=[],roster=[]){
 const minutes=s=>{const [h,m]=String(s).split(':').map(Number);return h*60+m;},issues=[],warnings=[],days=DAY_NAMES.map(()=>0),personHours=new Map(),byPerson=new Map();
 for(const item of items){const start=minutes(item.start),end=minutes(item.end),hours=(end-start)/60-(n(item.break_hours)??0);if(!Number.isInteger(item.day)||item.day<0||item.day>6||!Number.isFinite(hours)||hours<=0){issues.push('Invalid shift for '+String(item.employee||'unassigned employee'));continue;}days[item.day]+=hours;const key=item.employee_id||String(item.employee||'').trim().toLowerCase();personHours.set(key,(personHours.get(key)||0)+hours);const slots=byPerson.get(key)||[];slots.push({start:item.day*1440+start,end:item.day*1440+end,employee:item.employee});byPerson.set(key,slots);if(!plan.envelope[item.day]?.open)issues.push(item.employee+' has a shift on closed '+DAY_NAMES[item.day]);}
 for(const slots of byPerson.values()){slots.sort((a,b)=>a.start-b.start);let furthest=null;for(const shift of slots){if(furthest&&shift.start<furthest.end)issues.push(shift.employee+' has overlapping shifts');if(!furthest||shift.end>furthest.end)furthest=shift;}}
 const total=round(days.reduce((a,b)=>a+b,0)),over=round(total-plan.decision.hours);if(over>0.5)issues.push('Weekly schedule is '+over+' hours over budget');if(total<(n(config.minimum_hours)??0)-0.5)issues.push('Scheduled hours are below the protected weekly coverage floor');
 const missing=plan.envelope.filter((day,i)=>day.open&&days[i]===0).map(day=>day.day);if(missing.length)issues.push('No assignments on '+missing.join(', '));
 for(const day of plan.envelope){if(days[day.index]<day.minimum)issues.push(day.day+' is below protected minimum hours');if(days[day.index]>day.hours+0.5)warnings.push(day.day+' has '+round(days[day.index]-day.hours)+' more hours than its '+round(day.hours)+' h target. Fine if intentional; otherwise shorten a shift.');}
 for(const [key,hours] of personHours){const person=roster.find(p=>(p.id||String(p.name||'').trim().toLowerCase())===key);if(person?.maximum_weekly_hours!=null&&hours>person.maximum_weekly_hours)issues.push(person.name+' exceeds their weekly hour limit');}
 warnings.push('Before publishing in When I Work, the manager confirms availability, time off, opening and closing leads, and breaks. FranWallet cannot see availability.');
 return {hours:total,variance:over,days:days.map(v=>round(v)),issues:[...new Set(issues)],warnings:[...new Set(warnings)],ready:items.length>0&&issues.length===0,availability_verified:false};
}

function fitScheduleToBudget(config,plan,source){
 const minutes=s=>{const [h,m]=String(s).split(':').map(Number);return h*60+m;},clock=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
 const items=source.map(s=>({...s})),changes=[],conflicts=[],minimumShift=Math.round((n(config.minimum_shift_hours)??Math.min(3,...source.map(s=>(minutes(s.end)-minutes(s.start))/60-(n(s.break_hours)??0)).filter(h=>h>0)))*60);
 for(const day of plan.envelope){
  const rows=items.filter(s=>s.day===day.index),target=Math.round(day.hours*60);
  if(!rows.length){if(day.open)conflicts.push(day.day+': no imported assignments');continue;}
  const paid=s=>minutes(s.end)-minutes(s.start)-Math.round((n(s.break_hours)??0)*60);
  if(rows.some(s=>paid(s)<=0)){conflicts.push(day.day+': invalid source shift');continue;}
  let excess=rows.reduce((v,s)=>v+paid(s),0)-target;
  const coverage=m=>rows.filter(s=>minutes(s.start)<=m&&minutes(s.end)>m).length;
  const safe=s=>{for(let m=minutes(s.start);m<minutes(s.end);m++)if(coverage(m)<2)return false;return true;};
  while(excess>0){
   const removable=rows.filter(s=>paid(s)<=excess&&safe(s)).sort((a,b)=>paid(a)-paid(b))[0];
   if(removable){rows.splice(rows.indexOf(removable),1);items.splice(items.indexOf(removable),1);excess-=paid(removable);changes.push(day.day+': removed overlapping '+removable.employee+' shift');continue;}
   const candidates=rows.filter(s=>paid(s)>minimumShift).sort((a,b)=>paid(b)-paid(a));
   let cut=false;
   for(const s of candidates){const start=minutes(s.start),end=minutes(s.end);if(coverage(end-1)>=2){s.end=clock(end-1);cut=true;}else if(coverage(start)>=2){s.start=clock(start+1);cut=true;}if(cut){excess--;break;}}
   if(!cut){conflicts.push(day.day+': cannot remove '+(excess/60).toFixed(1)+' h while preserving imported coverage and minimum shift length');break;}
  }
  if(excess<0)conflicts.push(day.day+': imported pattern is '+(-excess/60).toFixed(1)+' h below target; additional availability needed');
 }
 for(const s of items){s.hours=(minutes(s.end)-minutes(s.start))/60-(n(s.break_hours)??0);const old=source.find(x=>x.id===s.id);if(old&&(old.start!==s.start||old.end!==s.end))changes.push(DAY_NAMES[s.day]+': '+s.employee+' '+old.start+'–'+old.end+' → '+s.start+'–'+s.end);}
 let weeklyExcess=Math.round(items.reduce((sum,s)=>sum+(minutes(s.end)-minutes(s.start))-(n(s.break_hours)??0)*60,0)-plan.decision.hours*60);
 while(weeklyExcess>0){let cut=false;for(const s of items){const rows=items.filter(x=>x.day===s.day),start=minutes(s.start),end=minutes(s.end),paid=end-start-(n(s.break_hours)??0)*60,total=rows.reduce((sum,x)=>sum+minutes(x.end)-minutes(x.start)-(n(x.break_hours)??0)*60,0),floor=(plan.envelope[s.day]?.minimum??0)*60,cover=m=>rows.filter(x=>minutes(x.start)<=m&&minutes(x.end)>m).length;if(paid<=minimumShift||total-1<floor)continue;if(cover(end-1)>=2){s.end=clock(end-1);cut=true;}else if(cover(start)>=2){s.start=clock(start+1);cut=true;}if(cut){weeklyExcess--;break;}}if(!cut)break;}
 if(weeklyExcess===0){for(let i=conflicts.length-1;i>=0;i--)if(conflicts[i].includes('cannot remove'))conflicts.splice(i,1);changes.push('Daily hours redistributed where needed to preserve coverage and meet the weekly cap.');}
 for(const s of items)s.hours=(minutes(s.end)-minutes(s.start))/60-(n(s.break_hours)??0);
 const review=reviewSchedule(config,plan,items);
 return {assignments:items,changes,conflicts,review,within_budget:review.hours<=plan.decision.hours+.001&&conflicts.length===0,availability_verified:false,coverage_verified:false,note:'Imported coverage span preserved; breaks, qualified leads, peak staffing and current availability require manager review.'};
}

// Plain-language budget math: projected sales × labor target = labor dollars; minus fixed leadership = crew dollars;
// ÷ crew cost per hour = crew hours the target affords. Returns nulls (never zeros) for missing inputs.
function budgetDerivation(config,plan){
 const c0=config||{},c=c0.planning_mode==='revenue'?{...c0,budget_hours_basis:'total_hours',hourly_cost_basis:'employer_cost'}:c0,sales=n(plan?.forecast?.sales),rate=n(c.blended_hourly_cost),salary=n(c.weekly_salaried_cost),shared=n(c.weekly_shared_leadership_cost)??0,grossBasis=c.hourly_cost_basis==='gross_wage',target=n(c.target_labor_percent),burden=grossBasis?(n(c.noncontrollable_percent)??0):0,goal=target===null?null:round(target-burden,2),hours=n(plan?.decision?.hours),salariedHours=c.budget_hours_basis==='total_hours'?(n(c.salaried_schedule_hours)??0):0;
 const leadership=round((salary??0)+shared,2),laborDollars=sales!==null&&goal!==null?round(sales*goal/100,2):null,crewDollars=laborDollars===null?null:round(laborDollars-leadership,2),affordable=crewDollars!==null&&rate?round(Math.max(0,crewDollars)/rate,1):null,crewHours=hours===null?null:round(Math.max(0,hours-salariedHours),1),crewCost=hours!==null&&rate!==null?round(Math.max(0,hours-salariedHours)*rate,2):null,total=crewCost===null?null:round(crewCost+leadership,2);
 const lean=plan?.model?.inputs?.lean||null,revenue=c.planning_mode==='revenue'&&sales!==null?revenueHours(sales,c,lean,plan?.forecast?.method!=='operator_baseline'):null;
 return {sales,target_percent:target,burden_percent:burden,goal_percent:goal,labor_dollars:laborDollars,salaried_cost:salary,shared_cost:shared,fixed_leadership:leadership,leadership_missing:salary===null,crew_dollars:crewDollars,crew_rate:rate,affordable_crew_hours:affordable,affordable_hours:affordable===null?null:round(Math.max(0,crewDollars)/rate+salariedHours,1),salaried_hours:salariedHours,budget_hours:hours,recommended_hours:revenue?revenue.hours:n(plan?.model?.recommended_hours),binding:revenue?revenue.inputs.binding:null,lean,lean_hours:revenue?revenue.inputs.lean_hours:null,headroom_hours:revenue?revenue.inputs.headroom_hours:null,salaried_hours_in_budget:salariedHours,crew_hours:crewHours,crew_cost:crewCost,total_cost:total,labor_percent:total!==null&&sales>0?round(total/sales*100,1):null,hours_above_affordable:affordable!==null&&crewHours!==null?round(crewHours-affordable,1):null,definition:grossBasis?'crew_gross_wages_plus_leadership':'fully_loaded',hours_basis:c.budget_hours_basis||'unconfirmed',planning_mode:c.planning_mode||'calibrated',provisional:c.economic_inputs_confirmed!==true,rate_source:c.measured_cost_source||null,rate_as_of:c.measured_cost_as_of||null,hours_source:c.baseline_source||null,hours_as_of:c.baseline_as_of||null,floor_hours:n(c.minimum_hours)};
}
// Last week's plan versus actual. Final variance only when the edge function supplied it; otherwise a labeled
// provisional difference when both sides exist, plus the plain reasons it is not final. Missing stays missing.
function weekComparison(results){
 const r=results||{},p=r.projected||null,s=r.sales||null,h=r.hours||null,sales=(()=>{if(!p||p.sales==null||!s||s.amount==null)return null;const diff=round(Number(s.amount)-Number(p.sales),2),reasons=[];if(!s.final)reasons.push('actual sales are not final');if(p.sales_metric&&s.metric&&p.sales_metric!==s.metric)reasons.push('planned and actual use different sales definitions');if(String(s.metric||'').startsWith('unconfirmed'))reasons.push('net versus gross sales is unconfirmed');return {planned:Number(p.sales),actual:Number(s.amount),difference:r.sales_variance??diff,percent:Number(p.sales)>0?round(diff/Number(p.sales)*100,1):null,final:r.sales_variance!=null,reasons};})(),hours=(()=>{if(!p||p.hours==null||!h||h.amount==null)return null;const diff=round(Number(h.amount)-Number(p.hours),1),reasons=[];if(!h.final)reasons.push('timesheets are not final');if(h.basis==='total_hours'&&p.hours_basis!=='total_hours')reasons.push('worked hours include salaried staff; the budget basis is '+(p.hours_basis==='crew_hours'?'crew only':'unconfirmed'));else if(p.hours_basis==='unconfirmed'||!p.hours_basis)reasons.push('the budget hours basis is unconfirmed');return {planned:Number(p.hours),actual:Number(h.amount),difference:r.hours_variance??diff,final:r.hours_variance!=null,reasons};})();
 const missing=[];if(!p)missing.push('plan');if(!s||s.amount==null)missing.push('sales');if(!h||h.amount==null)missing.push('hours');
 return {week_start:r.week_start||null,week_end:r.week_end||null,sales,hours,missing};
}
// Portfolio totals for the end-of-run summary. Unknown values are excluded and counted, never treated as zero.
function portfolioSummary(rows){
 const plans=rows.map(r=>({row:r,plan:r.run?.plan||r.preview})),sum=(list,f)=>{const v=list.map(f).filter(x=>x!=null&&Number.isFinite(Number(x)));return {total:round(v.reduce((a,b)=>a+Number(b),0),2),count:v.length};};
 const sales=sum(plans,x=>x.plan?.forecast?.sales),hours=sum(plans,x=>x.plan?.decision?.hours),scheduled=sum(plans,x=>x.plan?.schedule?.scheduled_hours??(Array.isArray(x.row.schedule?.days)&&x.row.schedule.days.length===7?round(x.row.schedule.days.reduce((t,v)=>t+Number(v||0),0)):null)),labor=sum(plans,x=>x.plan?.financials?.estimated_labor_cost),comparableSales=sum(plans.filter(x=>x.plan?.financials?.estimated_labor_cost!=null),x=>x.plan?.forecast?.sales);
 const avg=x=>x.count?round(x.total/x.count,1):null;
 return {stores:rows.length,confirmed:rows.filter(r=>r.run?.status==='confirmed').length,sales,hours,scheduled,labor,labor_percent:comparableSales.total>0?round(labor.total/comparableSales.total*100,1):null,average:{sales:avg(sales),hours:avg(hours),scheduled:avg(scheduled),labor:avg(labor)}};
}
const api={revenueHours,budgetDerivation,weekComparison,portfolioSummary,fitScheduleToBudget,calendarWeeks,budgetCost,monthSummary,reviewSchedule,DAY_NAMES,provenance,chooseForecast,modelHours,dailyEnvelope,evaluateSchedule,plan};root.FranLaborAgentCore=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
