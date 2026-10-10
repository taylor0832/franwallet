/* Operator labor planning: prior-week sales, operator outlook, store framework, then manager handoff. */
(() => {
  "use strict";
  const E = escapeHtml,
    money = (v) =>
      v == null
        ? "—"
        : new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          }).format(v),
    money2 = (v) =>
      v == null
        ? "—"
        : new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(v),
    number = (v) =>
      v == null
        ? "—"
        : Number(v).toLocaleString("en-US", { maximumFractionDigits: 1 }),
    percent = (v) => (v == null ? "—" : number(v) + "%"),
    date = (v) =>
      v
        ? new Date(String(v).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          })
        : "Not recorded";
  const add = (s, n) =>
      new Date(Date.parse(s + "T12:00:00Z") + n * 86400000)
        .toISOString()
        .slice(0, 10),
    nextMonday = () => {
      const now = new Date(),
        iso = now.toISOString().slice(0, 10),
        dow = now.getUTCDay(),
        days = (8 - dow) % 7 || 7;
      return add(iso, days);
    };
  const Core = window.FranLaborAgentCore;
  let period = "week", month = nextMonday().slice(0,7), monthData = null;
  let week = nextMonday(),
    locations = [],
    detail = null,
    busy = false,
    message = "",
    sequence = 0,
    returnRoute = "payroll",
    activeDay = 0,
    selectedEmployee = "",
    rosterSearch = "",
    templateName = "Standard week";
  let errorMessage = "",
    shownMessage = "",
    toastTimer = null;
  // Status lives in a toast so confirmations stay visible wherever the operator is working.
  const toast = document.createElement("div");
  toast.className = "la-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  document.body.append(toast);
  function showToast() {
    const active = page.classList.contains("active");
    if (message === shownMessage && active) return;
    shownMessage = message;
    clearTimeout(toastTimer);
    if (!message || !active) return toast.classList.remove("show", "error");
    const error = message === errorMessage;
    toast.textContent = message;
    toast.classList.remove("show");
    void toast.offsetWidth;
    toast.classList.add("show");
    toast.classList.toggle("error", error);
    if (!error) toastTimer = setTimeout(() => toast.classList.remove("show"), 6000);
  }
  const page = document.createElement("section");
  page.id = "page-labor-agent";
  page.className = "page";
  document.querySelector("#view-wallet .main").append(page);
  const demo = window.FranLaborDemo?.active ? window.FranLaborDemo : null;
  async function api(action, body = {}) {
    // Demo mode answers from a sanitized, session-only fixture. No network request is made.
    if (demo) return demo.api(action, body);
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session) throw Error("Sign in again to plan labor.");
    const response = await fetch(SUPABASE_URL + "/functions/v1/labor-agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: "Bearer " + session.access_token,
        },
        body: JSON.stringify({ action, ...body }),
      }),
      data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw Error(data.error || "Labor planning could not load.");
    return data;
  }
  // Operators know their point of sale, not the internal portal's name.
  const pos = (v) => String(v ?? "").replace(/Crumbl Internal/g, "Point of sale").replace(/Imported daily POS summaries/g, "Point of sale daily summaries");
  function currentSales(row) { return row.prior_week_sales?.complete && !row.prior_week_sales?.stale && row.prior_week_sales.start === add(week,-7); }
  function status(row) {
    if (row.run?.status === "confirmed") return [row.run.approval_review?.exception_reason ? "Confirmed · exception" : "Confirmed", "confirmed"];
    if (!currentSales(row)) return [(row.prior_week_sales?.complete ? "Sales need review" : "Needs sales input") + (row.run ? " · draft" : ""), "needs"];
    if (row.run) {
      const plan = row.run.plan || row.preview,
        assigned = (row.run.assignments || []).reduce(
          (sum, item) => sum + Number(item.hours || 0),
          0,
        );
      if (assigned > Number(plan.decision.hours || 0) + 0.5)
        return ["Over budget · draft", "needs"];
      return ["In progress · draft", "draft"];
    }
    if (!row.prior_week_sales?.complete) return ["Needs sales input", "needs"];
    if (row.schedule?.days) return ["Schedule available", "ready"];
    return ["Ready to plan", "ready"];
  }
  // Store list: one short line on where the starting sales came from.
  function source(row) {
    const ps = row.prior_week_sales, sd = (v) => date(v).replace(/, \d{4}$/, "");
    if (ps?.stale) return "Historical reference · last closed " + sd(ps.end);
    if (!ps?.complete && !row.run) return "Sales not in yet";
    const p = row.preview.forecast.provenance, asOf = p.as_of || (ps?.complete ? ps.end : null);
    return E(/projection|workbook/i.test(String(p.type || "")) ? "Forecast" : "Point of sale") + (asOf ? " · closed " + sd(asOf) : "");
  }
  // Queue column: the exact-week When I Work schedule when one exists, else the FranWallet draft.
  function scheduleCell(row, plan) {
    const schedule = plan.schedule;
    if (schedule.scheduled_hours != null)
      return (
        "<strong>" + number(schedule.scheduled_hours) + " h" +
        (Math.abs(schedule.variance) > 0.5
          ? " · " + (schedule.variance > 0 ? "+" : "") + number(schedule.variance) + " h vs budget"
          : " · on budget") +
        "</strong><small>" + E(freshness(row)) + "</small>"
      );
    const drafted = (row.run?.assignments || row.assignments || []).reduce(
      (sum, item) => sum + Number(item.hours || assignmentHours(item) || 0),
      0,
    );
    if (drafted)
      return (
        "<strong>" + number(drafted) + " / " + number(plan.decision.hours) + " h drafted</strong><small>FranWallet schedule draft</small>"
      );
    return '<span class="la-muted">Not started</span>';
  }
  function freshness(row) {
    if (row.schedule)
      return "When I Work · " + date(row.schedule.updated_at.slice(0, 10));
    return "No matching schedule saved";
  }
  function outlook(f) {
    const p = Number(f.adjustment_percent || 0);
    return p === 0
      ? "about the same"
      : (p > 0 ? "up " : "down ") + Math.abs(p) + "%";
  }
  function priorValue(row, decision) {
    return (
      decision.forecast.base_sales ??
      (row.prior_week_sales?.complete ? row.prior_week_sales.sales : null)
    );
  }
  const signed = (v, f) => (v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + f(Math.abs(v)));
  // Last week: planned versus actual. Final variance when sources are final; otherwise a labeled provisional
  // difference. When something is missing, one sentence says what and when it arrives.
  function priorResults(row){
    const r=row.prior_week_results,lastStart=r?.week_start||add(week,-7),lastEnd=r?.week_end||add(lastStart,6),cmp=Core.weekComparison(r||{week_start:lastStart,week_end:lastEnd}),p=r?.projected,s=r?.sales,h=r?.hours;
    const when={plan:"No FranWallet plan was saved for that week, so there is nothing to compare against.",sales:"Actual sales for that week are not in FranWallet yet; they fill in after the closed week is collected from Crumbl Internal (Sunday morning) or imported from the workbook.",hours:"Worked hours for that week are not in FranWallet yet; they fill in after When I Work timesheets are imported (timesheets close Sunday)."};
    const line=(label,planned,actual,c,fmt,unit)=>'<tr><th scope="row">'+label+'</th><td>'+planned+'</td><td>'+actual+'</td><td>'+(c?'<strong>'+signed(c.difference,fmt)+unit+(c.percent!=null?' ('+signed(c.percent,v=>number(v)+'%')+')':'')+info(label.toLowerCase()+" difference","Actual "+fmt(c.actual)+unit+" − planned "+fmt(c.planned)+unit+" = "+signed(c.difference,fmt)+unit+(c.percent!=null?" ("+signed(c.percent,v=>number(v)+"%")+" of planned)":"")+". "+(c.final?"Both sources are final.":"Provisional: "+c.reasons.join("; ")+"."))+'</strong><small>'+(c.final?'Final':'Provisional · '+E(c.reasons.join('; ')))+'</small>':'<span class="la-muted">Not available</span>')+'</td></tr>';
    const src=x=>x?E(pos(x.source))+' · through '+date(x.through)+(x.final?' · final':' · not final'):null;
    return '<section class="la-prior-results" aria-labelledby="la-prior-heading"><h2 id="la-prior-heading">Last closed week: planned versus actual</h2><p>'+E(date(cmp.week_start||lastStart)+' – '+date(cmp.week_end||lastEnd))+(row.in_progress_week?' · this week ('+date(row.in_progress_week.start)+'–'+date(row.in_progress_week.end)+') is still in progress; its results appear after it closes Sunday':'')+'</p>'+
      '<div class="la-table la-compact-table"><table><thead><tr><th scope="col"></th><th scope="col">Planned</th><th scope="col">Actual</th><th scope="col">Difference</th></tr></thead><tbody>'+
      line('Sales',money(p?.sales??null),money(s?.amount??null),cmp.sales,money,'')+
      line('Hours',p?.hours==null?'—':number(p.hours)+' h budget',h?.amount==null?'—':number(h.amount)+' h worked'+(h.basis==='total_hours'?' (incl. salaried)':''),cmp.hours,v=>number(v),' h')+
      '</tbody></table></div>'+
      (cmp.missing.length?'<p class="la-missing-note">'+E(when[cmp.missing[0]])+'</p>':'')+
      '<details data-la-keep="la-sources" class="la-sources"><summary>Sources for last week</summary><ul>'+[['Plan',p?E(p.source||'Saved FranWallet plan'):null],['Sales',src(s)],['Hours',src(h)]].map(([k,v])=>'<li><b>'+k+':</b> '+(v||'not imported')+'</li>').join('')+'</ul><p>Differences stay provisional until sources are final and use the same sales and hours definitions.</p></details></section>';
  }
  // One quiet info button for every computed number: click/Enter toggles a short plain-language explanation with the
  // actual numbers, source and date. Esc or an outside click closes it. Positioned below the button, never over the value.
  let tipSeq = 0;
  function info(label, text) {
    if (!text) return "";
    const id = "la-tip-" + ++tipSeq;
    return '<span class="la-info-wrap"><button type="button" class="la-info" data-la-info aria-expanded="false" aria-controls="' + id + '" aria-label="How ' + E(label) + ' is calculated"></button><span class="la-tip" id="' + id + '" role="tooltip" hidden>' + E(text) + "</span></span>";
  }
  const isTeam = (row) => row?.access === "team_member";
  const gustoPeriod = (row) => { const ev = row.economics_evidence; return ev ? "Gusto " + date(ev.period_start) + "–" + date(ev.period_end) : (row.config.measured_cost_source ? row.config.measured_cost_source + (row.config.measured_cost_as_of ? " · " + date(row.config.measured_cost_as_of) : "") : "source not recorded"); };
  const bindingLabel = { labor_target: "labor target", lean_check: "last week’s staffing scaled to sales", floor: "skeleton floor 110 h", saved_budget: "saved store budget (labor cost inputs missing)" };
  function projectionTip(row, sales) {
    const f = (row.run?.plan || row.preview).forecast, base = Number(detail && page.querySelector("#la-plan-form [name=last_week_sales]")?.value) || f.base_sales, src = pos(row.prior_week_sales?.source || f.provenance?.source || "operator entry");
    if (!(sales > 0) || !(base > 0)) return "Projected sales appear once last week’s sales are entered.";
    const pct = Math.round((sales / base - 1) * 1000) / 10;
    return money(base) + " last week " + (pct === 0 ? "× 1 (flat)" : (pct > 0 ? "+ " : "− ") + number(Math.abs(pct)) + "%") + " = " + money(sales) + " projected. Last week: " + src + ".";
  }
  // Recommended (budget) vs Scheduled in When I Work vs Difference, each with its source.
  // When I Work hours count confirmed (published) shifts only; unpublished drafts are shown separately, never added.
  function wiwScheduled(row,decision){
    const sch=row.schedule,fromPlan=decision.schedule?.scheduled_hours,days=Array.isArray(sch?.days)?sch.days.map(Number):null;
    const hours=fromPlan!=null?Number(fromPlan):days&&days.length===7?Math.round(days.reduce((a,b)=>a+b,0)*10)/10:null;
    return {hours,unpublished:Number(sch?.unpublished_hours||0),basis:sch?.basis||null,range:sch?.start&&sch?.end?date(sch.start)+"–"+date(sch.end):null,imported:String(sch?.imported_at||sch?.updated_at||"").slice(0,10)||null,source:sch?.source||"When I Work"};
  }
  function hoursTrio(row,decision,hours=decision.decision.hours,live=null){
    const w=wiwScheduled(row,decision),pub=w.hours,draft=Number(w.unpublished||0),d=live||Core.budgetDerivation(row.config,{...decision,decision:{...decision.decision,hours}}),revenue=d.planning_mode==="revenue",rec=revenue?d.recommended_hours:decision.model.recommended_hours,budget=Number(hours),range=date(week)+"–"+date(add(week,6));
    const recTip=revenue?recommendationTip(row,d):number(rec)+" h from "+(row.config.baseline_source||"the store framework")+" · "+date(row.config.baseline_as_of)+".";
    const schedTip=pub!=null?"Published shifts for "+range+" in the When I Work export "+(w.range||"")+", imported "+date(w.imported)+". Total hours, salaried staff included."+(draft>0?" "+number(draft)+" h of draft shifts are shown separately and are not counted until the manager publishes them.":""):"No When I Work export covering "+range+" has been imported. Missing is shown as missing, not zero.";
    const scale=Math.max(budget,(pub||0)+draft,1)*1.1,pct=v=>Math.max(0,Math.min(100,(Number(v)||0)/scale*100));
    const head=pub==null?"Not imported yet":pub===0?"0 h published":number(pub)+" h published",diff=pub==null?null:Math.round((pub-budget)*10)/10;
    const note=pub==null?"Arrives with the Sunday-night import":pub===0&&draft>0?number(draft)+" h drafted, not published yet":pub===0?"No shifts yet":(Math.abs(diff)<=0.5?"Matches your budget":number(Math.abs(diff))+" h "+(diff>0?"over":"under")+" budget")+(draft>0?" · "+number(draft)+" h more drafted":"");
    const why=pub===0&&draft>0?"The manager has "+number(draft)+" h drafted for "+range+" but hasn’t published any shifts yet. Drafts can still change, so they don’t count until they’re published.":"";
    return '<div class="la-trio" data-la-trio>'+
      '<div class="la-rec"><span class="la-card-label">Recommended</span><strong>'+number(rec)+' h'+info("recommended hours",recTip)+'</strong><small>'+(revenue?'Set by the '+E(bindingLabel[d.binding]||'labor target')+' · '+percent(d.goal_percent)+' of '+money(d.sales)+' · floor '+number(d.floor_hours)+' h':'From '+E(row.config.baseline_source||'the store framework')+' · floor '+number(row.config.minimum_hours)+' h')+'</small>'+(revenue&&rec!=null&&Math.abs(rec-budget)>0.01&&row.run?.status!=="confirmed"?'<button type="button" class="la-use-rec" data-la-use-rec="'+E(rec)+'">Use '+number(rec)+' h</button>':'')+'</div>'+
      '<div class="la-wiw"><span class="la-card-label">Confirmed in When I Work <em>'+E(range)+'</em></span><strong>'+E(head)+info("scheduled hours",schedTip)+'</strong>'+
      (pub!=null?'<div class="la-wiw-bar" role="img" aria-label="'+E(number(pub)+" h published, "+number(draft)+" h drafted, budget "+number(budget)+" h")+'"><i class="pub" style="width:'+pct(pub)+'%"></i><i class="draft" style="width:'+pct(draft)+'%"></i><b style="left:'+pct(budget)+'%"><span>Budget '+number(budget)+' h</span></b></div>':'')+
      '<small>'+E(note)+(why?'<span class="la-why">'+E(why)+'</span>':'')+'</small>'+(w.imported?'<span class="la-chip-src"><i></i>When I Work · imported '+date(w.imported)+'</span>':'')+'</div>'+
      modelNote(row)+'</div>';
  }
  // The store's own labor model (Rachel's "Labor Model Info" sheet), shown as a reference beside the recommendation.
  function modelNote(row){const m=row.config.labor_model;if(!m)return "";return '<p class="la-model-note"><b>Your labor model</b> '+(m.budget_hours!=null?number(m.budget_hours)+' h weekly budget':'')+(m.outline_hours!=null?' · '+number(m.outline_hours)+' h minimum daily outline':'')+(m.salaried_names?.length?' · salaried: '+E(m.salaried_names.join(', ')):'')+info("store labor model",(m.source||"Store labor model")+(m.as_of?" · "+date(m.as_of):"")+". Shown for comparison; the recommendation comes from projected sales, the labor target and the "+number(row.config.minimum_hours)+" h floor."+(m.note?" "+m.note:""))+'</p>';}
  // Where every number on the page comes from, so the operator can check it against the source systems.
  function provenance(row){
    const cs=row.closed_week_sales||(row.prior_week_sales?.complete&&!["projection","workbook_actual"].includes(row.prior_week_sales?.kind)?row.prior_week_sales:null),sch=row.schedule,ev=row.economics_evidence,c=row.config,imported=String(sch?.imported_at||sch?.updated_at||"").slice(0,10);
    const item=(sys,value,ok,tip)=>'<li class="'+(ok?'':'missing')+'"><i aria-hidden="true"></i><b>'+E(sys)+'</b><span>'+E(value)+'</span>'+info(sys.toLowerCase(),tip)+'</li>';
    return '<section class="la-provenance" aria-labelledby="la-prov-heading"><h2 id="la-prov-heading">Built from</h2><ul>'+
      item("Point of sale",cs?.start?date(cs.start).replace(/, \d{4}$/,"")+"–"+date(cs.end).replace(/, \d{4}$/,"")+(cs.sales!=null?" · "+money(cs.sales):""):"Not in yet",!!cs?.start,"Net sales for the last closed Monday–Saturday week, collected from your point of sale on Sunday morning. It is the starting point for next week’s projection.")+
      item("When I Work",imported?"Imported "+date(imported).replace(/, \d{4}$/,""):"Not in yet",!!imported,"Shifts from the When I Work schedule export for "+date(week)+"–"+date(add(week,6))+". Published shifts count as confirmed; drafts are shown separately.")+
      item("Gusto",ev?new Date(ev.period_start+"T12:00:00Z").toLocaleDateString("en-US",{month:"short",timeZone:"UTC"})+" payroll":c.measured_cost_as_of?"Measured "+date(c.measured_cost_as_of).replace(/, \d{4}$/,""):"Not in yet",!!(ev||c.blended_hourly_cost),"Crew cost per hour and salaried cost from the latest complete Gusto payroll: wages plus employer taxes, tips excluded.")+
      item("Your rules",percent(c.target_labor_percent)+" target · "+number(c.minimum_hours??110)+" h floor",true,"Set by the store owner. Recommendations aim at the labor target and never go below the floor. Tips never count as labor.")+
      '</ul></section>';
  }
  function recommendationTip(row,d){
    if(d.sales==null)return "Enter last week’s sales to get a recommendation.";
    const a=d.affordable_hours!=null?"Labor target: "+number(d.affordable_hours)+" h":"Labor target: not available (crew rate missing)",b=d.lean_hours!=null?"last week’s staffing "+number(d.lean.hours)+" h × ("+money(d.sales)+" ÷ "+money(d.lean.sales)+") = "+number(d.lean_hours)+" h":"no comparable last week";
    return a+"; "+b+". FranWallet takes the lower, rounds down to the half hour, and never goes below "+number(d.floor_hours)+" h → "+number(d.recommended_hours)+" h, set by the "+(bindingLabel[d.binding]||"labor target")+".";
  }
  function liveDecision(decision,form){
    if(!form)return decision;
    const last=Number(form.elements.last_week_sales?.value||0),dir=form.elements.direction?.value,chosen=form.querySelector("[name=change_percent]:checked"),pct=chosen?.value==="custom"?Math.abs(Number(form.elements.custom_percent.value||0)):Math.abs(Number(chosen?.value||0)),factor=dir==="down"?1-pct/100:dir==="up"?1+pct/100:1,hours=Number(form.elements.hours?.value);
    return {...decision,forecast:{...decision.forecast,sales:last>0?Math.round(last*factor*100)/100:null,adjustment_percent:dir==="down"?-pct:dir==="up"?pct:dir==="same"?0:decision.forecast.adjustment_percent},decision:{...decision.decision,hours:Number.isFinite(hours)&&hours>0?hours:decision.decision.hours}};
  }
  // Labor dollars, labor % and affordable hours for whatever hours the operator picks. Tips are never labor cost.
  function budgetResult(row,decision,d=Core.budgetDerivation(row.config,decision)){
    const known=d.sales!=null&&d.sales>0;
    if(d.total_cost==null)return '<div class="la-budget-result missing" data-la-budget-result><strong>Labor cost pending</strong><small>'+(isTeam(row)?'The store owner has not recorded a measured crew cost per hour yet.':'Add a measured crew cost per hour under “How we got these hours” to calculate labor dollars and labor %.')+'</small></div>';
    const costTip=number(d.budget_hours)+" h − "+number(d.salaried_hours)+" salaried h = "+number(d.crew_hours)+" crew h × "+money2(d.crew_rate)+" = "+money(d.crew_cost)+", + "+money(d.fixed_leadership)+" salaried = "+money(d.total_cost)+". Employer cost, excluding tips · "+gustoPeriod(row)+".";
    const goal=d.goal_percent,within=known&&d.labor_percent!=null&&goal!=null&&d.labor_percent<=goal+0.05;
    return '<div class="la-budget-result" aria-live="polite" data-la-budget-result><div class="la-br-main"><span>Weekly labor</span><strong><span data-la-labor-cost>'+money(known?d.total_cost:null)+'</span>'+info("estimated weekly labor",costTip)+'</strong></div><div class="la-br-main"><span>Labor % of sales</span><strong><span data-la-labor-percent>'+percent(known?d.labor_percent:null)+'</span>'+info("labor %",money(d.total_cost)+" ÷ "+money(d.sales)+" projected sales = "+percent(d.labor_percent)+". Fully loaded employer cost, excluding tips.")+'</strong>'+(known&&goal!=null?'<em class="la-goal-chip '+(within?'ok':'warn')+'">'+(within?'Within '+percent(goal)+' goal':number(Math.round((d.labor_percent-goal)*10)/10)+' pts above '+percent(goal)+' goal')+'</em>':'')+'</div><div><span>'+percent(goal)+' target allows</span><strong>'+(d.affordable_hours==null?'—':number(d.affordable_hours)+' h')+info("hours affordable",d.affordable_hours==null?"Needs a crew cost per hour.":money(d.labor_dollars)+" labor budget − "+money(d.fixed_leadership)+" salaried = "+money(d.crew_dollars)+" ÷ "+money2(d.crew_rate)+" per crew hour = "+number(d.affordable_crew_hours)+" crew h + "+number(d.salaried_hours)+" salaried h.")+'</strong></div><p>Employer cost incl. payroll taxes · tips never counted · hours include salaried staff'+info("how labor is calculated",laborDefinition(row))+'</p></div>';
  }
  // "How we got N hours": the budget math in plain language, every number with its source.
  function derivationBody(row,decision){
    const d=Core.budgetDerivation(row.config,decision),ev=row.economics_evidence,revenue=d.planning_mode==="revenue",step=(text,src)=>'<li><span class="la-math">'+text+'</span>'+(src?'<small>'+src+'</small>':'')+'</li>';
    if(d.sales==null)return '<p>Enter last week’s sales to see the labor math.</p>';
    if(d.crew_rate==null)return '<p><b>'+number(d.budget_hours)+' h</b>'+(revenue&&d.lean_hours!=null?' follows last week’s staffing scaled to sales ('+number(d.lean_hours)+' h), capped at the saved budget and the '+number(d.floor_hours)+' h floor.':' come from '+E(d.hours_source||'the store framework')+'.')+' Labor dollars need a measured crew cost per hour'+(isTeam(row)?'; the store owner can add it.':'; add it under “Edit these inputs”.')+'</p>';
    const sal=(ev?.salaried_people!=null?ev.salaried_people+(ev.salaried_people===1?' salaried person':' salaried people')+' on this store’s Gusto payroll':'Salaried staff on this store’s payroll')+(row.config.salaried_hours_source==='assumed'||ev?.salaried_hours_source==='assumed'?' · hours assumed 40 h per person — edit':'');
    const lead=revenue?'<p class="la-derivation-lead">Hours follow projected sales. Budget hours always include salaried staff, and tips never count as labor cost.</p>':'<p class="la-derivation-lead"><b>'+number(d.budget_hours)+' h</b> is the budget; '+E(row.wallet.name)+'’s store framework sets '+number(row.config.baseline_hours)+' h. Here is what that costs and what the labor target would afford:</p>';
    return lead+'<ol class="la-derivation-steps">'+
      step(money(d.sales)+' projected sales × '+percent(d.goal_percent)+' target = <b>'+money(d.labor_dollars)+'</b> labor budget'+info("the labor budget",money(d.sales)+" × "+percent(d.goal_percent)+" = "+money(d.labor_dollars)+", fully loaded employer cost excluding tips. Target is the store’s saved labor % ("+(d.provisional?"not yet confirmed":"confirmed")+")."),'Target labor % '+percent(d.target_percent)+' · '+(isTeam(row)?'set by the store owner':'editable below'))+
      step('− '+money(d.fixed_leadership)+' salaried cost per week'+info("salaried cost",(d.leadership_missing?"No salaried cost recorded; counted as $0.":money(d.salaried_cost)+" per week: salaried gross pay × employer-cost ratio ÷ weeks, excluding tips · "+gustoPeriod(row)+"."+(d.shared_cost?" Plus "+money(d.shared_cost)+" shared leadership.":"")))+' = <b>'+money(d.crew_dollars)+'</b> for crew',E(sal)+'. Owner draws and area leadership are not included unless added as shared leadership.')+
      step('÷ '+money2(d.crew_rate)+' per crew hour'+info("crew rate",money2(d.crew_rate)+" per hour = (crew gross pay − customer tips) × employer-cost ratio ÷ crew paid hours · "+gustoPeriod(row)+". Tips are excluded."+(ev?" "+money(ev.tips_excluded_per_week)+"/week of tips were removed.":""))+' = '+number(d.affordable_crew_hours)+' crew h, + '+number(d.salaried_hours)+' salaried h'+info("salaried hours",number(d.salaried_hours)+" h per week "+(row.config.salaried_hours_source==='assumed'||ev?.salaried_hours_source==='assumed'?"assumed at 40 h per salaried person (edit if different)":"from Gusto salaried paid hours ÷ weeks")+" · "+gustoPeriod(row)+".")+' = <b>A: '+number(d.affordable_hours)+' h</b> the target affords',E(gustoPeriod(row))+' · employer cost excluding tips.')+
      (revenue?step(d.lean_hours!=null?'Lean check: '+number(d.lean.hours)+' h worked '+(d.lean.week_start?'the week of '+date(d.lean.week_start):'last week')+' × ('+money(d.sales)+' ÷ '+money(d.lean.sales)+') = <b>B: '+number(d.lean_hours)+' h</b>'+info("the lean check",number(d.lean.hours)+" total hours worked (crew + salaried) on "+money(d.lean.sales)+" in sales, scaled to "+money(d.sales)+" = "+number(d.lean_hours)+" h · "+(d.lean.source||"When I Work timesheets and sales")+(d.lean.final?"":" · provisional")+"."):'Lean check: no comparable last week with worked hours and sales yet.',d.lean_hours!=null?E(d.lean.source||'When I Work timesheets')+(d.lean.final?'':' · provisional'):'')+
        step('Recommended: lower of A and B, rounded down to the half hour, never below '+number(d.floor_hours)+' h'+info("the skeleton floor",number(d.floor_hours)+" h is the minimum coverage skeleton for every store; recommendations never go below it.")+' = <b>'+number(d.recommended_hours)+' h</b>, set by the '+E(bindingLabel[d.binding]||'labor target')+info("recommended hours",recommendationTip(row,d)),d.headroom_hours>0?'If sales beat the forecast, you can add up to '+number(d.headroom_hours)+' h and stay at target.':'At the recommendation there is no room under the target; add hours only if sales come in higher.'):'')+
      '</ol><p class="la-derivation-result">At your '+number(d.budget_hours)+' h: '+number(d.crew_hours)+' crew h × '+money2(d.crew_rate)+' = '+money(d.crew_cost)+' + '+money(d.fixed_leadership)+' salaried = <b>'+money(d.total_cost)+'</b>, '+percent(d.labor_percent)+' of projected sales.</p>'+
      (ev&&!isTeam(row)&&row.pro&&row.run?.status!=='confirmed'&&ev.crew_rate_excluding_tips!=null&&(Number(ev.crew_rate_excluding_tips)!==Number(row.config.blended_hourly_cost)||Number(ev.weekly_salaried_cost)!==Number(row.config.weekly_salaried_cost)||Number(ev.salaried_hours_per_week)!==Number(row.config.salaried_schedule_hours))?'<div class="la-evidence"><b>Latest complete Gusto period: '+date(ev.period_start)+'–'+date(ev.period_end)+'</b><p>Crew '+money2(ev.crew_rate_excluding_tips)+'/h · salaried '+money(ev.weekly_salaried_cost)+'/week · '+number(ev.salaried_hours_per_week)+' salaried h/week'+(ev.salaried_hours_source==='assumed'?' (assumed)':'')+'. Employer cost, excluding tips.</p><button type="button" class="btn btn-ghost" data-la-use-evidence>Use these Gusto values</button><small>Fills the inputs below; nothing changes until you save them.</small></div>':'');
  }
  function hoursHelp(row,d){return d.planning_mode==="revenue"?"Includes salaried staff"+(d.headroom_hours>0?" · room to add up to "+number(d.headroom_hours)+" h and stay at target":"")+".":"From the store framework. Change it only for a reason you can explain.";}
  function laborDefinition(row){
    return 'Labor % = (crew hours × crew cost per hour + salaried cost) ÷ projected sales. Fully loaded employer cost (wages and employer payroll taxes); tips are never counted. Hours include salaried staff.'+(row.config.economic_inputs_confirmed===true?'':' Provisional until the store owner confirms the inputs.');
  }
  const approvalState=row=>(row.approval||(row.approval={ack:false,approve:false,reason:""}));
  function needsAck(row){const s=(row.run?.plan||row.preview)?.forecast?.source_status;return (!!s&&s!=="closed_prior_week")||!currentSales(row);}
  function reasonNeeded(row,decision){const cost=Core.budgetCost(row.config,decision.decision.hours),goal=decision.financials?.labor_goal_percent??row.config.target_labor_percent,sales=Number(decision.forecast.sales);return cost!=null&&goal!=null&&sales>0&&cost>sales*goal/100+0.01;}
  function nextAfter(row){const i=locations.findIndex(r=>r.wallet.id===row.wallet.id);for(let k=1;k<locations.length;k++){const r=locations[(i+k)%locations.length];if(r.run?.status!=="confirmed")return r;}return null;}
  let summaryOpen=false;
  const justPlanned=new Set();
  let scrollToDay=false,guideOnOpen=false;
  const smooth=()=>window.matchMedia?.("(prefers-reduced-motion: reduce)").matches?"auto":"smooth";
  // Move to a step: open it if collapsed, bring it to the top, and put focus on its heading.
  function goTo(id){const el=document.getElementById(id);if(!el)return;if(el.tagName==="DETAILS"&&!el.open){el.open=true;if(detail)detail.schedule_open=true;}el.scrollIntoView({block:"start",behavior:smooth()});(el.querySelector("h2")||el.querySelector("summary"))?.focus?.({preventScroll:true});}
  function summaryDrawer(){
    const s=Core.portfolioSummary(locations),avgNote=(x,unit)=>x.count?'Average '+unit(x.total/x.count)+' per store · '+x.count+' of '+s.stores+' stores':'No store has this yet';
    return '<div class="la-drawer-backdrop" data-la-summary-close></div><aside class="la-drawer" role="dialog" aria-modal="true" aria-labelledby="la-summary-heading"><header><div><span class="la-kicker">'+E(date(week)+' – '+date(add(week,6)))+'</span><h2 id="la-summary-heading" tabindex="-1">Portfolio summary</h2><p>'+s.confirmed+' of '+s.stores+' budgets approved.'+(s.confirmed<s.stores?' Unapproved stores show their saved draft or recommendation.':'')+'</p></div><button type="button" class="btn btn-ghost" data-la-summary-close aria-label="Close portfolio summary">Close</button></header>'+
      '<dl class="la-summary-totals"><div><dt>Projected sales</dt><dd>'+money(s.sales.total)+info("total projected sales","Sum of each store’s projected sales ("+s.sales.count+" stores): "+locations.map(r=>money((r.run?.plan||r.preview).forecast.sales)).join(" + ")+" = "+money(s.sales.total)+".")+'</dd><small>'+avgNote(s.sales,money)+'</small></div><div><dt>Budgeted hours</dt><dd>'+number(s.hours.total)+' h'+info("total budgeted hours","Sum of each store’s saved or recommended weekly hours, including salaried staff: "+locations.map(r=>number((r.run?.plan||r.preview).decision.hours)).join(" + ")+" = "+number(s.hours.total)+" h.")+'</dd><small>'+avgNote(s.hours,v=>number(v)+' h')+'</small></div><div><dt>Scheduled in When I Work</dt><dd>'+(s.scheduled.count?number(s.scheduled.total)+' h':'Not imported')+info("total scheduled hours",s.scheduled.count?"Sum of confirmed (published) When I Work shifts for "+s.scheduled.count+" stores = "+number(s.scheduled.total)+" h. Unpublished drafts and stores without an import are left out, not counted as zero.":"No store has an exact-week When I Work schedule imported for this week.")+'</dd><small>'+avgNote(s.scheduled,v=>number(v)+' h')+'</small></div><div><dt>Projected labor</dt><dd>'+money(s.labor.total)+info("total projected labor","Sum of each store’s estimated labor ("+s.labor.count+" stores with a crew rate) = "+money(s.labor.total)+(s.labor_percent!=null?"; ÷ their projected sales = "+percent(s.labor_percent):"")+". Employer cost excluding tips; hours include salaried staff.")+'</dd><small>'+(s.labor_percent!=null?percent(s.labor_percent)+' of sales at those '+s.labor.count+' stores · ':'')+avgNote(s.labor,money)+'</small></div></dl>'+
      '<div class="la-table la-compact-table"><table><thead><tr><th scope="col">Store</th><th scope="col">Status</th><th scope="col">Sales</th><th scope="col">Budget</th><th scope="col">Scheduled</th><th scope="col">Labor</th></tr></thead><tbody>'+locations.map(r=>{const p=r.run?.plan||r.preview,f=p.financials||{};return '<tr><th scope="row">'+E(r.wallet.name)+'</th><td>'+E(status(r)[0])+'</td><td>'+money(p.forecast.sales)+'</td><td>'+number(p.decision.hours)+' h</td><td>'+(wiwScheduled(r,p).hours!=null?number(wiwScheduled(r,p).hours)+' h':'—')+'</td><td>'+(f.estimated_labor_cost!=null?money(f.estimated_labor_cost)+' · '+percent(Math.round(f.estimated_labor_cost/p.forecast.sales*1000)/10):'—')+'</td></tr>';}).join('')+'</tbody></table></div>'+
      '<p class="la-handoff-note">Sales are each store’s projection; labor is fully loaded employer cost excluding tips, and hours include salaried staff; scheduled hours count only exact-week When I Work imports. Missing values are excluded, not counted as zero. FranWallet has not changed any When I Work schedule.</p><div class="la-next-buttons"><button type="button" class="btn btn-primary" data-la-copy-summary>Copy portfolio summary</button><button type="button" class="btn btn-ghost" data-la-copy-all>Copy all manager briefs</button></div></aside>';
  }
  function summaryText(){const s=Core.portfolioSummary(locations);return 'FranWallet portfolio labor summary · '+date(week)+'–'+date(add(week,6))+(demo?' [Demo data]':'')+'\n'+s.confirmed+' of '+s.stores+' budgets approved\nProjected sales: '+money(s.sales.total)+'\nBudgeted hours: '+number(s.hours.total)+' h\nScheduled in When I Work: '+(s.scheduled.count?number(s.scheduled.total)+' h ('+s.scheduled.count+' stores)':'not imported')+'\nProjected labor: '+money(s.labor.total)+(s.labor_percent!=null?' · '+percent(s.labor_percent)+' of sales ('+s.labor.count+' stores'+(locations.some(r=>r.config.economic_inputs_confirmed!==true)?', provisional':'')+', excluding tips)':'')+'\n\n'+locations.map(r=>{const p=r.run?.plan||r.preview;return r.wallet.name+': '+status(r)[0]+' · '+money(p.forecast.sales)+' · '+number(p.decision.hours)+' h'+(p.financials?.estimated_labor_cost!=null?' · '+money(p.financials.estimated_labor_cost):'');}).join('\n');}
  function coverageItems(row, decision) {
    const items = assignments(row);
    if (!items.length)
      return ["No FranWallet schedule yet; build every open day in When I Work."];
    const open = decision.envelope
      .map((day, index) => {
        if (!day.open) return null;
        const assigned = items
            .filter((item) => item.day === index)
            .reduce((sum, item) => sum + assignmentHours(item), 0),
          gap = Number(day.hours || 0) - assigned;
        if (Math.abs(gap) <= 0.5) return null;
        return (
          day.day +
          " " +
          (gap > 0
            ? number(gap) + "h unassigned"
            : number(Math.abs(gap)) + "h over the daily target")
        );
      })
      .filter(Boolean);
    return open.length ? open : [];
  }
  function displayedFinancials(decision){
    const f={...(decision.financials||{})},sales=Number(decision.forecast.sales);
    f.estimated_labor_percent=f.estimated_labor_cost!=null&&sales>0?Math.round(f.estimated_labor_cost/sales*1000)/10:null;
    return f;
  }
  const managerRules=decision=>decision.criteria.notes.map(note=>note.replace(/Plan to the [\d,.]+-hour store target\./,'Plan to the '+number(decision.decision.hours)+'-hour saved weekly budget.'));
  function managerBrief(row, decision = row.run?.plan || row.preview) {
    const days = decision.envelope
        .filter((d) => d.open)
        .map((d) => d.day + " " + number(d.hours) + "h")
        .join(" · "),
      prior = decision.forecast.base_sales,
      f = displayedFinancials(decision),
      confirmed = row.run?.status === "confirmed",
      coverage = coverageItems(row, decision),
      missing = decision.readiness?.missing || [];
    const assignmentText = scheduleBrief(row, decision, false);
    return (
      (demo ? "[Demo data · not a live plan]\n" : "") +
      row.wallet.name +
      " · labor plan for " +
      date(week) +
      "–" +
      date(add(week, 6)) +
      "\nStatus: " +
      (confirmed
        ? "Budget approved by the operator · ready for manager review"
        : row.run
          ? "Draft · awaiting operator approval"
          : "Recommendation · not yet approved") +
      "\n" +
      (prior
        ? "Last week sales: " +
          money(prior) +
          "\nOutlook: " +
          outlook(decision.forecast) +
          "\n"
        : "") +
      (decision.forecast.reason ? "Outlook reason: " + decision.forecast.reason + "\n" : "") +
      "Projected sales: " +
      money(decision.forecast.sales) +
      "\n" +
      (confirmed ? "Approved hours: " : "Weekly hour budget: ") +
      number(decision.decision.hours) +
      " hours\n" +
      (f?.estimated_labor_cost != null
        ? "Estimated labor: " +
          money(f.estimated_labor_cost) +
          " · " +
          percent(f.estimated_labor_percent) +
          " of projected sales" +
          (f.provisional ? " (provisional)" : "") +
          "\n"
        : "Estimated labor: pending measured employer cost\n") +
      "Daily targets: " +
      days +
      "\nOpen coverage: " +
      (coverage.length ? coverage.join("; ") : "none. Every open day matches its target.") +
      (missing.length ? "\nStill to confirm: " + missing.join("; ") : "") +
      "\nManager checks: " +
      managerRules(decision).join(" ") +
      (assignmentText ? "\n\nTeam schedule\n" + assignmentText : "") +
      "\n\nNext: the manager reviews this plan and builds or adjusts shifts in When I Work. Publishing stays a separate approval in When I Work; FranWallet has not changed any live schedule."
    );
  }
  const timeMinutes = (value) => {
    const parts=String(value||"00:00").split(":").map(Number);
    return parts[0]*60+parts[1];
  };
  const clock = (minutes) => {
    const safe=Math.max(0,Math.min(1440,Math.round(minutes/15)*15));
    return String(Math.floor(safe/60)).padStart(2,"0")+":"+String(safe%60).padStart(2,"0");
  };
  const timeLabel = (value) => {
    const minutes=timeMinutes(value),hour=Math.floor(minutes/60),minute=minutes%60;
    if(hour===24)return "12:00 AM";
    return ((hour+11)%12+1)+":"+String(minute).padStart(2,"0")+" "+(hour<12?"AM":"PM");
  };
  const assignmentHours = (item) => Math.max(0,(timeMinutes(item.end)-timeMinutes(item.start))/60-Number(item.break_hours||0));
  const timeOptions = (selected,includeMidnight=false) => {
    let html="";
    for(let minute=0;minute<24*60+(includeMidnight?1:0);minute+=30){const value=clock(minute);html+='<option value="'+value+'" '+(value===selected?'selected':'')+'>'+timeLabel(value)+'</option>';}
    if(selected && timeMinutes(selected)%30!==0)html+='<option value="'+E(selected)+'" selected>'+timeLabel(selected)+'</option>';
    return html;
  };
  function normalizeAssignment(item,index=0){
    if(item.start&&item.end) return {...item,hours:assignmentHours(item)};
    const starts={morning:"06:00",midday:"11:00",evening:"16:00"},start=starts[item.shift]||"08:00",end=clock(timeMinutes(start)+Number(item.hours||4)*60);
    return {...item,id:item.id||"assignment-"+(index+1),start,end,hours:assignmentHours({start,end})};
  }
  function assignments(row) {
    if (!Array.isArray(row.assignments)) row.assignments = Array.isArray(row.run?.assignments) ? row.run.assignments.map((item,index)=>normalizeAssignment(item,index)) : [];
    // Normalize in place: bound editors hold references to these exact shift objects.
    row.assignments=row.assignments.map((item,index)=>item.start&&item.end?Object.assign(item,{hours:assignmentHours(item)}):normalizeAssignment(item,index));
    return row.assignments;
  }
  function scheduleBrief(row,decision=row.run?.plan||row.preview,heading=true) {
    const items=assignments(row);
    if(!items.length)return "";
    const lines=decision.envelope.map((day,index)=>{
      const dayItems=items.filter(item=>item.day===index).sort((a,b)=>a.start.localeCompare(b.start));
      return day.day+": "+(dayItems.length?dayItems.map(item=>item.employee+" "+timeLabel(item.start)+"–"+timeLabel(item.end)+(item.position?" · "+item.position:"")).join("; "):"no assignments yet");
    });
    const total=items.reduce((sum,item)=>sum+assignmentHours(item),0);
    return (heading?row.wallet.name+" · working schedule for "+date(week)+"–"+date(add(week,6))+"\n":"")+lines.join("\n")+"\nAssigned: "+number(total)+" of "+number(decision.decision.hours)+" weekly hours";
  }
  function templateAssignments(value){
    return Array.isArray(value)?value.map((item,index)=>({...normalizeAssignment(item,index),id:(crypto.randomUUID?crypto.randomUUID():"assignment-"+Date.now()+"-"+index)})):[];
  }
  // Suggest who can cover an open day, using only imported roster tags and the current draft.
  // It is a suggestion: the operator adds it, and the manager confirms availability in When I Work.
  function gapSuggestion(roster,dayName,dayItems,remaining){
    if(remaining<0.75||!roster.length)return null;
    const abbr=dayName.slice(0,3).toLowerCase(),scheduled=new Set(dayItems.map(item=>item.employee)),tags=person=>(person.tags||[]).map(tag=>String(tag));
    const blocked=person=>tags(person).some(tag=>/time off|unavailable|not available/i.test(tag)&&tag.toLowerCase().includes(abbr));
    const offered=person=>tags(person).find(tag=>/availab/i.test(tag)&&!/unavailab/i.test(tag)&&tag.toLowerCase().includes(abbr));
    const candidates=roster.filter(person=>!scheduled.has(person.name)&&!blocked(person)&&!tags(person).some(tag=>/minor/i.test(tag)));
    const person=candidates.find(offered)||candidates.find(person=>person.common_start)||candidates[0];
    if(!person)return null;
    const hours=Math.min(8,Math.round(remaining*2)/2),start=Math.min(timeMinutes(person.common_start||"10:00"),22*60-hours*60);
    return {person,start:clock(start),end:clock(start+hours*60),hours,reason:offered(person)?"Marked “"+offered(person)+"” in the imported roster.":"Not on the "+dayName+" schedule yet"+(person.common_start?" · most common imported start "+timeLabel(person.common_start):"")+"."};
  }
  function renderScheduleBuilder(row,decision,isConfirmed){
    const roster=row.roster?.people||[],items=assignments(row),day=decision.envelope[activeDay]||decision.envelope[0],dayItems=items.filter(item=>item.day===activeDay).sort((a,b)=>a.start.localeCompare(b.start)),assigned=dayItems.reduce((sum,item)=>sum+assignmentHours(item),0),weeklyAssigned=items.reduce((sum,item)=>sum+assignmentHours(item),0),budget=Number(decision.decision.hours||0),remaining=Number(day.hours||0)-assigned,weeklyRemaining=budget-weeklyAssigned,daysOnTarget=decision.envelope.filter((entry,index)=>entry.open&&Math.abs(items.filter(item=>item.day===index).reduce((sum,item)=>sum+assignmentHours(item),0)-Number(entry.hours||0))<=.5).length,openDays=decision.envelope.filter(entry=>entry.open).length;
    const salariedNames=new Set((row.config.labor_model?.salaried_names||[]).map(x=>x.toLowerCase())),isSalaried=name=>salariedNames.has(String(name||"").toLowerCase()),salariedPlaced=items.filter(item=>isSalaried(item.employee)).reduce((sum,item)=>sum+assignmentHours(item),0);
    const live=Core.budgetDerivation(row.config,{...decision,decision:{...decision.decision,hours:weeklyAssigned}}),liveLine=items.length&&live.total_cost!=null&&live.sales?' · est. labor '+money(live.total_cost)+' = '+percent(live.labor_percent)+' of projected sales':'';
    const initials=name=>E(String(name).split(/\s+/).map(x=>x[0]).slice(0,2).join(""));
    const overBanner=!isConfirmed&&items.length&&weeklyRemaining<-0.5?'<div class="la-over-budget"><div><b>'+number(Math.abs(weeklyRemaining))+' h over your '+number(budget)+' h budget</b><span>Trim builds a version at or under budget by removing overlapping shifts first and shortening shifts where two people overlap. Single-coverage hours are never left empty.</span></div><button type="button" class="btn btn-primary" data-la-fit-budget>Trim to '+number(budget)+' h</button></div>':'';
    const filtered=roster.filter(person=>!rosterSearch||[person.name,person.role,...(person.tags||[])].join(" ").toLowerCase().includes(rosterSearch.toLowerCase()));
    const onToday=new Set(dayItems.map(item=>item.employee));
    const people=filtered.map(person=>'<div class="la-person-row'+(onToday.has(person.name)?' on-today':'')+'" data-la-person-row="'+E(person.name)+'"><button type="button" class="la-person '+(selectedEmployee===person.name?'selected':'')+'" aria-pressed="'+(selectedEmployee===person.name)+'" draggable="'+(!isConfirmed)+'" data-la-person="'+E(person.name)+'" title="Drag onto the timeline, or use + Add shift"><span class="la-avatar">'+initials(person.name)+'</span><span class="la-person-copy"><strong>'+E(person.name)+(onToday.has(person.name)?'<i class="la-on-dot" title="Scheduled '+E(day.day)+'" aria-label="Scheduled '+E(day.day)+'"></i>':'')+'</strong><small>'+E(person.role||"Team member")+(person.common_start?' · usually '+timeLabel(person.common_start)+(person.common_end?'–'+timeLabel(person.common_end):''):'')+'</small>'+(isSalaried(person.name)||(person.tags||[]).length?'<span class="la-person-tags">'+(isSalaried(person.name)?'<i class="la-salaried">Salaried</i>':'')+(person.tags||[]).slice(0,3).map(tag=>'<i>'+E(tag)+'</i>').join("")+'</span>':'')+'</span>'+'</button>'+(isConfirmed||!day.open?'':'<button type="button" class="la-add-shift" data-la-add-shift="'+E(person.name)+'" aria-label="Add a '+E(day.day)+' shift for '+E(person.name)+'"><span aria-hidden="true">+</span><span class="la-sr">Add shift</span></button>')+'</div>').join("");
    const saved=row.roster?.templates||[],imported=row.roster?.imported_template,previous=row.roster?.previous_schedule,period=row.roster?.start_pattern_period;
    const options=[];
    if(imported?.assignments?.length)options.push(["imported","Latest When I Work week",date(imported.start)+"–"+date(imported.end)+" · "+imported.assignments.length+" shifts as they were scheduled"]);
    for(const t of saved)options.push(["template:"+t.id,"Saved template: "+t.name,(t.assignments||[]).length+" shifts · saved "+date(String(t.updated_at||"").slice(0,10))]);
    if(previous?.assignments?.length)options.push(["previous","Last FranWallet plan","Week of "+date(previous.week_start)+" · "+previous.assignments.length+" shifts"]);
    options.push(["blank","Blank week","Place each shift yourself"]);
    const choice=options.some(o=>o[0]===row.start_choice)?row.start_choice:options[0][0];
    const fieldset='<fieldset class="la-start-from"'+(isConfirmed?' disabled':'')+'><legend>Start this week’s schedule from</legend>'+options.map(([value,label,detail],i)=>'<label><input type="radio" name="la-start-from" value="'+E(value)+'" data-la-start-choice '+(value===choice?'checked':'')+'><span><b>'+E(label)+(i===0&&value!=="blank"?' <em>Recommended</em>':'')+'</b><small>'+E(detail)+'</small></span></label>').join("")+'<div class="la-start-actions"><button type="button" class="btn '+(items.length?'btn-ghost':'btn-primary')+'" data-la-load-start>'+(items.length?'Replace shifts with this start':'Load this start')+'</button><small>'+(items.length?'Replaces the '+items.length+' shifts on the draft. ':'')+'Loaded shifts are trimmed to the '+number(budget)+' h budget where coverage allows.</small></div></fieldset>';
    const starts=items.length?'<details class="la-start-wrap" data-la-keep="la-start-wrap"><summary>Start from a different week</summary>'+fieldset+'</details>':fieldset;
    const source=items.length?'<p class="la-schedule-source"><b>Showing</b> '+E(row.schedule_source_label||(row.run?.assignments?.length?'your saved FranWallet draft ('+row.run.assignments.length+' shifts)':'shifts placed in this session'))+'</p>':'';
    // Store hours window (6a–11p unless a shift runs outside it) so every hour is wide enough to read and tap.
    const dayStarts=items.map(item=>timeMinutes(item.start)),dayEnds=items.map(item=>timeMinutes(item.end)),H0=Math.max(0,Math.min(6,...dayStarts.map(m=>Math.floor(m/60)))),H1=Math.min(24,Math.max(23,...dayEnds.map(m=>Math.ceil(m/60)))),span=H1-H0,hourName=h=>(h%12||12)+(h<12||h===24?'a':'p');
    const hourLabels=Array.from({length:span},(_,i)=>'<span>'+hourName(H0+i)+'</span>').join("");
    const dropHours=Array.from({length:span},(_,i)=>H0+i).map((hour)=>'<button type="button" data-la-hour="'+hour+'" aria-label="Add a shift starting '+timeLabel(clock(hour*60))+'" title="Add a shift at '+timeLabel(clock(hour*60))+'" '+(isConfirmed||!day.open?'disabled':'')+'></button>').join("");
    // Coverage: people on shift each hour; a gap between the first open and last close is flagged.
    const first=dayItems.length?Math.min(...dayItems.map(item=>timeMinutes(item.start))):null,last=dayItems.length?Math.max(...dayItems.map(item=>timeMinutes(item.end))):null;
    const coverage=dayItems.length?'<div class="la-coverage" style="--la-hours:'+span+'" role="img" aria-label="'+E("People on shift by hour, "+day.day)+'">'+Array.from({length:span},(_,i)=>{const m=(H0+i)*60+30,n=dayItems.filter(item=>timeMinutes(item.start)<=m&&timeMinutes(item.end)>m).length,inside=m>first&&m<last;return '<span class="c'+Math.min(3,n)+(n===0&&inside?' gap':'')+'" title="'+hourName(H0+i)+': '+n+' on shift">'+(n||(inside?'!':''))+'</span>';}).join("")+'</div>':'';
    const gapHours=dayItems.length?Array.from({length:span},(_,i)=>(H0+i)*60+30).filter(m=>m>first&&m<last&&!dayItems.some(item=>timeMinutes(item.start)<=m&&timeMinutes(item.end)>m)).length:0;
    const rows=dayItems.map(item=>{const person=roster.find(entry=>entry.name===item.employee),left=((timeMinutes(item.start)-H0*60)/(span*60))*100,width=((timeMinutes(item.end)-timeMinutes(item.start))/(span*60))*100,when=timeLabel(item.start)+'–'+timeLabel(item.end),editing=shiftForm?.mode==='edit'&&shiftForm.id===item.id;return '<article class="la-timeline-row'+(freshIds.has(item.id)?' fresh':'')+(editing?' editing':'')+(isSalaried(item.employee)?' salaried':'')+'" style="--la-delay:'+(freshIds.has(item.id)?Math.min(8,[...freshIds].indexOf(item.id))*70:0)+'ms" data-la-assignment="'+E(item.id)+'"><div class="la-shift-person"><span class="la-avatar sm" aria-hidden="true">'+initials(item.employee)+'</span><span><strong>'+E(item.employee)+'</strong><small>'+(isSalaried(item.employee)?'Salaried':E(item.position||person?.role||"Team member"))+'</small></span></div><div class="la-shift-track"><button type="button" tabindex="-1" class="la-shift-block" data-la-shift-block style="left:'+left+'%;width:'+Math.max(2,width)+'%" '+(isConfirmed?'disabled':'')+'><span>'+when+'</span></button></div><div class="la-shift-actions"><span class="la-shift-hours">'+number(assignmentHours(item))+' h'+(Number(item.break_hours)?' · '+number(item.break_hours)+' h break':'')+'</span>'+(isConfirmed?'':'<button type="button" class="la-shift-btn" data-la-edit-shift aria-label="Edit '+E(item.employee)+' '+when+'" aria-keyshortcuts="Delete">Edit</button><button type="button" class="la-shift-btn danger" data-la-remove-assignment aria-label="Remove '+E(item.employee)+' '+when+'">Remove</button>')+'</div></article>';}).join("");
    const sf=shiftForm&&shiftForm.day===activeDay?shiftForm:null,sfPerson=sf?roster.find(p=>p.name===sf.employee):null;
    const shiftFormHtml=sf?'<form class="la-shift-form" data-la-shift-form aria-labelledby="la-shift-form-title"><h4 id="la-shift-form-title">'+(sf.mode==='edit'?'Edit shift':'Add a shift')+' · '+E(day.day)+'</h4><label>Employee<select name="employee" data-la-sf-employee required>'+(roster.length?'':'<option value="">No roster imported</option>')+roster.map(p=>'<option value="'+E(p.name)+'" '+(p.name===sf.employee?'selected':'')+'>'+E(p.name)+(p.role?' · '+E(p.role):'')+'</option>').join('')+'</select></label><label>Start<select name="start" data-la-sf-start>'+timeOptions(sf.start)+'</select></label><label>End<select name="end" data-la-sf-end>'+timeOptions(sf.end,true)+'</select></label><label>Break<select name="break_hours" data-la-sf-break>'+[0,.25,.5,.75,1].map(v=>'<option value="'+v+'" '+(Number(sf.break_hours||0)===v?'selected':'')+'>'+number(v)+' h</option>').join('')+'</select></label><label>Position<input name="position" data-la-sf-position value="'+E(sf.position||'')+'" maxlength="80"></label><div class="la-shift-form-actions"><button type="submit" class="btn btn-primary" data-la-sf-save>'+(sf.mode==='edit'?'Save changes':'Add shift')+'</button>'+(sf.mode==='edit'?'<button type="button" class="btn btn-ghost danger" data-la-sf-remove>Remove shift</button>':'')+'<button type="button" class="btn btn-ghost" data-la-sf-cancel>Cancel</button></div><small>'+(sf.mode==='add'&&sfPerson?.common_start?'Times default to '+E(sfPerson.name)+'’s most common shift in the imported When I Work export.':'Times are in 30-minute steps; end must be after start.')+' '+number(Math.max(0,(timeMinutes(sf.end)-timeMinutes(sf.start))/60-Number(sf.break_hours||0)))+' paid hours.</small></form>':'';
    const checks=Core.reviewSchedule(row.config,decision,items,roster),notes=checks.issues.map(n=>['issue',n]).concat(checks.warnings.map(n=>[/manager confirms/i.test(n)?'info':'warn',n]));
    const review='<section class="la-schedule-checks" aria-labelledby="la-checks-heading"><h4 id="la-checks-heading">Before you save <span>'+(checks.ready?'hours and overlaps pass':checks.issues.length+' to review')+'</span></h4><ul>'+(checks.ready&&!checks.issues.length?'<li class="ok">Hours and overlaps pass.</li>':'')+notes.map(([kind,note])=>'<li class="'+kind+'">'+E(note)+'</li>').join('')+'</ul></section>';
    const open=row.schedule_open??(items.length>0),pct=v=>Math.max(0,Math.min(100,v));
    const railInfo=info("the team list","Team from the latest Gusto payroll and the When I Work export. Start times shown are each person’s most common shift start in the imported When I Work export"+(period?" "+date(period.start)+"–"+date(period.end):"")+", not their availability. "+(row.roster?.template_source||"")+(row.roster?.source?" · "+row.roster.source:""));
    return '<details class="la-schedule-builder" id="la-schedule" data-la-schedule-panel '+(open?'open':'')+'><summary><span class="la-step-number">3</span><span><b>Schedule</b> <small>Optional · '+(items.length?number(weeklyAssigned)+' of '+number(budget)+' h placed':row.roster&&!row.roster_loading&&!roster.length?'no When I Work roster imported yet':'not started')+'</small></span></summary>'+
      '<header class="la-sb-head"><div><p>Shape the week day by day. The manager confirms availability and publishes in When I Work; FranWallet never changes When I Work.</p>'+source+'</div><div class="la-weekly-progress" aria-live="polite"><strong>'+number(weeklyAssigned)+' / '+number(budget)+' h</strong><span class="la-wp-bar" aria-hidden="true"><i class="'+(weeklyRemaining<-0.5?'over':'')+'" style="width:'+pct(budget?weeklyAssigned/budget*100:0)+'%"></i></span><span>'+(weeklyRemaining>=0?number(weeklyRemaining)+' h left':number(Math.abs(weeklyRemaining))+' h over')+' · '+daysOnTarget+' of '+openDays+' open days on target'+E(liveLine)+(items.length&&live.total_cost!=null?info("schedule labor","("+number(weeklyAssigned)+" h placed − "+number(live.salaried_hours)+" salaried h) × "+money2(live.crew_rate)+" crew cost per hour + "+money(live.fixed_leadership)+" salaried cost = "+money(live.total_cost)+"; ÷ "+money(live.sales)+" projected sales = "+percent(live.labor_percent)+". Tips excluded. Updates as you add, edit or remove shifts."):'')+'</span>'+(salariedNames.size?'<small>Includes '+number(salariedPlaced)+' h for salaried staff ('+E([...(row.config.labor_model.salaried_names)].join(', '))+'). Their pay is the weekly salaried cost, not the crew rate; their hours still count toward the budget.</small>':'')+'</div></header>'+overBanner+starts+
      '<nav class="la-day-tabs" aria-label="Schedule days">'+decision.envelope.map((entry,index)=>{const total=items.filter(item=>item.day===index).reduce((sum,item)=>sum+assignmentHours(item),0),done=entry.open&&Math.abs(total-Number(entry.hours||0))<=.5,over=entry.open&&total-Number(entry.hours||0)>.5;return '<button type="button" data-la-day="'+index+'" class="'+(activeDay===index?'active ':'')+(done?'complete'+(completedBefore.has(index)?'':' just-complete'):over?'over':'')+'" '+(!entry.open?'disabled':'')+'><span>'+E(entry.day.slice(0,3))+'</span><small>'+(entry.open?number(total)+' / '+number(entry.hours)+' h':'Closed')+'</small>'+(entry.open?'<i class="la-tab-bar" aria-hidden="true"><b style="width:'+pct(entry.hours?total/entry.hours*100:0)+'%"></b></i>':'')+'</button>';}).join("")+'</nav>'+
      '<div class="la-day-summary" aria-live="polite" data-la-day-summary><div><span>'+E(day.day)+' target</span><strong>'+number(day.hours)+' hours</strong></div><div><span>Assigned</span><strong>'+number(assigned)+' hours</strong></div><div class="'+(remaining<0?'over':'')+'"><span>'+(remaining<0?'Over target':'Remaining')+'</span><strong>'+number(Math.abs(remaining))+' hours</strong></div>'+(gapHours?'<div class="gap"><span>Coverage gap</span><strong>'+gapHours+' h with nobody on</strong></div>':'')+'<div class="la-day-progress"><i style="width:'+Math.min(100,day.hours?(assigned/day.hours)*100:0)+'%" class="'+(remaining<0?'over':'')+'"></i></div></div>'+
      (()=>{if(isConfirmed||!day.open||!items.length)return "";const gap=gapSuggestion(roster,day.day,dayItems,remaining);
        if(gap)return '<div class="la-gap"><span class="la-gap-mark" aria-hidden="true"></span><div><b>'+number(remaining)+' hours open on '+E(day.day)+'</b><span>'+E(gap.person.name)+' is a possible match. '+E(gap.reason)+' Confirm availability in When I Work.</span></div><button type="button" class="btn btn-primary" data-la-fill="'+E(gap.person.name)+'" data-la-fill-start="'+gap.start+'" data-la-fill-end="'+gap.end+'">Add '+E(gap.person.name.split(" ")[0])+' '+timeLabel(gap.start)+'–'+timeLabel(gap.end)+'</button></div>';
        if(remaining<-0.5)return '<div class="la-gap over"><span class="la-gap-mark" aria-hidden="true"></span><div><b>'+number(Math.abs(remaining))+' hours over the '+E(day.day)+' target</b><span>Shorten or remove a shift, or keep it and flag it for the manager.</span></div></div>';
        return "";})()+
      '<div class="la-workspace"><aside class="la-people-rail"><header><strong>Team · '+roster.length+railInfo+'</strong><span>Tap + next to a name, or drag a name onto the timeline.</span></header><input type="search" data-la-roster-search value="'+E(rosterSearch)+'" placeholder="Search people or tags" aria-label="Search people or tags">'+(row.roster_loading?'<p class="la-rail-note">Loading roster…</p>':people||(roster.length?'<p class="la-rail-note">No matching employees.</p>':'<p class="la-rail-note"><strong>No roster imported yet.</strong> When I Work has not supplied this store’s team. The hour budget and manager brief still work; the manager assigns people in When I Work.</p>'))+(roster.length?'<p class="la-rail-foot">“Usually” is each person’s most common shift start in the imported When I Work export, not their availability.</p>':'')+'</aside><main class="la-timeline"><div class="la-timeline-toolbar"><div><strong>'+E(day.day)+'</strong><span class="la-canvas-hint">Click + Add shift, or drag a name onto the timeline. Click an empty hour to add a shift there.</span></div><div><button type="button" class="btn btn-ghost" data-la-copy-day '+(!dayItems.length||isConfirmed?'disabled':'')+'>Copy day forward</button><button type="button" class="btn btn-ghost" data-la-clear-day '+(!dayItems.length||isConfirmed?'disabled':'')+'>Clear day</button></div></div>'+shiftFormHtml+'<div class="la-hour-axis" style="--la-hours:'+span+'">'+hourLabels+'</div>'+(coverage?'<div class="la-coverage-row"><span class="la-coverage-label">On shift</span>'+coverage+'</div>':'')+'<div class="la-coverage-row"><span class="la-coverage-label">Tap to add</span><div class="la-hour-drop" style="--la-hours:'+span+'" aria-label="Hourly drop zones">'+dropHours+'</div></div><div class="la-timeline-rows" style="--la-hours:'+span+'">'+(rows||'<div class="la-empty-canvas"><strong>No shifts yet — add one, or start from last week’s schedule.</strong>'+(isConfirmed||!day.open?'':'<div class="la-empty-actions">'+(roster.length?'<button type="button" class="btn btn-primary" data-la-add-shift="'+E(selectedEmployee||roster[0].name)+'">+ Add a shift</button>':'')+(options.some(o=>o[0]==="imported")?'<button type="button" class="btn btn-ghost" data-la-empty-start>Start from last week’s schedule</button>':'')+'</div>')+'</div>')+'</div></main></div>'+
      '<footer class="la-sb-foot"><div class="la-day-navigation"><button type="button" class="btn btn-ghost" data-la-previous-day '+(activeDay===0?'disabled':'')+'>← Previous day</button>'+(activeDay<decision.envelope.length-1&&decision.envelope[activeDay+1]?.open?'<button type="button" class="btn btn-primary" data-la-next-day>Next: '+E(decision.envelope[activeDay+1].day)+' →</button>':'<button type="button" class="btn btn-primary" data-la-goto="la-step-save">Week done: approve and hand off ↓</button>')+'</div><div class="la-schedule-actions"><button type="button" class="btn btn-ghost" data-la-fit-budget '+(!items.length||isConfirmed?'disabled':'')+'>Trim to '+number(budget)+' h</button></div></footer>'+
      review+(items.length?'<div class="la-more-actions"><h4>Week actions</h4><div class="la-schedule-actions"><label class="la-template-name"><span>Template name</span><input data-la-template-name value="'+E(templateName)+'" maxlength="80"></label><button type="button" class="btn btn-ghost" data-la-save-template '+(!row.pro||isConfirmed?'disabled':'')+'>Save as template</button><span class="la-actions-sep" aria-hidden="true"></span><button type="button" class="la-link-btn" data-la-restore-pattern>Restore original pattern</button><button type="button" class="la-link-btn" data-la-copy-schedule>Copy weekly schedule</button><button type="button" class="la-link-btn" data-la-download-schedule>Download draft CSV</button></div></div>':'')+'</details>';
  }

  // What a finished week looks like, counted live from this week's plans.
  function doneChecklist(p){
    const rows=locations.map(r=>({r,plan:r.run?.plan||r.preview})),total=rows.length||1,
      under=rows.filter(({r,plan})=>{const d=Core.budgetDerivation(r.config,plan),g=d.goal_percent??r.config.target_labor_percent;return d.labor_percent!=null&&(d.labor_percent<=g+0.05||Number(plan.decision.hours)<=Number(r.config.minimum_hours??110)+0.01);}).length,
      fits=rows.filter(({r,plan})=>{const a=(r.run?.assignments||[]).reduce((x,i)=>x+Number(i.hours||assignmentHours(i)||0),0);return a>0&&a<=Number(plan.decision.hours)+0.5;}).length,
      published=rows.filter(({r})=>Number(r.schedule?.days?.reduce?.((a,b)=>a+Number(b||0),0)||0)>0).length;
    const item=(done,n,label,help)=>'<li class="'+(n>=total?'done':n>0?'part':'')+'"><span class="la-check-dot" aria-hidden="true">'+(n>=total?'✓':'')+'</span><div><b>'+label+'</b><small>'+help+'</small></div><em>'+n+' of '+total+'</em></li>';
    return '<section class="la-done-list" aria-labelledby="la-done-heading"><h2 id="la-done-heading">A finished week looks like this</h2><ol>'+
      item(0,p.confirmed,'Budgets approved','Every store has an approved hour budget.')+
      item(0,under,'Labor at or under goal','Estimated labor within the 25% goal, or at the 110 h floor.')+
      item(0,fits,'Schedule drafts within budget','Optional, but it makes the manager’s job faster.')+
      item(0,published,'Shifts published in When I Work','Managers publish after reading their brief. Shows after the Sunday import.')+
      '</ol></section>';
  }
  // Pinned plan summary: the answer and the save action stay in view while the operator works down the page.
  function planBar(row,decision,d=Core.budgetDerivation(row.config,decision)){
    const isConfirmed=row.run?.status==="confirmed",goal=d.goal_percent??row.config.target_labor_percent,pct=d.labor_percent,hours=Number(decision.decision.hours),floor=Number(row.config.minimum_hours??110),
      placed=assignments(row).reduce((x,i)=>x+assignmentHours(i),0),
      tone=pct==null?'':pct<=goal+0.05?'ok':hours<=floor+0.01?'floor':'warn',
      chip=pct==null?'Labor % needs a crew cost':tone==='ok'?'Within '+percent(goal)+' goal':tone==='floor'?'At the '+number(floor)+' h floor':number(Math.round((pct-goal)*10)/10)+' pts above '+percent(goal)+' goal';
    return '<aside class="la-planbar" data-la-planbar aria-label="Plan summary"><div class="la-pb-store"><b>'+E(row.wallet.name.replace(/^Crumbl\s*[—-]\s*/,''))+'</b><small>'+E(date(week)+' – '+date(add(week,6)))+'</small></div><dl><div><dt>Projected sales</dt><dd>'+money(d.sales)+'</dd></div><div><dt>Hour budget</dt><dd>'+number(hours)+' h</dd></div><div><dt>Labor at budget</dt><dd>'+money(d.total_cost)+(pct!=null?' · '+percent(pct):'')+'</dd></div>'+(placed?'<div><dt>Scheduled</dt><dd>'+number(placed)+' / '+number(hours)+' h</dd></div>':'')+'</dl><span class="la-pb-chip '+tone+'">'+E(chip)+'</span>'+(isConfirmed?'<span class="la-pb-chip ok">Approved</span>':'<button type="button" class="btn btn-primary" data-la-planbar-save>Save</button>')+'</aside>';
  }
  function portfolioBrief() {
    return (
      "FranWallet labor targets · " +
      date(week) +
      "–" +
      date(add(week, 6)) +
      "\n\n" +
      locations.map((row) => managerBrief(row)).join("\n\n")
    );
  }
  function planningProgress() {
    const total = locations.length,
      closed = locations.filter(currentSales).length,
      reviewed = locations.filter((r) => r.run && r.run.forecast_reviewed!==false).length,
      confirmed = locations.filter((r) => r.run?.status === "confirmed").length,
      scheduled = locations.filter(
        (r) => r.preview.schedule.scheduled_hours != null,
      ).length,
      next =
        locations.find(
          (r) => r.run?.status !== "confirmed" && currentSales(r),
        ) ||
        locations.find((r) => r.run?.status !== "confirmed") ||
        null;
    return { total, closed, reviewed, confirmed, scheduled, next };
  }
  function progressRail(p) {
    const stages = [
      ["1", "Sales closed", p.closed],
      ["2", "Outlooks reviewed", p.reviewed],
      ["3", "Budgets confirmed", p.confirmed],
      ["4", "Schedules imported", p.scheduled],
    ];
    return (
      '<ol class="la-progress-rail">' +
      stages
        .map(
          ([number, label, value]) =>
            '<li class="' +
            (value === p.total && p.total ? "done" : value ? "active" : "") +
            '"><span>' +
            number +
            "</span><div><b>" +
            label +
            "</b><small>" +
            value +
            " of " +
            p.total +
            "</small></div></li>",
        )
        .join("") +
      "</ol>"
    );
  }
  async function copyText(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      message =
        label + " copied. Paste it into your manager workflow when ready.";
    } catch (_) {
      message = errorMessage =
        "Copy was blocked by the browser. Select the plan details and copy them manually.";
    }
    render();
  }
  function periodControls(){return '<nav class="la-period-controls" aria-label="Labor budget period"><button class="btn '+(period==='week'?'btn-primary':'btn-ghost')+'" data-la-period="week" aria-pressed="'+(period==='week')+'">Weekly budget</button><button class="btn '+(period==='month'?'btn-primary':'btn-ghost')+'" data-la-period="month" aria-pressed="'+(period==='month')+'">Monthly budget</button>'+(period==='month'?'<label>Calendar month <input type="month" data-la-month value="'+E(month)+'"></label>':'')+'</nav>';}
  function operatingWorkflow(){return '<details class="la-operating-workflow"><summary>How the team runs labor from FranWallet</summary><ol><li><b>First Monday of the month.</b> Review the prior month’s budget versus actual sales and labor by store and portfolio. Set the month’s weekly outlook changes; refine each upcoming week without rewriting approved history.</li><li><b>Close and reconcile.</b> Bring in Crumbl net sales, When I Work timesheets and payroll costs. Match the store and dates; missing or old data stays flagged. Close timesheets Sunday by 5 PM; confirm the operating timezone with leadership before enabling reminders.</li><li><b>Review each outlook.</b> Leadership sets the next-week sales change and verifies wages, manager hours and salary allocations. Keep framework hours and affordable dollars visible together.</li><li><b>Approve one version.</b> Save a draft, resolve exceptions, then approve the exact weekly budget. The monthly view rolls up the dated weeks without moving an approved baseline.</li><li><b>Build by Tuesday/Wednesday.</b> Start from the imported schedule or a saved template here. An agent can collect availability, time off and coverage requirements from When I Work; the manager checks shifts and exceptions.</li><li><b>Finalize Sunday.</b> Review the schedule, publish in When I Work, and bring it back for budget comparison. Copy one recap to the chosen team channel; FranWallet retains the decision.</li><li><b>Track and learn.</b> Compare actual crew hours and payroll to the locked budget; explain sales, wage, coverage and salary-allocation differences before next week’s outlook.</li></ol><p>Tools: FranWallet is the planning record; Crumbl supplies sales, When I Work supplies people, availability and live schedules, and Gusto supplies payroll. Use one existing leadership channel for the recap, initially with the three-person leadership pilot from the walkthrough. Plain-text store bullets work in Pronto. Daily reports should lead with yesterday’s actuals versus budget and flag missing data instead of posting a guessed result. Current labor approval access is owner-only; manager review and publishing remain in When I Work.</p></details>';}
  function monthBrief(){if(!monthData)return '';return 'FranWallet calendar labor budget · '+month+'\nDraft / provisional until each week is approved\n'+monthData.stores.map(row=>row.wallet.name+': '+number(row.hours)+' h · '+(row.cost===null?'cost missing':money(row.cost)+' estimated employer cost')).join('\n')+'\nTotal: '+number(monthData.hours)+' h · '+money(monthData.known_cost)+' known cost ('+monthData.known_cost_stores+'/'+monthData.total_stores+' stores)';}
  function renderMonth(){
    if(!monthData)return '<section class="la-hero"><h1>Calendar labor budget</h1><p>Loading the dated weekly budgets…</p></section>';
    const d=monthData,confirmed=d.stores.reduce((sum,r)=>sum+r.confirmed_weeks,0),weekCount=d.weeks.length*d.total_stores;
    return '<section class="la-hero"><div><span class="la-kicker">Portfolio · calendar month</span><h1>'+E(new Date(month+'-01T12:00:00Z').toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'}))+' labor budget</h1><p>Every date belongs to its planning week. Weekly decisions remain the source of truth.</p></div></section><div class="la-metrics"><div><span>Calendar labor hours</span><strong>'+number(d.hours)+' h</strong><small>'+d.total_stores+' stores · '+d.weeks.length+' overlapping weeks</small></div><div><span>Known estimated employer cost</span><strong>'+money(d.known_cost)+'</strong><small>'+d.known_cost_stores+' of '+d.total_stores+' stores · provisional</small></div><div><span>Approved store-weeks</span><strong>'+confirmed+' / '+weekCount+'</strong><small>Drafts and recommendations are not approvals</small></div><div><span>Sales scenario</span><strong>'+money(d.sales)+'</strong><small>Even open-day allocation · refresh weekly outlooks</small></div></div><section class="la-worklist"><header><div><h2>Store budgets for '+E(month)+'</h2><p>Hours preserve daily targets. Fixed weekly costs and sales are allocated evenly over open days; dollar estimates require confirmed rates and leadership allocation.</p></div><button class="btn btn-ghost" data-la-copy-month>Copy monthly budget</button></header><div class="la-table"><table><thead><tr><th>Location</th><th>Calendar hours</th><th>Estimated employer cost</th><th>Approved weeks</th><th>Review dated budgets</th></tr></thead><tbody>'+d.stores.map(row=>'<tr><th>'+E(row.wallet.name)+'</th><td><strong>'+number(row.hours)+' h</strong><small>'+row.days+' open days</small></td><td><strong>'+(row.cost===null?'Missing cost':money(row.cost))+'</strong><small>'+(row.cost===null?'Needs payroll inputs':'Provisional · configured employer cost')+'</small></td><td>'+row.confirmed_weeks+' / '+d.weeks.length+'</td><td>'+row.weeks.map(w=>'<button class="la-link" data-la-month-week="'+w.start+'" data-la-month-wallet="'+E(row.wallet.id)+'">'+date(w.start)+' · '+number(w.hours)+' h · '+E(w.status)+'</button>').join('<br>')+'</td></tr>').join('')+'</tbody></table></div></section><details class="la-operating-workflow"><summary>Dates and sources used in this month</summary><p>Includes only '+E(month)+' dates; excludes days in adjacent months. Closed days retain zero target hours. An unknown cost stays missing. Each weekly draft preserves its config revision and source dates. Monthly sales are a planning allocation, not measured daily sales.</p><ul>'+d.weeks.map(start=>'<li>Week of '+date(start)+' · <button class="la-link" data-la-month-week="'+start+'">Review weekly portfolio</button></li>').join('')+'</ul></details>'+operatingWorkflow();
  }
  function renderPortfolio() {
    const sales = locations.reduce(
        (n, r) => n + Number(r.preview.forecast.sales || 0),
        0,
      ),
      hours = locations.reduce(
        (n, r) => n + Number(r.preview.decision.hours || 0),
        0,
      ),
      p = planningProgress(),
      costRows = locations.filter(
        (r) => Core.budgetCost(r.config,r.preview.decision.hours) != null,
      ),
      laborCost = costRows.reduce(
        (n, r) => n + Core.budgetCost(r.config,r.preview.decision.hours),
        0,
      ),
      comparableSales = costRows.reduce(
        (n, r) => n + Number(r.preview.forecast.sales || 0),
        0,
      ),
      laborPercent = comparableSales
        ? (laborCost / comparableSales) * 100
        : null,
      complete = p.total > 0 && p.confirmed === p.total,
      nextName = p.next?.wallet.name || "";
    const action = complete
      ? '<div><h2>Budgets confirmed. Finish the handoff.</h2><p>Every store is ready for manager review. Copy the approved briefs into your manager workflow; publishing stays a separate approval in When I Work.</p></div><div class="la-next-buttons"><button class="btn btn-primary" data-la-summary-open>See portfolio summary</button><button class="btn btn-ghost" data-la-copy-all>Copy approved briefs</button><a class="btn btn-ghost" href="https://app.wheniwork.com/" target="_blank" rel="noopener noreferrer">Open When I Work ↗</a></div>'
      : "<div><h2>" +
        (p.confirmed
          ? "Keep going. " + (p.total - p.confirmed) + (p.total - p.confirmed === 1 ? " plan left." : " plans left.")
          : !p.total
            ? busy
              ? "Preparing your Sunday plans…"
              : "No store plans for this week."
            : p.closed === p.total
            ? "Your Sunday plans are ready."
            : "Start the weekly planning run.") +
        "</h2><p>" +
        (!p.total
          ? "FranWallet is gathering closed sales, store frameworks and imported schedules."
          : p.closed === p.total
          ? "Closed sales are in. Confirm the outlook and hour budget for each store."
          : "Review the ready stores now; missing closed sales stay clearly marked.") +
        "</p></div>" +
        (p.next
          ? '<button class="btn btn-primary" data-la-wallet="' +
            E(p.next.wallet.id) +
            '">' +
            (p.confirmed ? "Continue with " : "Start with ") +
            E(nextName) +
            " →</button>"
          : "");
    const completion = Math.round((p.confirmed / Math.max(1, p.total)) * 100);
    return (
      '<section class="la-hero"><div><span class="la-kicker">Weekly labor plan</span><h1>Finish next week’s labor plan while the numbers are fresh.</h1><p>Sales, schedules and payroll are already loaded. For each store you make one call about next week’s sales, confirm the hours, and hand the manager a brief. About 10 minutes for the first store, 5 after that.</p><button type="button" class="la-watch" data-la-guide-intro><span aria-hidden="true">▶</span>Watch how it works <small>40 sec</small></button></div><div class="la-week"><button data-la-week="-7" aria-label="Previous week">←</button><span><b>' +
      date(week) +
      " – " +
      date(add(week, 6)) +
      '</b><small>Planning week</small></span><button data-la-week="7" aria-label="Next week">→</button></div></section><section class="la-sunday-run">' +
      progressRail(p) +
      '<div class="la-next-action">' +
      action +
      '</div><div class="la-progress-copy"><span><b>' +
      p.confirmed +
      " of " +
      p.total +
      "</b> labor budgets confirmed</span><span>" +
      completion +
      '%</span></div><div class="la-progress-bar"><i style="width:' +
      completion +
      '%"></i></div></section>' + doneChecklist(p) + '<div class="la-metrics"><div><span>Total sales projection</span><strong>' +
      money(sales) +
      "</strong><small>" +
      p.closed +
      " of " +
      p.total +
      " stores pulled from the requested closed prior week</small></div><div><span>Labor hours</span><strong>" +
      number(hours) +
      " h</strong><small>" +
      p.confirmed +
      " confirmed · " +
      p.scheduled +
      (p.scheduled === 1 ? " schedule imported" : " schedules imported") +
      "</small></div><div><span>Estimated weekly labor</span><strong>" +
      money(laborCost) +
      "</strong><small>" +
      costRows.length +
      " of " +
      p.total +
      " stores · fully loaded: crew employer cost + salaried leadership</small></div><div><span>Labor % of projected sales</span><strong>" +
      percent(laborPercent) +
      '</strong><small>Comparable stores · provisional until wage inputs are approved</small></div></div><section class="la-worklist"><header><div><h2>Plan store by store</h2><p>Each target follows that store’s operating framework. Sales outlook changes context; it never silently adds hours.</p></div><div class="la-worklist-actions"><button class="btn btn-ghost" data-la-summary-open>Portfolio summary</button><button class="btn btn-ghost" data-la-copy-all>Copy all targets</button></div></header><div class="la-table"><table><thead><tr><th>Location</th><th>Prior week → projection</th><th>Labor budget</th><th>Current schedule</th><th>Status</th><th></th></tr></thead><tbody>' +
      locations
        .map((row) => {
          const [label, tone] = status(row),
            plan = row.preview,
            schedule = plan.schedule,
            prior = priorValue(row, plan),
            f = displayedFinancials(plan);
          return (
            "<tr><th>" +
            E(row.wallet.name) +
            "<small>" +
            source(row) +
            "</small></th><td><strong>" +
            (prior == null
              ? "Missing"
              : row.run
                ? money(prior) + " → " + money(plan.forecast.sales)
                : money(prior) + (currentSales(row) ? " closed" : " reference")) +
            "</strong><small>" +
            (prior == null
              ? "Baseline for context only · sales missing"
              : row.run
                ? E(outlook(plan.forecast))
                : "Outlook not chosen yet" +
                  (row.sales_suggestion?.available
                    ? " · Fran suggests " +
                      E(
                        row.sales_suggestion.direction === "same"
                          ? "flat"
                          : row.sales_suggestion.direction +
                              " " +
                              row.sales_suggestion.percent +
                              "%",
                      )
                    : "")) +
            "</small></td><td><strong>" +
            number(plan.decision.hours) +
            " h" +
            (f?.estimated_labor_cost != null
              ? " · " + money(f.estimated_labor_cost)
              : "") +
            "</strong><small>" +
            (f?.estimated_labor_percent != null
              ? percent(f.estimated_labor_percent) + " of sales"
              : "") +
            (f?.estimated_labor_percent != null ? "" : "labor % needs a crew cost") +
            (plan.model.review_required ? " · review needed" : "") +
            "</small></td><td><strong>" +
            scheduleCell(row, plan) +
            '</td><td><span class="la-status ' +
            tone +
            '">' +
            label +
            '</span></td><td><button class="la-link" data-la-wallet="' +
            E(row.wallet.id) +
            '">Review plan →</button></td></tr>'
          );
        })
        .join("") +
      (locations.length
        ? ""
        : '<tr><td colspan="6" class="la-empty-row">' +
          (busy
            ? "<strong>Preparing store plans…</strong><span>Reading closed sales, store frameworks and the latest imported schedules.</span>"
            : "<strong>No store plans for this week yet.</strong><span>Plans appear once a location has a labor framework. Try the next planning week or refresh.</span>") +
          "</td></tr>") +
      "</tbody></table></div></section>"
    );
  }
  // Where this store stands: outlook, budget, optional schedule, then save and move on.
  // The answer first: next week's plan for this store, what was done for the operator, and one approve action.
  function heroPlan(row, decision, isConfirmed, d = Core.budgetDerivation(row.config, decision)) {
    const items = assignments(row), placed = items.reduce((x, i) => x + assignmentHours(i), 0), hours = Number(decision.decision.hours), goal = d.goal_percent ?? row.config.target_labor_percent, within = d.labor_percent != null && d.labor_percent <= goal + 0.05, f = decision.forecast, planForm = page.querySelector("#la-plan-form"), base = (planForm?.dataset.wallet === row.wallet.id && Number(planForm.elements.last_week_sales?.value)) || f.base_sales || null, adj = base && d.sales ? Math.round((d.sales / base - 1) * 1000) / 10 : 0, cs = row.closed_week_sales;
    const kicker = isConfirmed ? "Approved" : row.autodrafted ? "Drafted for you" : row.run ? "Your saved draft" : "Recommended plan";
    const checks = [
      ["Sales", base != null ? money(base) + (cs && Math.abs(Number(cs.sales) - Number(base)) < 0.01 ? " last closed week" : " starting point") + " · " + (adj ? (adj > 0 ? "+" : "−") + number(Math.abs(adj)) + "%" : "flat") + " → " + money(d.sales) : "Enter last week’s total to start"],
      ["Hours", number(hours) + " h · " + (bindingLabel[d.binding] || "store framework") + " · floor " + number(d.floor_hours ?? row.config.minimum_hours) + " h"],
      ["Schedule", items.length ? number(placed) + " of " + number(hours) + " h · " + items.length + " shifts" + (row.autodrafted ? " from last week’s When I Work schedule" : "") : "Not started · optional"],
    ];
    return '<section class="la-hero-plan' + (row.autodrafted && !isConfirmed ? " drafted" : "") + '" data-la-hero aria-labelledby="la-hp-title"><div class="la-hp-copy"><span class="la-hp-kicker">' + (row.autodrafted && !isConfirmed ? '<i aria-hidden="true">✦</i>' : "") + E(kicker) + " · " + E(date(week) + " – " + date(add(week, 6))) + '</span><h2 id="la-hp-title">' + number(hours) + " hours" + '</h2><p class="la-hp-metrics"><span><b>' + money(d.total_cost) + "</b> labor</span><span><b>" + percent(d.labor_percent) + "</b> of " + money(d.sales) + " projected</span>" + (d.labor_percent != null && goal != null ? '<em class="la-goal-chip ' + (within ? "ok" : "warn") + '">' + (within ? "Within " + percent(goal) + " goal" : number(Math.round((d.labor_percent - goal) * 10) / 10) + " pts above goal") + "</em>" : "") + '</p><ul class="la-hp-checks">' + checks.map(([k, v]) => "<li><b>" + k + "</b><span>" + E(v) + "</span></li>").join("") + '</ul></div><div class="la-hp-actions">' + (isConfirmed ? '<span class="la-pb-chip ok">Approved</span><button type="button" class="btn btn-ghost" data-la-goto="la-step-save">Send to the manager</button>' : '<button type="button" class="btn btn-primary la-hp-approve" data-la-hero-approve>Approve plan</button><button type="button" class="la-link-btn" data-la-goto="la-step-outlook">Review the details</button>') + "</div></section>";
  }
  // Why trust it: this store's own recent weeks, the sources, and how last week went.
  function trustRail(row) {
    return '<aside class="la-store-rail" aria-label="Why you can trust this plan">' + trackCard(row) + provenance(row) + '<details data-la-keep="la-lastweek" class="la-lastweek"' + (row.prior_week_results?.projected || row.prior_week_results?.sales || row.prior_week_results?.hours ? " open" : "") + "><summary>" + E(lastWeekLine(row)) + "</summary>" + priorResults(row) + "</details></aside>";
  }
  // Track record: for each recent closed week, hours worked against what the labor target allowed for the sales that
  // actually came in. Uses this store's current rules and crew cost, so it shows what following the plan would have meant.
  function trackRows(row) {
    const c = row.config, floor = Number(c.minimum_hours ?? 110);
    return (row.history || []).filter((w) => Number(w.sales) > 0 && (w.worked_hours != null || w.scheduled_hours != null)).slice(-6).map((w) => {
      const hours = w.worked_hours ?? w.scheduled_hours, d = Core.budgetDerivation(c, { forecast: { sales: Number(w.sales), method: "operator_baseline" }, decision: { hours }, model: { inputs: {} } });
      const allowed = d.affordable_hours == null ? null : Math.max(floor, Math.floor(d.affordable_hours * 2) / 2);
      return { ...w, hours, basis: w.worked_hours != null ? "worked" : "scheduled", allowed, pct: d.labor_percent, rate: d.crew_rate, diff: allowed == null ? null : Math.round((hours - allowed) * 10) / 10 };
    });
  }
  function trackCard(row) {
    if (row.history_loading) return '<section class="la-track"><h3>Your last 6 weeks</h3><p class="la-track-lede">Loading this store’s recent weeks…</p></section>';
    const rows = trackRows(row);
    if (!rows.length) return '<section class="la-track"><h3>Your last 6 weeks</h3><p class="la-track-lede">No closed weeks with sales and hours yet. This fills in after the first Sunday import.</p></section>';
    const over = rows.reduce((x, r) => x + Math.max(0, r.diff || 0), 0), rate = rows.find((r) => r.rate)?.rate, dollars = rate ? over * rate : null, goal = row.config.target_labor_percent;
    const max = Math.max(...rows.map((r) => Math.max(r.hours || 0, r.allowed || 0))) * 1.08;
    const tip = "For each closed week: hours worked (When I Work timesheets, or the published schedule when timesheets are missing) against what your " + percent(goal) + " labor target allowed for the point-of-sale sales that week, never below the " + number(row.config.minimum_hours ?? 110) + " h floor. Uses today’s crew cost per hour from Gusto, tips excluded.";
    return '<section class="la-track" aria-labelledby="la-track-heading"><h3 id="la-track-heading">Your last ' + rows.length + " weeks" + info("the track record", tip) + "</h3>" +
      '<p class="la-track-lede">' + (over > 0.5 ? "Worked <b>" + number(Math.round(over)) + " h</b> more than the target allowed" + (dollars ? ", about <b>" + money(dollars) + "</b>" : "") + ". This plan is built to close that gap." : "Staffing stayed within what the target allowed. This plan keeps it there.") + "</p>" +
      '<ol class="la-track-rows">' + rows.slice().reverse().map((r) => '<li class="' + (r.diff > 0.5 ? "over" : "ok") + '"><span class="la-tr-week">' + E(date(r.week_start).replace(/, \d{4}$/, "")) + '</span><span class="la-tr-bar" role="img" aria-label="' + E(number(r.hours) + " h " + r.basis + ", " + number(r.allowed) + " h allowed") + '"><i style="width:' + Math.min(100, (r.hours / max) * 100) + '%"></i><b style="left:' + Math.min(100, (r.allowed / max) * 100) + '%"></b></span><span class="la-tr-val">' + number(r.hours) + " h" + (r.diff != null ? '<small>' + (r.diff > 0.5 ? "+" + number(r.diff) : r.diff < -0.5 ? "−" + number(Math.abs(r.diff)) : "on") + "</small>" : "") + "</span></li>").join("") + "</ol>" +
      '<p class="la-track-key"><span class="w">Hours worked</span><span class="a">Target allowed</span></p></section>';
  }
  // Forward motion between steps: one primary next action, optional skip.
  function nextStep(target, label, skip, skipLabel) {
    return '<div class="la-step-next"><button type="button" class="btn btn-primary" data-la-goto="' + target + '">' + E(label) + ' <span aria-hidden="true">↓</span></button>' + (skip ? '<button type="button" class="la-link-btn" data-la-goto="' + skip + '">' + E(skipLabel) + "</button>" : "") + "</div>";
  }
  function lastWeekLine(row) {
    const r = row.prior_week_results, start = r?.week_start || add(week, -7), p = r?.projected, sales = r?.sales?.amount, hrs = r?.hours?.amount;
    const bits = [p?.hours != null ? number(p.hours) + " h planned" : null, hrs != null ? number(hrs) + " h worked" : null, sales != null ? money(sales) + " sales" : null].filter(Boolean);
    return "How last week went · " + date(start) + "–" + date(add(start, 6)) + (bits.length ? " · " + bits.join(" · ") : " · nothing to compare yet");
  }
  function storeSteps(row, decision, isConfirmed) {
    const weekly = assignments(row).reduce((sum, item) => sum + assignmentHours(item), 0),
      hours = Number(decision.decision.hours || 0),
      chosen = !!((row.run && row.run.forecast_reviewed!==false) || row.outlook_touched),
      steps = [
        ["la-step-outlook", "Sales outlook", chosen ? (outlook(decision.forecast) === "about the same" ? "Flat" : outlook(decision.forecast).replace(/^./, (c) => c.toUpperCase())) : "One choice", chosen],
        ["la-step-budget", "Hour budget", row.run ? number(hours) + " h saved" : number(hours) + " h recommended", !!row.run],
        ["la-schedule", "Schedule", weekly ? number(weekly) + " / " + number(hours) + " h" : "Optional", weekly > 0 && Math.abs(weekly - hours) <= 0.5],
        ["la-step-save", "Hand off", isConfirmed ? "Approved" : row.run ? "Draft saved" : "Not saved", isConfirmed],
      ],
      current = steps.findIndex((step) => !step[3]);
    return '<ol class="la-store-steps" aria-label="' + E(row.wallet.name) + ' planning steps">' + steps.map(([target, label, state, done], index) =>
      '<li class="' + (done ? "done" : index === current ? "current" : "") + '"><a href="#' + target + '" data-la-jump="' + target + '"' + (index === current ? ' aria-current="step"' : "") + "><span>" + (done ? "✓" : index + 1) + "</span><div><b>" + label + "</b><small>" + E(state) + "</small></div></a></li>").join("") + "</ol>";
  }
  // One-sentence explanation at the decision point: what the outlook changes and what it does not.
  function impactText(row, decision, sales) {
    if (!(sales > 0)) return "Enter the starting sales to see the projection.";
    const hours = Number(decision.decision.hours);
    if (row.config.planning_mode === "revenue") {
      const r = Core.budgetDerivation(row.config, { ...decision, forecast: { ...decision.forecast, sales } }), at = Core.budgetDerivation(row.config, { ...decision, forecast: { ...decision.forecast, sales }, decision: { ...decision.decision, hours: r.recommended_hours } });
      return "→ " + number(r.recommended_hours) + " h recommended" + (at.labor_percent != null ? " · " + percent(at.labor_percent) + " labor" : "");
    }
    const d = Core.budgetDerivation(row.config, { ...decision, forecast: { ...decision.forecast, sales } });
    return "→ " + number(hours) + " h framework" + (d.labor_percent != null ? " · " + percent(d.labor_percent) + " labor" : "");
  }

  function approvalStep(row, decision, isConfirmed) {
    const next = nextAfter(row), a = approvalState(row), p = planningProgress(),
      nextLabel = next ? "Save, then open " + next.wallet.name + " →" : "Save and see portfolio summary",
      position = locations.findIndex((r) => r.wallet.id === row.wallet.id) + 1;
    if (!row.pro) return '<section class="la-upgrade la-final-step" id="la-step-save"><span>Location Pro</span><h2>Save and compare each weekly plan</h2><p>Your free wallet can build the budget. Pro retains decisions, plan-to-actual tracking and cited Fran AI explanations.</p><button class="btn btn-primary" data-la-upgrade>Review Location Pro</button></section>';
    if (isConfirmed) {
      const dd = Core.budgetDerivation(row.config, decision), hrs = Number(decision.decision.hours), placed = assignments(row).reduce((x, i) => x + assignmentHours(i), 0), worked = row.prior_week_results?.hours?.amount, fresh = justPlanned.has(row.wallet.id);
      justPlanned.delete(row.wallet.id);
      const stats = '<div class="la-done-stats"><div><small>Hour budget</small><b>' + number(hrs) + ' h</b><span>' + (worked != null ? "Last closed week: " + number(worked) + " h worked" : "Includes salaried hours") + '</span></div><div><small>Estimated labor</small><b>' + (dd.labor_percent != null ? percent(dd.labor_percent) : "—") + '</b><span>' + (dd.total_cost != null ? money(dd.total_cost) + " of " + money(dd.sales) + " projected · goal " + percent(dd.goal_percent ?? row.config.target_labor_percent) : "Needs a crew cost per hour") + '</span></div><div><small>Schedule draft</small><b>' + (placed ? number(placed) + " h" : "Not built") + '</b><span>' + (placed ? (placed <= hrs + 0.5 ? "Within the budget" : number(placed - hrs) + " h over the budget") : "The manager schedules in When I Work") + "</span></div></div>";
      return '<section class="la-final-step la-completion' + (fresh ? " la-fresh" : "") + '" id="la-step-save" aria-labelledby="la-save-heading"><span class="la-done-mark" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="23"/><path d="M15 27l7 7 15-16"/></svg></span><div><span>Budget approved</span><h2 id="la-save-heading">' + E(row.wallet.name) + ' is ready for manager review.</h2><p>' + p.confirmed + " of " + p.total + " budgets approved this week. Ready for manager review. Managers build and publish shifts in When I Work; FranWallet has not changed any live schedule.</p></div>" +
        '<div class="la-approval-actions">' + (next ? '<button class="btn btn-primary" data-la-next="' + E(next.wallet.id) + '">Go to ' + E(next.wallet.name) + " →</button>" : '<button class="btn btn-primary" data-la-summary-open>See portfolio summary</button>') +
        '<button class="btn btn-ghost" data-la-copy>Copy manager brief</button></div>' + stats + '<ol class="la-next-steps"><li><b>Send the brief.</b> Copy the manager brief and send it to the store manager.</li><li><b>Publish in When I Work.</b> The manager builds or adjusts shifts and publishes them there.</li><li><b>Check back next Sunday.</b> Plan versus actual fills in once the week closes.</li></ol>' + briefPreview(row) + "</section>";
    }
    const ack = needsAck(row), reason = reasonNeeded(row, decision), short = row.wallet.name.replace(/^Crumbl\s*[—-]\s*/, "");
    return '<section class="la-final-step la-handoff" id="la-step-save" aria-labelledby="la-save-heading"><span class="la-step-number">4</span><div><h2 id="la-save-heading" tabindex="-1">Approve and hand off</h2><p>Store ' + position + " of " + locations.length + ". Four quick steps, then on to the next store.</p></div>" +
      '<ol class="la-handoff-steps">' +
      '<li><span class="la-hs-n" aria-hidden="true">1</span><div><b>Approve the hours</b>' +
      (ack ? '<label class="la-check"><input type="checkbox" data-la-forecast-ack ' + (a.ack ? "checked" : "") + "><span>I reviewed this provisional sales forecast and its source dates" + (row.prior_week_sales?.source ? " (" + E(row.prior_week_sales.source) + ")" : "") + ".</span></label>" : "") +
      '<label class="la-check la-approve-check"><input type="checkbox" id="la-confirm-check" data-la-approve ' + (a.approve ? "checked" : "") + "><span>Approve " + number(decision.decision.hours) + " hours as this week’s budget.</span></label><small>Approving locks " + number(decision.decision.hours) + " hours for " + E(row.wallet.name) + ". Leave it unticked to save a draft and come back.</small>" +
      '<label class="la-reason" data-la-reason-wrap ' + (reason ? "" : "hidden") + '>Why approve above the ' + percent(decision.financials?.labor_goal_percent ?? row.config.target_labor_percent) + ' labor target? <textarea data-la-exception-reason maxlength="500" placeholder="Coverage floor, approved event, or corrected sales or cost input">' + E(a.reason) + "</textarea></label></div></li>" +
      '<li><span class="la-hs-n" aria-hidden="true">2</span><div><b>Save</b><div class="la-approval-actions"><button type="button" class="btn btn-primary" data-la-save-stay>Save ' + E(short) + '</button><small data-la-save-mode aria-live="polite">' + (a.approve ? "Saves as approved and stays here." : "Saves a draft and stays here; approve later.") + "</small></div></div></li>" +
      '<li><span class="la-hs-n" aria-hidden="true">3</span><div><b>Send it to the manager</b><small>Copy the brief and send it to ' + E(short) + '’s manager. They build and publish shifts in When I Work; FranWallet never changes When I Work.</small><div class="la-approval-actions"><button type="button" class="btn btn-ghost" data-la-copy>Copy manager brief</button></div>' + briefPreview(row) + "</div></li>" +
      '<li><span class="la-hs-n" aria-hidden="true">4</span><div><b>Move on</b><div class="la-approval-actions"><button type="button" class="btn btn-ghost" data-la-save-next>' + E(nextLabel) + "</button></div></div></li>" +
      "</ol></section>";
  }
  function briefPreview(row) {
    return '<details data-la-keep="la-brief-preview" class="la-brief-preview"><summary>What the manager receives</summary><pre>' + E(managerBrief(row)) + '</pre><p class="la-handoff-note">FranWallet does not publish to When I Work; publishing is a separate approval there. <a href="https://app.wheniwork.com/" target="_blank" rel="noopener noreferrer">Open When I Work ↗</a></p></details>';
  }
  function renderDetail() {
    const row = detail,
      decision = row.run?.plan || row.preview,
      isConfirmed = row.run?.status === "confirmed",
      prior = priorValue(row, decision),
      adjustment = Number(decision.forecast.adjustment_percent || 0),
      direction = (row.run || row.outlook_touched) ? (adjustment > 0 ? "up" : adjustment < 0 ? "down" : "same") : "",
      absolute = Math.abs(adjustment),
      fixed = [5, 10, 15, 20],
      custom = absolute > 0 && !fixed.includes(absolute),
      maximum = Number(row.config.maximum_hours),
      target = Number(row.config.baseline_hours),
      eventCap = Number.isFinite(maximum) && maximum > target ? maximum - target : 0,
      priorMeta = row.prior_week_sales || {},
      suggestion = row.sales_suggestion || {},
      priorHelper = priorMeta.kind === "projection"
        ? "Forecast baseline for " + date(priorMeta.start) + "–" + date(priorMeta.end) + " · " + priorMeta.source + ". This is a forecast, not closed sales."
        : priorMeta.kind === "workbook_actual"
        ? "Workbook actual for " + date(priorMeta.start) + "–" + date(priorMeta.end) + " · " + priorMeta.source + ". Net versus gross sales still needs confirmation."
        : priorMeta.stale
        ? "Historical reference from " + date(priorMeta.start) + "–" + date(priorMeta.end) + ". The requested prior week has not closed. Treat this as a provisional forecast and refresh before final approval."
        : priorMeta.complete
        ? "Pulled automatically from " + date(priorMeta.start) + "–" + date(priorMeta.end) + " · " + priorMeta.source
        : "Crumbl Internal has not supplied a complete closed week yet" + (priorMeta.days != null && priorMeta.expected ? " (" + priorMeta.days + " of " + priorMeta.expected + " days closed" + (priorMeta.missing_days?.length ? "; " + priorMeta.missing_days.join(", ") + " missing" : "") + ")" : "") + ". Enter the Monday–Saturday total to plan; it will be labeled operator-set.",
      salesKnown = prior != null,
      closedSales = row.closed_week_sales?.complete && Number(row.closed_week_sales.sales) > 0 ? row.closed_week_sales : priorMeta.complete && !["projection", "workbook_actual"].includes(priorMeta.kind) && Number(priorMeta.sales) > 0 ? priorMeta : null,
      baselines = [
        closedSales && { key: "closed", value: Number(closedSales.sales), title: "Last closed week", range: date(closedSales.start) + "–" + date(closedSales.end), source: pos(closedSales.source || "Point of sale net sales"), badge: "Last closed week", helper: "Point of sale · closed " + date(closedSales.start).replace(/, \d{4}$/, "") + "–" + date(closedSales.end).replace(/, \d{4}$/, "") + (row.in_progress_week ? " · this week is still open" : "") },
        ["projection", "workbook_actual"].includes(priorMeta.kind) && Number(priorMeta.sales) > 0 && { key: "ref", value: Number(priorMeta.sales), title: priorMeta.kind === "projection" ? "Forecast for " + date(priorMeta.start) + "–" + date(priorMeta.end) : "Workbook figure", range: date(priorMeta.start) + "–" + date(priorMeta.end), source: pos(priorMeta.source), badge: priorMeta.kind === "projection" ? "Forecast" : "Workbook figure", helper: priorHelper },
      ].filter(Boolean),
      shortRange = (a, b) => date(a).replace(/, \d{4}$/, "") + "–" + date(b).replace(/, \d{4}$/, ""),
      baselineInUse = baselines.find((b) => prior != null && Math.abs(b.value - Number(prior)) < 0.01) || null,
      baselineChooser = isConfirmed || baselines.length + (baselineInUse || prior == null ? 0 : 1) < 2 ? "" :
        '<fieldset class="la-baseline-choice"><legend>Which sales should drive next week?</legend>' +
        baselines.map((b) => '<label><input type="radio" name="baseline_choice" value="' + b.value + '" data-la-baseline="' + E(b.key) + '" ' + (baselineInUse === b ? "checked" : "") + '><span><b>' + E(b.title) + " · " + money(b.value) + "</b><small>" + E(b.range + " · " + b.source) + "</small></span></label>").join("") +
        (!baselineInUse && prior != null ? '<label><input type="radio" name="baseline_choice" value="' + E(prior) + '" checked><span><b>Saved in this draft · ' + money(prior) + '</b><small>Entered earlier; source not recorded</small></span></label>' : "") +
        "</fieldset>",
      d = Core.budgetDerivation(row.config, decision),
      position = locations.findIndex((r) => r.wallet.id === row.wallet.id) + 1,
      c = row.config,
      field = (name, label, value, help) => '<label>' + label + '<input form="la-assumptions-form" type="number" name="' + name + '" min="0" step="0.01" value="' + E(value ?? "") + '">' + (help ? "<small>" + help + "</small>" : "") + "</label>",
      select = (name, choices, current) => '<select form="la-assumptions-form" name="' + name + '">' + choices.map(([value, label]) => '<option value="' + value + '" ' + (current === value ? "selected" : "") + ">" + label + "</option>").join("") + "</select>";
    const assumedHours = c.salaried_hours_source === "assumed" || row.economics_evidence?.salaried_hours_source === "assumed";
    const assumptions = isTeam(row)
      ? '<details data-la-keep="la-edit-inputs" class="la-edit-inputs"><summary>Store inputs (set by the owner)</summary><dl class="la-readonly-inputs"><div><dt>Target labor %</dt><dd>' + percent(c.target_labor_percent) + '</dd></div><div><dt>Crew cost per hour (excl. tips)</dt><dd>' + money2(c.blended_hourly_cost) + '</dd></div><div><dt>Salaried cost per week</dt><dd>' + money(c.weekly_salaried_cost) + '</dd></div><div><dt>Salaried hours per week</dt><dd>' + number(c.salaried_schedule_hours) + " h" + (assumedHours ? " (assumed)" : "") + '</dd></div><div><dt>Skeleton floor</dt><dd>' + number(c.minimum_hours) + ' h</dd></div></dl><small>Only the store owner can change these. ' + E(c.measured_cost_source || "") + '</small></details>'
      : '<details data-la-keep="la-edit-inputs" class="la-edit-inputs"><summary>Edit these inputs</summary><div class="la-assumption-fields">' +
      field("target_labor_percent", "Target labor % of sales", c.target_labor_percent, "Fully loaded employer cost, excluding tips") +
      field("blended_hourly_cost", "Crew cost per hour ($, excluding tips)", c.blended_hourly_cost, (c.measured_cost_as_of ? "Measured " + date(c.measured_cost_as_of) + " · " : "") + E(c.measured_cost_source || "not measured")) +
      field("weekly_salaried_cost", "Salaried cost ($ per week)", c.weekly_salaried_cost, "Salaried staff on this store’s payroll, employer cost") +
      field("salaried_schedule_hours", "Salaried hours per week", c.salaried_schedule_hours, assumedHours ? "Assumed 40 h per salaried person — edit" : "Counted inside the hour budget") +
      field("weekly_shared_leadership_cost", "Shared or area leadership ($ per week)", c.weekly_shared_leadership_cost, "Optional; blank means none") +
      field("minimum_hours", "Skeleton floor (hours)", c.minimum_hours ?? 110, "Recommendations never go below this") +
      '<label>Planning method' + select("planning_mode", [["revenue", "Follow projected sales (recommended)"], ["store_framework", "Hold the fixed store framework"]], c.planning_mode === "store_framework" ? "store_framework" : "revenue") + "</label>" +
      '<label class="la-check"><input form="la-assumptions-form" type="checkbox" name="economic_inputs_confirmed" ' + (c.economic_inputs_confirmed ? "checked" : "") + '><span>I checked these against current payroll records.</span></label><button form="la-assumptions-form" class="btn btn-ghost" ' + (!row.pro || isConfirmed ? "disabled" : "") + '>Save inputs</button><small>Hours always include salaried staff; tips are never labor cost. Changes apply to this and future drafts; approved weeks keep their saved numbers.</small></div></details>';
    return (
      '<button class="la-back" data-la-list>← All stores</button><section class="la-detail-head"><div><span class="la-kicker">Store ' + position + " of " + locations.length + " · " + E(date(week) + " – " + date(add(week, 6))) + '</span><h1 id="la-store-heading" tabindex="-1">' + E(row.wallet.name) + '</h1><p>Four steps, about 10 minutes: sales outlook, hours, schedule, approve and hand off.</p><div class="la-head-help"><button type="button" class="la-help-btn primary" data-la-guide-run><span aria-hidden="true">▶</span> Walk me through it</button><button type="button" class="la-help-btn" data-la-guide-intro>What to expect</button></div></div><span class="la-status ' + (isConfirmed ? "confirmed" : row.run ? "draft" : "ready") + '">' + (isConfirmed ? "Approved" : row.run ? "Draft saved" : "Recommendation") + "</span></section>" +
      heroPlan(row, decision, isConfirmed, d) + storeSteps(row, decision, isConfirmed) + '<div class="la-store-grid"><div class="la-store-main">' +
      '<form id="la-plan-form" class="la-plan-form" data-wallet="' + E(row.wallet.id) + '" data-prior-imported="' + (currentSales(row) ? "true" : "false") + '">' +
      '<section class="la-step-section" id="la-step-outlook" aria-labelledby="la-outlook-heading"><h2 id="la-outlook-heading" tabindex="-1"><span class="la-step-number">1</span>What will sales do next week?</h2><div class="la-sales-builder"><div class="la-field"><label>Starting sales <em>' + E(baselineInUse ? baselineInUse.badge : prior != null ? "Saved in this draft" : "Needed") + '</em><div><span>$</span><input name="last_week_sales" type="number" min="1" step="1" value="' + E(prior ?? "") + '" ' + (isConfirmed ? "disabled" : currentSales(row) ? "readonly" : "") + " required></div><small>" + E(baselineInUse ? baselineInUse.helper : prior != null && priorMeta.sales != null && Math.abs(Number(priorMeta.sales) - Number(prior)) >= 0.01 ? "Entered earlier in this draft. " + (closedSales ? "Last closed week (" + date(closedSales.start) + "–" + date(closedSales.end) + ") was " + money(closedSales.sales) + "." : "") : priorHelper) + "</small></label>" + baselineChooser + "</div>" +
      "<fieldset " + (isConfirmed ? "disabled" : "") + "><legend>Your call</legend>" +
      (suggestion.available && !row.run ? '<div class="la-suggestion"><span>Fran suggests <b>' + E(suggestion.direction === "same" ? "flat" : suggestion.direction + " " + suggestion.percent + "%") + "</b></span><small>" + E(suggestion.reason) + '</small><button type="button" data-la-use-suggestion>Use suggestion</button></div>' : "") +
      '<div class="la-direction">' + [["down", "Down"], ["same", "Flat"], ["up", "Up"]].map(([v, l], i) => '<label><input type="radio" name="direction" value="' + v + '" ' + (direction === v ? "checked" : "") + (i ? "" : " required") + ">" + l + "</label>").join("") + '</div><div class="la-change-options" data-la-change-options ' + (direction === "up" || direction === "down" ? "" : "hidden") + "><span>By</span>" +
      fixed.map((x) => '<label><input type="radio" name="change_percent" value="' + x + '" ' + (absolute === x ? "checked" : "") + "><i>" + x + "%</i></label>").join("") +
      '<label><input type="radio" name="change_percent" value="custom" ' + (custom ? "checked" : "") + '><i>Custom</i></label><label class="la-custom" ' + (custom ? "" : "hidden") + '><input name="custom_percent" type="number" min="0.1" max="90" step="0.1" value="' + (custom ? absolute : "") + '" aria-label="Custom sales change percentage"><span>%</span></label></div></fieldset>' +
      '<div class="la-projection" aria-live="polite"><span>Next week’s projected sales</span><strong><span data-la-projection>' + money(salesKnown ? decision.forecast.sales : null) + '</span><span data-la-projection-info>' + info("projected sales", projectionTip(row, salesKnown ? decision.forecast.sales : null)) + "</span></strong><small data-la-impact>" + E(impactText(row, decision, salesKnown ? decision.forecast.sales : null)) + "</small></div></div>" +
      '<details data-la-keep="la-outlook-note" class="la-outlook-note"><summary>Add a note for the team (optional)</summary><label class="la-outlook-reason">Why this outlook?<textarea name="outlook_reason" maxlength="500" ' + (isConfirmed ? "disabled" : "") + ">" + E(decision.forecast.reason || "") + "</textarea><small>Menu, seasonality, events or a store disruption, so the variance can be explained later.</small></label></details>" + nextStep("la-step-budget", "Next: hour budget") + "</section>" +
      '<section class="la-step-section" id="la-step-budget" aria-labelledby="la-budget-heading"><h2 id="la-budget-heading" tabindex="-1"><span class="la-step-number">2</span>How many hours?</h2>' + hoursTrio(row, decision) +
      '<div class="la-budget-builder"><div class="la-field"><label>Your hour budget <span>Your decision</span><div><input name="hours" type="number" min="1" max="1000" step="0.5" value="' + E(decision.decision.hours) + '" ' + (isConfirmed ? "disabled" : "") + "><span>hours</span></div><small data-la-hours-help>" + E(hoursHelp(row, d)) + "</small></label></div>" +
      (eventCap ? '<div class="la-field"><label>Approved event flex <span>Optional</span><div><input name="event_hours" type="number" min="0" max="' + eventCap + '" step="0.5" value="' + E(decision.model.inputs?.event_hours || 0) + '" ' + (isConfirmed ? "disabled" : "") + "><span>hours</span></div><small>Up to " + number(eventCap) + " extra hours for a qualified offsite or event.</small></label></div>" : "") +
      budgetResult(row, decision, d) +
      "</div>" + (decision.model.review_required ? '<div class="la-review"><b>Operator review needed</b><span>Projected sales are below this store’s documented review line. Confirm coverage before changing the target.</span></div>' : "") +
      '<details class="la-derivation" data-la-derivation-panel ' + (row.derivation_open ? "open" : "") + '><summary>How we got <span data-la-derivation-hours>' + number(decision.decision.hours) + "</span> hours</summary><div data-la-derivation-body>" + derivationBody(row, decision) + "</div>" + (row.run?.operating_review ? '<p class="la-missing-note">' + E(row.run.operating_review.note) + "</p>" : "") + (isConfirmed ? "" : assumptions) + "</details>" +
      '<details data-la-keep="la-envelope" class="la-envelope"><summary>Daily targets · ' + number(decision.decision.hours) + " h across " + decision.envelope.filter((x) => x.open).length + " open days</summary><ol>" +
      decision.envelope.map((x, i) => '<li class="' + (x.day === decision.criteria.biggest_day ? "biggest" : "") + '"><div><b>' + E(x.day) + "</b><small>" + (x.open ? (x.day === decision.criteria.biggest_day ? "Protect the biggest day" : number(x.share) + "% of weekly hours") : "Closed") + '</small></div><span class="la-bar"><i style="width:' + Math.max(0, (x.share / 30) * 100) + '%"></i></span><strong>' + number(x.hours) + " h</strong>" + (decision.schedule.days[i].scheduled_hours != null ? '<em class="' + decision.schedule.days[i].status + '">' + (decision.schedule.days[i].variance > 0 ? "+" : "") + number(decision.schedule.days[i].variance) + " scheduled</em>" : "<em>No When I Work schedule yet</em>") + "</li>").join("") +
      "</ol></details>" + (isConfirmed ? "" : '<div class="la-actions"><button type="submit" name="intent" value="preview" class="la-link-btn">Recalculate from the server</button></div>') + nextStep("la-schedule", "Next: build the schedule", "la-step-save", "Skip to approve") + "</section></form>" + (isConfirmed || isTeam(row) ? "" : '<form id="la-assumptions-form" data-la-assumptions hidden></form>') + "</div>" + trustRail(row) + "</div>" +
      renderScheduleBuilder(row, decision, isConfirmed) + approvalStep(row, decision, isConfirmed) + planBar(row, decision, d)
    );
  }
  // Re-rendering replaces the DOM; keep keyboard focus on the equivalent control.
  function focusKey(el) {
    if (!el || !page.contains(el) || el === page) return null;
    if (el.id && el.tabIndex === -1 && /^H[1-3]$/.test(el.tagName)) return "#" + CSS.escape(el.id);
    const owner = el.closest("[data-la-assignment]"),
      prefix =
        owner && owner !== el
          ? '[data-la-assignment="' + CSS.escape(owner.dataset.laAssignment) + '"] '
          : "";
    for (const attribute of el.attributes)
      if (attribute.name.startsWith("data-la-"))
        return (
          prefix +
          "[" +
          attribute.name +
          (attribute.value ? '="' + CSS.escape(attribute.value) + '"' : "") +
          "]"
        );
    if (el.id) return "#" + CSS.escape(el.id);
    if (el.name)
      return (
        prefix +
        '[name="' +
        CSS.escape(el.name) +
        '"]' +
        (el.type === "radio" ? '[value="' + CSS.escape(el.value) + '"]' : "")
      );
    return null;
  }
  let shiftForm = null;
  let freshIds = new Set(),
    completedBefore = new Set();
  function completeDays(row) {
    const plan = row.run?.plan || row.preview,
      items = assignments(row);
    return new Set(
      plan.envelope
        .map((entry, index) =>
          entry.open &&
          Math.abs(
            items.filter((item) => item.day === index).reduce((sum, item) => sum + assignmentHours(item), 0) -
              Number(entry.hours || 0),
          ) <= 0.5
            ? index
            : -1,
        )
        .filter((index) => index >= 0),
    );
  }
  let pendingFocus = null,
    timelineView = { day: null, left: 0 };
  // On narrow screens the 24-hour canvas scrolls inside its card. Open each day at its first
  // shift instead of midnight, and keep the operator's position while they edit that day.
  function scrollTimeline() {
    const timeline = page.querySelector(".la-timeline"),
      track = page.querySelector(".la-shift-track, .la-hour-drop");
    if (!timeline || !track || timeline.scrollWidth <= timeline.clientWidth) return;
    if (timelineView.day === activeDay) timeline.scrollLeft = timelineView.left;
    else {
      const starts = assignments(detail)
          .filter((item) => item.day === activeDay)
          .map((item) => timeMinutes(item.start)),
        first = starts.length ? Math.min(...starts) : 7 * 60,
        hourWidth = track.getBoundingClientRect().width / 24;
      timeline.scrollLeft = Math.max(0, (first / 60 - 1) * hourWidth);
    }
    timelineView = { day: activeDay, left: timeline.scrollLeft };
    timeline.addEventListener("scroll", () => (timelineView.left = timeline.scrollLeft), { passive: true });
  }
  // Background loads (roster, saves) re-render the page. Keep the operator's unsaved outlook choices.
  function captureForm() {
    const form = page.querySelector("#la-plan-form");
    if (!form || !detail || form.dataset.wallet !== detail.wallet.id) return null;
    return [...form.elements]
      .filter((el) => el.name && !el.disabled && el.type !== "submit")
      .map((el) => [el.name, el.type, el.value, el.checked]);
  }
  function restoreForm(state) {
    const form = page.querySelector("#la-plan-form");
    if (!state || !form || form.elements.last_week_sales?.disabled) return;
    for (const [name, type, value, checked] of state) {
      const el = type === "radio" ? form.querySelector('[name="' + name + '"][value="' + CSS.escape(value) + '"]') : form.elements[name];
      if (!el || el.readOnly) continue;
      if (type === "radio" || type === "checkbox") el.checked = checked;
      else el.value = value;
    }
    quietProjection = true;
    form.querySelector("[name=direction]:checked")?.dispatchEvent(new Event("input", { bubbles: true, cancelable: false }));
    quietProjection = false;
  }
  let keptOpen = { scope: null, open: new Set() };
  let preserveForm = true,
    quietProjection = false;
  function render() {
    const key = pendingFocus || focusKey(document.activeElement),
      formState = preserveForm ? captureForm() : null;
    preserveForm = true;
    pendingFocus = null;
    // Keep disclosures the operator opened when the same store re-renders.
    const scope = detail ? detail.wallet.id : "portfolio", kept = keptOpen.scope === scope ? keptOpen.open : new Set();
    if (keptOpen.scope === scope) page.querySelectorAll("details[data-la-keep]").forEach((el) => (el.open ? kept.add(el.dataset.laKeep) : kept.delete(el.dataset.laKeep)));
    keptOpen = { scope, open: kept };
    page.innerHTML =
      '<header class="la-top">' +
      (demo
        ? '<span class="la-demo-chip" title="Sanitized sample stores and fictional employees. Nothing is saved to FranWallet, When I Work or Gusto.">Demo data <small>· sample stores, fictional team, nothing leaves this tab</small></span>'
        : '<button class="la-back" data-la-exit>← Payroll & scheduling</button>') +
      '<div class="la-top-actions">' +
      (demo
        ? '<button class="btn btn-ghost" data-la-demo-reset ' + (busy ? "disabled" : "") + ">Reset demo</button>"
        : "") +
      '<button class="btn btn-ghost" data-la-refresh ' +
      (busy ? "disabled" : "") +
      '>Refresh</button></div></header>' +
      (!detail ? periodControls() : "") + (detail ? renderDetail() : period === "month" ? renderMonth() : renderPortfolio() + operatingWorkflow()) + (summaryOpen && locations.length ? summaryDrawer() : "");
    page.querySelectorAll("details[data-la-keep]").forEach((el) => { if (keptOpen.open.has(el.dataset.laKeep)) el.open = true; });
    bind();
    restoreForm(formState);
    if (detail) completedBefore = completeDays(detail);
    freshIds = new Set();
    showToast();
    scrollTimeline();
    if (key) page.querySelector(key)?.focus({ preventScroll: true });
    if (scrollToDay) { scrollToDay = false; page.querySelector(".la-day-tabs")?.scrollIntoView({ block: "start", behavior: smooth() }); }
    if (detail && guideOnOpen) { guideOnOpen = false; setTimeout(runGuide, 450); }
  }
  async function work(fn) {
    if (busy) return;
    busy = true;
    message = "";
    render();
    try {
      await fn();
      // The server's answer is now the source of truth for the form.
      preserveForm = false;
    } catch (error) {
      message = errorMessage = error.message;
    } finally {
      busy = false;
      render();
    }
  }
  async function load() {
    if(period === "month") {
      const ticket=++sequence,chosenMonth=month;
      const portfolios=await Promise.all(Core.calendarWeeks(chosenMonth).map(start=>api("portfolio",{week_start:start})));
      if(ticket!==sequence)return;
      monthData=Core.monthSummary(chosenMonth,portfolios);
      return;
    }
    const previous = detail,
      ticket = ++sequence,
      data = await api("portfolio", { week_start: week });
    if (ticket !== sequence) return;
    locations = data.locations;
    detail = previous
      ? locations.find((r) => r.wallet.id === previous.wallet.id) || null
      : null;
    if (detail && previous) {
      detail.roster = previous.roster;
      detail.roster_loading = false;
      if (Array.isArray(previous.assignments))
        detail.assignments = previous.assignments;
    }
  }
  function selectedChange(form) {
    const direction = form.elements.direction.value;
    if (direction === "same") return 0;
    const chosen = form.querySelector("[name=change_percent]:checked");
    if (!chosen) throw Error("Choose 5%, 10%, 15%, 20% or Custom.");
    const amount =
      chosen.value === "custom"
        ? Number(form.elements.custom_percent.value)
        : Number(chosen.value);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 90)
      throw Error("Enter a custom change between 0.1% and 90%.");
    return direction === "down" ? -amount : amount;
  }
  function values(form) {
    const last = Number(form.elements.last_week_sales.value),
      adjustment = selectedChange(form),
      imported =
        form.dataset.priorImported === "true" &&
        detail.prior_week_sales?.complete &&
        Math.abs(last - Number(detail.prior_week_sales.sales)) < 0.01,
      enteredHours = Number(form.elements.hours.value),
      liveRec = detail.config.planning_mode === "revenue" ? Core.budgetDerivation(detail.config, liveDecision(detail.run?.plan || detail.preview, form)).recommended_hours : null,
      currentRecommendation = Number(liveRec ?? (detail.run?.plan || detail.preview).model.recommended_hours),
      hoursChanged = Math.abs(enteredHours - currentRecommendation) > 0.01;
    return {
      sales_reference: detail.prior_week_sales && Math.abs(last-Number(detail.prior_week_sales.sales))<0.01 ? detail.prior_week_sales : null,
      sales_metric: detail.prior_week_sales?.metric || "unconfirmed",
      outlook_reason: form.elements.outlook_reason?.value || null,
      last_week_sales: last,
      adjustment_percent: adjustment,
      last_week_source: imported
        ? detail.prior_week_sales.source ||
          "Crumbl Internal · closed sales week"
        : "Operator-entered prior-week sales",
      projection_as_of: imported
        ? detail.prior_week_sales.end
        : new Date().toISOString().slice(0, 10),
      event_hours: form.elements.event_hours
        ? Number(form.elements.event_hours.value || 0)
        : 0,
      confirmed_hours: hoursChanged ? enteredHours : null,
    };
  }
  async function openLocation(id) {
    message = "";
    detail = locations.find((row) => row.wallet.id === id) || null;
    activeDay = Math.max(
      0,
      detail?.preview?.envelope?.findIndex((day) => day.open) || 0,
    );
    if (!detail) return render();
    const row = detail;
    shiftForm = null;
    if (row.hours_touched === undefined) row.hours_touched = /operator/.test(String((row.run?.plan || row.preview)?.decision?.state || ""));
    assignments(row);
    completedBefore = completeDays(row);
    if (!row.roster) {
      row.roster_loading = true;
      pendingFocus = "#la-store-heading";
      render();
      try {
        row.roster = await api("roster", { wallet_id: row.wallet.id, week_start: week });
      } catch (error) {
        row.roster = { people: [], error: error.message };
        if (detail === row) message = error.message;
      } finally {
        row.roster_loading = false;
      }
    }
    if (!row.history) {
      row.history_loading = true;
      try { row.history = (await api("history", { wallet_id: row.wallet.id, week_start: week })).weeks || []; }
      catch { row.history = []; }
      finally { row.history_loading = false; }
    }
    // The operator may have moved on while the roster loaded.
    if (detail === row) { render(); autoDraft(row); }
  }
  // Done for you: with no saved draft, take Fran's outlook, keep the recommended hours and start from this store's
  // latest When I Work week trimmed to budget. Nothing is saved until the operator approves or saves.
  function autoDraft(row) {
    if (row.run || row.autodraft_tried || detail !== row || window.navigator?.webdriver) return;
    row.autodraft_tried = true;
    const form = page.querySelector("#la-plan-form"); if (!form || form.elements.last_week_sales?.disabled) return;
    const suggest = page.querySelector("[data-la-use-suggestion]");
    if (suggest) suggest.click(); else { const flat = form.querySelector('[name=direction][value="same"]'); if (flat) { flat.checked = true; flat.dispatchEvent(new Event("input", { bubbles: true })); } }
    row.autodrafted = true;
    if (!assignments(row).length && row.roster?.imported_template?.assignments?.length) { row.start_choice = "imported"; page.querySelector("[data-la-load-start]")?.click(); }
    else render();
    const placed = assignments(row).reduce((x, i) => x + assignmentHours(i), 0), budget = Number(page.querySelector("#la-plan-form [name=hours]")?.value) || 0, short = Math.round((budget - placed) * 10) / 10;
    message = row.schedule_fit ? "Drafted from last week’s When I Work schedule (" + number(placed) + " h)." + (short > 0.5 ? " You have " + number(short) + " h of room to add where you need it, or keep it lean." : " Review and approve.") : "Drafted for you from the recommendation. Review and approve.";
    errorMessage = ""; showToast();
  }
  async function saveDraft(form, note, input = values(form)) {
    const
      data = await api("draft", {
        wallet_id: detail.wallet.id,
        week_start: week,
        revision: detail.run?.revision,
        assignments: assignments(detail),
        ...input,
        note,
      });
    detail.run = {
      id: data.run.id,
      revision: data.run.revision,
      status: data.run.status,
      plan: data.run.data.plan,
      assignments: data.run.data.assignments || [],
      forecast_reviewed: data.run.data.forecast_reviewed!==false,
      config_snapshot: data.run.data.config_snapshot || null,
      operating_review: data.run.data.operating_review || null,
    };
    detail.assignments = data.run.data.assignments || [];
    detail.preview = data.run.data.plan;
    detail.unsaved_budget = false;
    const current = locations.find((row) => row.wallet.id === detail.wallet.id);
    if (current) Object.assign(current, detail);
    const assigned = detail.assignments.reduce(
        (sum, item) => sum + Number(item.hours || 0),
        0,
      ),
      remaining = Number(detail.preview.decision.hours || 0) - assigned;
    message =
      "Draft saved. " +
      (remaining >= 0
        ? number(remaining) + " hours remain to assign."
        : number(Math.abs(remaining)) + " hours are over the weekly budget.");
  }
  function downloadCsv(name,rows){const escape=value=>'"'+String(value??'').replaceAll('"','""')+'"',content=rows.map(row=>row.map(escape).join(',')).join('\r\n'),url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  // What to expect: from a store it starts the guided walkthrough; from the list it opens the next store and starts it there.
  function openGuide(){
    const G=window.FranLaborGuide;if(!G)return;
    if(detail)return G.intro({onStart:runGuide,startLabel:"Walk me through "+shortName(detail)});
    const next=planningProgress().next;
    G.intro(next?{onStart:()=>{guideOnOpen=true;page.querySelector('[data-la-wallet="'+CSS.escape(next.wallet.id)+'"]')?.click();},startLabel:"Walk me through "+shortName(next)}:{});
  }
  const shortName=(row)=>row.wallet.name.replace(/^Crumbl\s*[—-]\s*/,"");
  // The guided walkthrough runs on this store's real page and numbers, saying where each one comes from.
  function guidedStops(row){
    const decision=row.run?.plan||row.preview,form=page.querySelector("#la-plan-form"),live=form?liveDecision(decision,form):decision,d=Core.budgetDerivation(row.config,live),w=wiwScheduled(row,decision),cs=row.closed_week_sales||(row.prior_week_sales?.complete?row.prior_week_sales:null),ev=row.economics_evidence,items=assignments(row),r=row.roster||{},sd=v=>date(v).replace(/, \d{4}$/,""),base=Number(form?.elements.last_week_sales?.value)||null,adj=d.sales&&base?Math.round((d.sales/base-1)*1000)/10:0;
    const payroll=ev?new Date(ev.period_start+"T12:00:00Z").toLocaleDateString("en-US",{month:"short",timeZone:"UTC"})+" payroll":"latest payroll";
    return [
      {sel:".la-provenance",title:"Your numbers are already in",body:"Pulled from the systems you use. Nothing to type.",math:["Point of sale","When I Work","Gusto","Your rules"]},
      {sel:"#la-step-outlook .la-field",title:"Start: "+money(base),body:cs?.start?"Last closed week’s net sales.":"Last week’s Monday–Saturday sales.",tag:{label:"Point of sale",detail:cs?.start?sd(cs.start)+"–"+sd(cs.end):"closed week"}},
      {sel:"#la-step-outlook fieldset",title:"Make one call",body:"Up, flat or down for next week? Pick one now.",waitFor:"change",ready:()=>{const f=page.querySelector("#la-plan-form"),dir=f?.querySelector("[name=direction]:checked")?.value,pct=f?.querySelector("[name=change_percent]:checked")?.value;return dir==="same"||(!!pct&&(pct!=="custom"||Number(f.elements.custom_percent.value)>0));}},
      {sel:".la-projection",title:"Projected: "+money(d.sales),body:"Everything below follows this number.",math:[money(base),adj===0?"flat":(adj>0?"+":"−")+number(Math.abs(adj))+"%","= "+money(d.sales)],count:["[data-la-projection]"]},
      {sel:".la-rec",title:"Recommended: "+number(d.recommended_hours)+" h",body:d.binding==="lean_check"?"Last week’s staffing, scaled to sales, came in lower, so that wins.":d.binding==="floor"?"The target allows less, so the 110 h floor holds.":"What your labor target affords, never below the floor.",math:d.binding==="lean_check"&&d.lean_hours!=null?[number(d.lean.hours)+" h last week","× "+money(d.sales)+" ÷ "+money(d.lean.sales),"= "+number(d.lean_hours)+" h","→ "+number(d.recommended_hours)+" h"]:d.crew_rate!=null&&d.sales!=null?[money(d.sales),"× "+percent(d.goal_percent)].concat(d.fixed_leadership>0?["− "+money(d.fixed_leadership)+" salary"]:[],["÷ "+money2(d.crew_rate)+"/h"],d.salaried_hours>0?["+ "+number(d.salaried_hours)+" salaried h"]:[],["= "+number(d.affordable_hours)+" h"],d.binding==="floor"?["floor "+number(d.floor_hours)+" h"]:[],["→ "+number(d.recommended_hours)+" h"]):null,tag:{label:"Gusto",detail:payroll+" · tips excluded"},count:[".la-rec strong"]},
      {sel:".la-wiw",title:w.hours==null?"When I Work: nothing yet":w.hours===0&&w.unpublished>0?"Why it says 0 h":number(w.hours)+" h already published",body:w.hours==null?"No schedule imported for this week yet. You’ll build one below.":w.hours===0&&w.unpublished>0?number(w.unpublished)+" h are drafted but not published. Drafts can change, so they don’t count yet.":"Compare it with your budget on the bar.",tag:{label:"When I Work",detail:w.imported?"imported "+sd(w.imported):"schedule export"}},
      {sel:".la-budget-builder",title:"Your call on hours",body:"Change the number and labor % updates instantly. Under goal is fine.",math:[number(live.decision.hours)+" h","= "+money(d.total_cost),percent(d.labor_percent)+" of sales"],count:["[data-la-labor-cost]","[data-la-labor-percent]"]},
      {sel:"#la-schedule > header",open:"la-schedule",title:"Build the schedule",body:items.length?"Go day by day with Next. Labor % tracks what’s on screen.":"Start from last week’s When I Work schedule, trimmed to budget.",action:!items.length&&r.imported_template?.assignments?.length?{label:"Load last week’s schedule",run:()=>{const radio=page.querySelector('[data-la-start-choice][value="imported"]');if(radio)radio.checked=true;page.querySelector("[data-la-load-start]")?.click();}}:null},
      {sel:"[data-la-planbar]",title:"Always in view",body:"Budget, labor % and Save stay pinned here."},
      {sel:"#la-step-save",title:"Approve and hand off",body:"Approve, save, send the brief, next store. The manager publishes in When I Work.",math:["Approve","Save","Send brief","Next store"]}
    ];
  }
  function runGuide(){const G=window.FranLaborGuide;if(G&&detail)G.run(page,()=>guidedStops(detail),{auto:true});}
  function bind() {
    page.querySelectorAll("[data-la-guide-intro]").forEach((button)=>button.addEventListener("click",openGuide));
    page.querySelector("[data-la-guide-run]")?.addEventListener("click",runGuide);
    if(locations.length&&!busy&&window.FranLaborGuide?.shouldIntro()){window.FranLaborGuide.markSeen();setTimeout(openGuide,350);}
    const assumptions=page.querySelector('[data-la-assumptions]');if(assumptions)assumptions.onsubmit=event=>{event.preventDefault();work(async()=>{const c={...detail.config};if(isTeam(detail))throw Error('Only the store owner can change store economics.');for(const name of ['salaried_schedule_hours','blended_hourly_cost','weekly_salaried_cost','weekly_shared_leadership_cost','target_labor_percent','minimum_hours'])c[name]=assumptions.elements[name].value===''?null:Number(assumptions.elements[name].value);c.planning_mode=assumptions.elements.planning_mode.value;c.hourly_cost_basis='employer_cost';c.budget_hours_basis='total_hours';c.tips_excluded=true;if(c.minimum_hours==null)c.minimum_hours=110;c.economic_inputs_confirmed=assumptions.elements.economic_inputs_confirmed.checked;if(c.economic_inputs_confirmed&&(c.blended_hourly_cost==null||c.weekly_salaried_cost==null||c.salaried_schedule_hours==null))throw Error('Add the crew rate, salaried cost and salaried hours before confirming.');const data=await api('save_config',{wallet_id:detail.wallet.id,revision:detail.config.revision,config:c});detail.config=data.config;const preview=await api('preview',{wallet_id:detail.wallet.id,week_start:week,...values(page.querySelector('#la-plan-form'))});detail.preview=preview.plan;detail.unsaved_budget=true;if(detail.run&&detail.run.status!=="confirmed")detail.run.plan=preview.plan;message='Planning assumptions saved. Rebuild and save this week’s draft before approval; approved weeks retain their saved decisions.';});};
    page.querySelector('[data-la-download-schedule]')?.addEventListener('click',()=>{const rows=[['date','store','employee','employee_id','start','end','break_hours','paid_hours','position','status'],...assignments(detail).map(item=>[add(week,item.day),detail.wallet.name,item.employee,item.employee_id,item.start,item.end,item.break_hours||0,assignmentHours(item),item.position,'draft; availability and coverage require review'])];downloadCsv('franwallet-schedule-draft-'+week+'.csv',rows);message='Draft CSV downloaded. An agent can transfer it to When I Work; this is not a verified When I Work import format.';render();});
    page.querySelectorAll('[data-la-period]').forEach(button=>button.onclick=()=>work(async()=>{period=button.dataset.laPeriod;detail=null;monthData=null;if(period==='month')month=week.slice(0,7);await load();}));
    page.querySelector('[data-la-month]')?.addEventListener('change',event=>{const chosen=event.target.value;work(async()=>{Core.calendarWeeks(chosen);month=chosen;monthData=null;await load();});});
    page.querySelector('[data-la-copy-month]')?.addEventListener('click',()=>copyText(monthBrief(),'Monthly budget'));
    page.querySelectorAll('[data-la-month-week]').forEach(button=>button.onclick=()=>work(async()=>{period='week';week=button.dataset.laMonthWeek;detail=null;await load();if(button.dataset.laMonthWallet)await openLocation(button.dataset.laMonthWallet);}));
    page
      .querySelector("[data-la-exit]")
      ?.addEventListener("click", () => {
        message = "";
        showToast();
        switchTab(returnRoute);
      });
    page
      .querySelector("[data-la-refresh]")
      ?.addEventListener("click", () => work(load));
    page.querySelectorAll("[data-la-jump]").forEach((link) =>
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const target = document.getElementById(link.dataset.laJump);
        if (target?.tagName === "DETAILS") { target.open = true; if (detail) detail.schedule_open = true; }
        target?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      }),
    );
    page.querySelector("[data-la-demo-reset]")?.addEventListener("click", () => {
      demo.reset();
      detail = null;
      activeDay = 0;
      selectedEmployee = "";
      work(load).then(() => {
        message = "Demo reset. Every store is back to its prepared Sunday state.";
        render();
      });
    });
    page.querySelectorAll("[data-la-list]").forEach((button) =>
      button.addEventListener("click", () => {
        detail = null;
        message = "";
        render();
      }),
    );
    page
      .querySelectorAll("[data-la-copy-all]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          copyText(portfolioBrief(), "All store targets"),
        ),
      );
    page
      .querySelectorAll("[data-la-copy]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          copyText(managerBrief(detail), "Manager brief"),
        ),
      );
    page.querySelectorAll("[data-la-week]").forEach(
      (button) =>
        (button.onclick = () =>
          work(async () => {
            week = add(week, Number(button.dataset.laWeek));
            detail = null;
            await load();
          })),
    );
    page
      .querySelectorAll("[data-la-wallet]")
      .forEach(
        (button) =>
          (button.onclick = async () => { await openLocation(button.dataset.laWallet); window.scrollTo(0, 0); page.querySelector("#la-store-heading")?.focus({ preventScroll: true }); }),
      );
    page
      .querySelector("[data-la-next]")
      ?.addEventListener("click", async (event) => {
        await openLocation(event.currentTarget.dataset.laNext);
        window.scrollTo(0, 0);
        page.querySelector("#la-store-heading")?.focus({ preventScroll: true });
      });
    page
      .querySelectorAll("[data-la-upgrade]")
      .forEach((button) =>
        button.addEventListener("click", () => switchTab("billing")),
      );
    const form = page.querySelector("#la-plan-form");
    if (form) {
      const updateProjection = () => {
        const last = Number(form.elements.last_week_sales.value || 0),
          direction = form.elements.direction.value,
          chosen = form.querySelector("[name=change_percent]:checked"),
          pct =
            chosen?.value === "custom"
              ? Math.abs(Number(form.elements.custom_percent.value || 0))
              : Math.abs(Number(chosen?.value || 0)),
          factor =
            direction === "down"
              ? 1 - pct / 100
              : direction === "up"
                ? 1 + pct / 100
                : 1,
          options = form.querySelector("[data-la-change-options]"),
          customField = form.querySelector(".la-custom");
        if (options)
          options.hidden = !(direction === "up" || direction === "down");
        if (customField) customField.hidden = chosen?.value !== "custom";
        const projected = last > 0 ? last * factor : null,
          decision = detail.run?.plan || detail.preview,
          cost = decision.financials?.estimated_labor_cost,
          laborPercent = page.querySelector("[data-la-labor-percent]"),
          impact = page.querySelector("[data-la-impact]");
        page.querySelector("[data-la-projection]").textContent =
          projected ? money(projected) : "—";

        if (impact) impact.textContent = impactText(detail, decision, projected);
        // Revenue mode: the recommendation follows the projection; it updates the hour field until the operator edits it.
        if (detail.config.planning_mode === "revenue" && !detail.hours_touched && projected && form.elements.hours && !form.elements.hours.disabled) {
          const rec = Core.budgetDerivation(detail.config, { ...decision, forecast: { ...decision.forecast, sales: projected } }).recommended_hours;
          if (rec != null) form.elements.hours.value = rec;
        }
        // Recalculate labor dollars, labor %, affordable hours, the derivation, tips and the trio from the live form.
        const live = liveDecision(decision, form), d = Core.budgetDerivation(detail.config, live), swap = (sel, html) => { const el = page.querySelector(sel); if (el) el.outerHTML = html; };
        swap("[data-la-budget-result]", budgetResult(detail, live, d));
        const pinfo = page.querySelector("[data-la-projection-info]"); if (pinfo) pinfo.innerHTML = info("projected sales", projectionTip(detail, projected));
        const help = page.querySelector("[data-la-hours-help]"); if (help) help.textContent = hoursHelp(detail, d);
        const dh = page.querySelector("[data-la-derivation-hours]"); if (dh) dh.textContent = number(live.decision.hours);
        const body = page.querySelector("[data-la-derivation-body]"); if (body) body.innerHTML = derivationBody(detail, live);
        const trio = page.querySelector("[data-la-trio]"); if (trio) trio.outerHTML = hoursTrio(detail, decision, live.decision.hours, d);
        swap("[data-la-planbar]", planBar(detail, live, d));
        swap("[data-la-hero]", heroPlan(detail, live, detail.run?.status === "confirmed", d));
        swap(".la-store-steps", storeSteps(detail, live, detail.run?.status === "confirmed"));
        const approveLabel = page.querySelector("#la-confirm-check + span"); if (approveLabel) approveLabel.textContent = "Approve " + number(live.decision.hours) + " hours as this week’s budget.";
        const reasonWrap = page.querySelector("[data-la-reason-wrap]"); if (reasonWrap) reasonWrap.hidden = !reasonNeeded(detail, live);

        if (direction) detail.outlook_touched = true;
        if (!quietProjection) page.querySelectorAll("[data-la-projection],[data-la-labor-percent],[data-la-side-summary]").forEach((el) => {
          el.classList.remove("la-flash");
          void el.offsetWidth;
          el.classList.add("la-flash");
        });
        const side = page.querySelector("[data-la-side-summary]");
        if (side && projected)
          side.textContent =
            money(projected) +
            " projected sales" +
            (cost != null
              ? " · " + money(cost) + " labor · " + percent(Math.round((cost / projected) * 1000) / 10)
              : "");
      };
      form
        .querySelectorAll(
          "[name=last_week_sales],[name=direction],[name=change_percent],[name=custom_percent],[name=hours]",
        )
        .forEach((input) => input.addEventListener("input", (event) => { if (event.isTrusted && event.target.name === "hours") detail.hours_touched = true; updateProjection(); }));
      form.querySelectorAll("[name=baseline_choice]").forEach((radio) => radio.addEventListener("change", () => { form.elements.last_week_sales.value = radio.value; updateProjection(); }));
      page
        .querySelector("[data-la-use-suggestion]")
        ?.addEventListener("click", () => {
          const suggestion = detail.sales_suggestion || {},
            direction = form.querySelector(
              '[name=direction][value="' + suggestion.direction + '"]',
            );
          if (direction) direction.checked = true;
          if (suggestion.direction !== "same") {
            const value = [5, 10, 15, 20].includes(Number(suggestion.percent))
                ? String(suggestion.percent)
                : "custom",
              choice = form.querySelector(
                '[name=change_percent][value="' + value + '"]',
              );
            if (choice) choice.checked = true;
            if (value === "custom")
              form.elements.custom_percent.value = suggestion.percent;
          }
          updateProjection();
        });
      form.onsubmit = (event) => {
        event.preventDefault();
        const intent = event.submitter?.value || "preview",
          input = values(form);
        work(async () => {
          if (intent === "preview") {
            const data = await api("preview", {
              wallet_id: detail.wallet.id,
              week_start: week,
              ...input,
            });
            detail.preview = data.plan;
            detail.unsaved_budget = true;
            if(detail.run && detail.run.status!=="confirmed")detail.run.plan=data.plan;
            detail.prior_week_sales =
              data.prior_week_sales || detail.prior_week_sales;
            detail.sales_suggestion =
              data.sales_suggestion || detail.sales_suggestion;
            detail.outlook_touched = true;
            detail.pro = data.pro;
            return;
          }
          await saveDraft(
            form,
            "Operator set the prior-week sales outlook and weekly hour budget.",
          );
        });
      };
    }
    page.querySelectorAll("[data-la-day]").forEach((button) =>
      button.addEventListener("click", () => {
        activeDay = Number(button.dataset.laDay);
        shiftForm = null;
        render();
      }),
    );
    page
      .querySelector("[data-la-previous-day]")
      ?.addEventListener("click", () => {
        activeDay = Math.max(0, activeDay - 1);
        shiftForm = null;
        scrollToDay = true;
        render();
      });
    page.querySelector("[data-la-next-day]")?.addEventListener("click", () => {
      activeDay = Math.min(6, activeDay + 1);
      shiftForm = null;
      scrollToDay = true;
      render();
    });
    page.querySelector('[data-la-restore-pattern]')?.addEventListener('click',()=>{const original=detail.schedule_original||detail.run?.data?.original_schedule_pattern;if(original){detail.assignments=original.map(s=>({...s}));detail.schedule_fit=null;message='Original pattern restored. Saved source records remain available.';render();}});
    page.querySelector('[data-la-fit-budget]')?.addEventListener('click',()=>{
      const source=assignments(detail),result=FranLaborAgentCore.fitScheduleToBudget(detail.config,detail.run?.plan||detail.preview,source);
      detail.schedule_original=source.map(s=>({...s}));
      detail.assignments=result.assignments;
      detail.schedule_fit=result;
      detail.schedule_source_label=(detail.schedule_source_label||'Your schedule')+', trimmed to budget';
      message=result.within_budget?'Budget-fit candidate built. '+result.review.hours+' h. Review availability, breaks, peak coverage and qualified leads before saving.':'Candidate needs coverage review: '+result.conflicts.join('; ');
      render();
    });
    const applyStartingPoint=(source,label)=>{
      const base=detail.run?.plan||detail.preview,typed=Number(page.querySelector("#la-plan-form [name=hours]")?.value),ratio=typed>0&&base.decision.hours?typed/Number(base.decision.hours):1,target=ratio===1?base:{...base,decision:{...base.decision,hours:typed},envelope:base.envelope.map(e=>({...e,hours:Math.round(e.hours*ratio*2)/2}))};
      const original=templateAssignments(source),fit=FranLaborAgentCore.fitScheduleToBudget(detail.config,target,original);
      detail.schedule_original=original;detail.schedule_fit=fit;detail.schedule_source_label=label+" ("+original.length+" shifts), trimmed toward the budget";
      detail.assignments=fit.assignments;
      freshIds=new Set(detail.assignments.filter(item=>item.day===activeDay).map(item=>item.id));
      message=label+" loaded. Built a "+fit.review.hours+" h candidate. "+(fit.within_budget?"Within budget; availability and coverage require review.":"Review conflicts: "+fit.conflicts.join("; "));
      render();
    };
    // Shift editing: one inline form for add and edit. Drag-and-drop is a shortcut, never required.
    const person=name=>(detail.roster?.people||[]).find(entry=>entry.name===name);
    const defaults=(name,startMinutes=null)=>{const p=person(name),start=startMinutes!=null?clock(startMinutes):p?.common_start||"10:00";let end=startMinutes==null&&p?.common_end&&timeMinutes(p.common_end)>timeMinutes(start)?p.common_end:clock(Math.min(1440,timeMinutes(start)+(p?.common_end&&p?.common_start?Math.max(60,timeMinutes(p.common_end)-timeMinutes(p.common_start)):240)));if(timeMinutes(end)<=timeMinutes(start))end=clock(Math.min(1440,timeMinutes(start)+240));return {start,end,position:p?.role||""};};
    const openAdd=(name,startMinutes=null)=>{const who=name||selectedEmployee||(detail.roster?.people||[])[0]?.name||"";if(!who){message=errorMessage="No team roster is imported for this store yet.";render();return;}selectedEmployee=who;shiftForm={mode:"add",day:activeDay,employee:who,break_hours:0,...defaults(who,startMinutes)};pendingFocus="[data-la-sf-start]";render();};
    const addPersonAt=(name,hour)=>{
      if(!name)return openAdd(null,Number(hour)*60);
      const d=defaults(name,Number(hour)*60),p=person(name),id=crypto.randomUUID?crypto.randomUUID():"assignment-"+Date.now(),item={id,day:activeDay,employee:name,employee_id:p?.id||null,start:d.start,end:d.end,break_hours:0,position:p?.role||null,tag:(p?.tags||[])[0]||null,note:null};
      item.hours=assignmentHours(item);assignments(detail).push(item);freshIds=new Set([id]);shiftForm=null;
      message=name+" added "+timeLabel(item.start)+"–"+timeLabel(item.end)+".";pendingFocus='[data-la-assignment="'+CSS.escape(id)+'"] [data-la-edit-shift]';render();
    };
    page.querySelectorAll("[data-la-add-shift]").forEach(button=>button.addEventListener("click",()=>openAdd(button.dataset.laAddShift)));
    page.querySelector("[data-la-empty-start]")?.addEventListener("click",()=>applyStartingPoint(detail.roster.imported_template.assignments,"Latest When I Work week"));
    const shiftEl=page.querySelector("[data-la-shift-form]");
    if(shiftEl){
      const sync=()=>{shiftForm.employee=shiftEl.elements.employee.value;shiftForm.start=shiftEl.elements.start.value;shiftForm.end=shiftEl.elements.end.value;shiftForm.break_hours=Number(shiftEl.elements.break_hours.value||0);shiftForm.position=shiftEl.elements.position.value;};
      shiftEl.elements.employee.addEventListener("change",()=>{sync();if(shiftForm.mode==="add")Object.assign(shiftForm,defaults(shiftForm.employee));pendingFocus="[data-la-sf-employee]";render();});
      for(const name of ["start","end","break_hours"])shiftEl.elements[name].addEventListener("change",()=>{sync();if(name==="start"&&timeMinutes(shiftForm.end)<=timeMinutes(shiftForm.start))shiftForm.end=clock(Math.min(1440,timeMinutes(shiftForm.start)+240));render();});
      shiftEl.elements.position.addEventListener("input",sync);
      shiftEl.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();shiftForm=null;render();}});
      shiftEl.querySelector("[data-la-sf-cancel]").addEventListener("click",()=>{const back=shiftForm.mode==="edit"?'[data-la-assignment="'+CSS.escape(shiftForm.id)+'"] [data-la-edit-shift]':'[data-la-add-shift="'+CSS.escape(shiftForm.employee)+'"]';shiftForm=null;pendingFocus=back;render();});
      shiftEl.querySelector("[data-la-sf-remove]")?.addEventListener("click",()=>removeShift(shiftForm.id));
      shiftEl.addEventListener("submit",event=>{
        event.preventDefault();sync();
        if(!shiftForm.employee){message=errorMessage="Choose an employee.";return render();}
        if(timeMinutes(shiftForm.end)<=timeMinutes(shiftForm.start)){message=errorMessage="End time must be after the start time.";pendingFocus="[data-la-sf-end]";return render();}
        const p=person(shiftForm.employee);let item;
        if(shiftForm.mode==="edit"){item=assignments(detail).find(x=>x.id===shiftForm.id);if(!item){shiftForm=null;return render();}Object.assign(item,{employee:shiftForm.employee,employee_id:p?.id||item.employee_id||null,start:shiftForm.start,end:shiftForm.end,break_hours:shiftForm.break_hours,position:shiftForm.position||null});}
        else{item={id:crypto.randomUUID?crypto.randomUUID():"assignment-"+Date.now(),day:activeDay,employee:shiftForm.employee,employee_id:p?.id||null,start:shiftForm.start,end:shiftForm.end,break_hours:shiftForm.break_hours,position:shiftForm.position||null,tag:(p?.tags||[])[0]||null,note:null};assignments(detail).push(item);}
        item.hours=assignmentHours(item);freshIds=new Set([item.id]);
        message=item.employee+" "+(shiftForm.mode==="edit"?"updated":"added")+" "+timeLabel(item.start)+"–"+timeLabel(item.end)+".";
        shiftForm=null;pendingFocus='[data-la-assignment="'+CSS.escape(item.id)+'"] [data-la-edit-shift]';render();
      });
    }
    const removeShift=id=>{const item=assignments(detail).find(x=>x.id===id),rows=[...page.querySelectorAll("[data-la-assignment]")],i=rows.findIndex(r=>r.dataset.laAssignment===id),next=rows[i+1]||rows[i-1];detail.assignments=assignments(detail).filter(x=>x.id!==id);if(shiftForm?.id===id)shiftForm=null;message=item?item.employee+" "+timeLabel(item.start)+"–"+timeLabel(item.end)+" removed.":"Shift removed.";pendingFocus=next?'[data-la-assignment="'+CSS.escape(next.dataset.laAssignment)+'"] [data-la-edit-shift]':"[data-la-add-shift]";render();};
    page.querySelector("[data-la-fill]")?.addEventListener("click",event=>{
      const button=event.currentTarget,name=button.dataset.laFill,person=(detail.roster?.people||[]).find(entry=>entry.name===name),id=crypto.randomUUID?crypto.randomUUID():"assignment-"+Date.now(),item={id,day:activeDay,employee:name,employee_id:person?.id||null,start:button.dataset.laFillStart,end:button.dataset.laFillEnd,break_hours:0,position:person?.role||null,tag:(person?.tags||[])[0]||null,note:"Suggested from imported roster tags"};
      item.hours=assignmentHours(item);
      assignments(detail).push(item);
      freshIds=new Set([id]);
      const day=(detail.run?.plan||detail.preview).envelope[activeDay].day;
      message=name+" added "+timeLabel(item.start)+"–"+timeLabel(item.end)+". Review "+day+" availability and coverage.";
      pendingFocus="[data-la-next-day]";
      render();
    });
    page.querySelector("[data-la-roster-search]")?.addEventListener("input",event=>{rosterSearch=event.target.value;const term=rosterSearch.toLowerCase();page.querySelectorAll("[data-la-person]").forEach(card=>card.hidden=!!term&&!card.innerText.toLowerCase().includes(term));});
    const timeline=page.querySelector(".la-timeline");
    page.querySelectorAll("[data-la-person]").forEach(button=>{
      button.addEventListener("click",()=>openAdd(button.dataset.laPerson));
      button.addEventListener("dragstart",event=>{event.dataTransfer.setData("text/plain",button.dataset.laPerson);event.dataTransfer.effectAllowed="copy";timeline?.classList.add("la-dragging");});
      button.addEventListener("dragend",()=>{timeline?.classList.remove("la-dragging");page.querySelectorAll(".la-drop-over").forEach(el=>el.classList.remove("la-drop-over"));});
    });
    page.querySelectorAll("[data-la-hour]").forEach(button=>{
      button.addEventListener("dragover",event=>{event.preventDefault();button.classList.add("la-drop-over");});
      button.addEventListener("dragleave",()=>button.classList.remove("la-drop-over"));
      button.addEventListener("drop",event=>{event.preventDefault();timeline?.classList.remove("la-dragging");addPersonAt(event.dataTransfer.getData("text/plain"),button.dataset.laHour);});
      button.addEventListener("click",()=>openAdd(shiftForm?.employee||selectedEmployee||null,Number(button.dataset.laHour)*60));
    });
    page.querySelector("[data-la-copy-day]")?.addEventListener("click",()=>{
      const source=assignments(detail).filter(item=>item.day===activeDay),targets=(detail.run?.plan||detail.preview).envelope.filter((entry,index)=>entry.open&&index>activeDay&&!assignments(detail).some(item=>item.day===index)).map(entry=>entry.index);
      for(const dayIndex of targets)for(const item of source)assignments(detail).push({...item,id:crypto.randomUUID?crypto.randomUUID():"assignment-"+Date.now()+dayIndex,day:dayIndex});
      message=targets.length?"Copied "+(detail.run?.plan||detail.preview).envelope[activeDay].day+" to "+targets.length+" empty "+(targets.length===1?"day.":"days."):"Every later open day already has shifts.";render();
    });
    page.querySelector("[data-la-clear-day]")?.addEventListener("click",()=>{detail.assignments=assignments(detail).filter(item=>item.day!==activeDay);render();});
    page.querySelectorAll("[data-la-assignment]").forEach((row) => {
      const item = assignments(detail).find((entry) => entry.id === row.dataset.laAssignment);
      if (!item) return;
      const edit = () => { shiftForm = { mode: "edit", id: item.id, day: item.day, employee: item.employee, start: item.start, end: item.end, break_hours: Number(item.break_hours || 0), position: item.position || "" }; pendingFocus = "[data-la-sf-start]"; render(); };
      row.querySelectorAll("[data-la-edit-shift],[data-la-shift-block]").forEach((button) => button.addEventListener("click", edit));
      row.querySelector("[data-la-remove-assignment]")?.addEventListener("click", () => removeShift(item.id));
      row.addEventListener("keydown", (event) => { if ((event.key === "Delete" || event.key === "Backspace") && event.target.matches("[data-la-edit-shift]")) { event.preventDefault(); removeShift(item.id); } });
    });
    page.querySelector("[data-la-template-name]")?.addEventListener("input",event=>{templateName=event.target.value;});
    page.querySelector("[data-la-save-template]")?.addEventListener("click",()=>{const name=page.querySelector("[data-la-template-name]")?.value;work(async()=>{const data=await api("save_template",{wallet_id:detail.wallet.id,name,assignments:assignments(detail)});detail.roster.templates=(detail.roster.templates||[]).filter(item=>item.id!==data.template.id&&item.name!==data.template.name);detail.roster.templates.unshift(data.template);message=data.template.name+" is ready for future weeks.";});});
    page
      .querySelector("[data-la-copy-schedule]")
      ?.addEventListener("click", () =>
        copyText(scheduleBrief(detail), "Weekly schedule"),
      );
    page
      .querySelector("[data-la-save-schedule]")
      ?.addEventListener("click", () => {
        const scheduleForm = page.querySelector("#la-plan-form");
        if (!scheduleForm) return;
        work(() =>
          saveDraft(
            scheduleForm,
            "Operator updated the day-by-day working schedule.",
          ),
        );
      });
    // Approval choices live on the row, so re-renders (busy states, roster loads) never drop them.
    page.querySelector("[data-la-forecast-ack]")?.addEventListener("change", (event) => (approvalState(detail).ack = event.target.checked));
    page.querySelector("[data-la-approve]")?.addEventListener("change", (event) => {
      approvalState(detail).approve = event.target.checked;
      const mode = page.querySelector("[data-la-save-mode]");
      if (mode) mode.textContent = event.target.checked ? "Saves as approved and stays here." : "Saves a draft and stays here; approve later.";
    });
    page.querySelector("[data-la-exception-reason]")?.addEventListener("input", (event) => (approvalState(detail).reason = event.target.value));
    page.querySelector("[data-la-save-next]")?.addEventListener("click", () => saveStore(true));
    page.querySelector("[data-la-save-stay]")?.addEventListener("click", () => saveStore(false));
    page.querySelectorAll("[data-la-summary-open]").forEach((button) => button.addEventListener("click", () => { summaryOpen = true; summaryReturn = "[data-la-summary-open]"; pendingFocus = "#la-summary-heading"; render(); }));
    page.querySelectorAll("[data-la-summary-close]").forEach((button) => button.addEventListener("click", closeSummary));
    page.querySelector(".la-drawer")?.addEventListener("keydown", (event) => { if (event.key === "Escape") closeSummary(); });
    page.querySelector("[data-la-copy-summary]")?.addEventListener("click", () => copyText(summaryText(), "Portfolio summary"));
    page.querySelectorAll("[data-la-start-choice]").forEach((input) => input.addEventListener("change", () => (detail.start_choice = input.value)));
    page.querySelector("[data-la-load-start]")?.addEventListener("click", () => {
      const choice = page.querySelector("[data-la-start-choice]:checked")?.value || "blank", r = detail.roster || {};
      detail.start_choice = choice;
      if (choice === "imported") return applyStartingPoint(r.imported_template.assignments, "Latest When I Work week");
      if (choice === "previous") return applyStartingPoint(r.previous_schedule.assignments, "Last FranWallet plan");
      if (choice.startsWith("template:")) { const t = (r.templates || []).find((x) => "template:" + x.id === choice); if (t) return applyStartingPoint(t.assignments, t.name); }
      detail.assignments = []; detail.schedule_fit = null; message = "Blank week ready. Choose a team member, then a starting hour."; render();
    });
    page.querySelector("[data-la-schedule-panel]")?.addEventListener("toggle", (event) => { if (detail) detail.schedule_open = event.target.open; });
    page.querySelector("[data-la-derivation-panel]")?.addEventListener("toggle", (event) => { if (detail) detail.derivation_open = event.target.open; });
  }
  // Delegated: the plan bar is redrawn while the operator edits, so its Save is handled here.
  page.addEventListener("click", (event) => {
    if (event.target.closest("[data-la-planbar-save]")) page.querySelector("[data-la-save-stay]")?.click();
    if (event.target.closest("[data-la-hero-approve]") && detail) {
      const a = approvalState(detail); a.approve = true;
      const box = page.querySelector("[data-la-approve]"); if (box) box.checked = true;
      if (needsAck(detail) && !a.ack) { goTo("la-step-save"); message = errorMessage = "One check first: confirm you reviewed the sales forecast, then approve."; showToast(); }
      else page.querySelector("[data-la-save-stay]")?.click();
    }
    const go = event.target.closest("[data-la-goto]"); if (go) goTo(go.dataset.laGoto);
    const rec = event.target.closest("[data-la-use-rec]"), hoursField = page.querySelector("#la-plan-form [name=hours]");
    if (rec && hoursField && !hoursField.disabled) { detail.hours_touched = false; hoursField.value = rec.dataset.laUseRec; hoursField.dispatchEvent(new Event("input", { bubbles: true })); }
  });
  // Delegated: the derivation body re-renders live, so its button is replaced while the operator edits.
  page.addEventListener("click", (event) => {
      if (!event.target.closest("[data-la-use-evidence]") || !detail) return;
      const ev = detail.economics_evidence, f = document.getElementById("la-assumptions-form");
      if (!ev || !f) return;
      f.elements.blended_hourly_cost.value = ev.crew_rate_excluding_tips;
      if (ev.weekly_salaried_cost != null) f.elements.weekly_salaried_cost.value = ev.weekly_salaried_cost;
      if (ev.salaried_hours_per_week != null) f.elements.salaried_schedule_hours.value = ev.salaried_hours_per_week;
      const box = page.querySelector(".la-edit-inputs"); if (box) box.open = true;
      f.elements.blended_hourly_cost.focus();
      message = "Inputs filled from Gusto " + date(ev.period_start) + "–" + date(ev.period_end) + ". Review, then Save inputs."; showToast();
    });
  // Info buttons: one open at a time; Esc returns focus to the button; outside click closes; kept inside the viewport.
  function closeTips(except) { page.querySelectorAll("[data-la-info][aria-expanded=true]").forEach((b) => { if (b === except) return; b.setAttribute("aria-expanded", "false"); const t = document.getElementById(b.getAttribute("aria-controls")); if (t) t.hidden = true; }); }
  page.addEventListener("click", (event) => {
    const button = event.target.closest("[data-la-info]");
    if (!button) { if (!event.target.closest(".la-tip")) closeTips(); return; }
    event.preventDefault();
    const tip = document.getElementById(button.getAttribute("aria-controls")), open = button.getAttribute("aria-expanded") !== "true";
    closeTips(button);
    button.setAttribute("aria-expanded", String(open));
    if (!tip) return;
    tip.hidden = !open;
    tip.style.marginLeft = "0px";
    if (open) { const r = tip.getBoundingClientRect(), max = document.documentElement.clientWidth - 8; let dx = 0; if (r.right > max) dx = max - r.right; if (r.left + dx < 8) dx = 8 - r.left; tip.style.marginLeft = dx + "px"; }
  });
  page.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = page.querySelector("[data-la-info][aria-expanded=true]");
    if (!open) return;
    event.stopPropagation(); event.preventDefault(); closeTips(); open.focus();
  }, true);
  let summaryReturn = null;
  function closeSummary() { summaryOpen = false; pendingFocus = summaryReturn; summaryReturn = null; render(); }
  // The single end-of-store action: save the draft, approve when ticked, then open the next store.
  async function saveStore(advance) {
    const row = detail, form = page.querySelector("#la-plan-form"), a = approvalState(row), confirmed = row.run?.status === "confirmed";
    let input = null;
    try { if (!confirmed) input = values(form); } catch (error) { message = errorMessage = error.message; return render(); }
    if (!confirmed && a.approve && needsAck(row) && !a.ack) {
      message = errorMessage = "Tick “I reviewed this provisional sales forecast” to approve, or untick Approve to save a draft.";
      pendingFocus = "[data-la-forecast-ack]"; return render();
    }
    let moved = false;
    await work(async () => {
      if (!confirmed) {
        await saveDraft(form, "Operator saved the weekly outlook, hour budget and schedule.", input);
        if (a.approve) {
          if (reasonNeeded(row, row.run.plan) && !a.reason.trim()) { pendingFocus = "[data-la-exception-reason]"; throw Error("Draft saved. Add a short reason for approving above the labor target, then save again."); }
          await confirmRun(row, a);
        }
      }
      if (!confirmed && row.run?.status === "confirmed") justPlanned.add(row.wallet.id);
      const saved = row.run?.status === "confirmed" ? row.wallet.name + " approved." : row.wallet.name + " saved as a draft.";
      if (!advance) { message = saved; return; }
      const next = nextAfter(row);
      moved = true;
      if (next) { await openLocation(next.wallet.id); message = saved + " Now planning " + next.wallet.name + "."; }
      else { detail = null; summaryOpen = true; pendingFocus = "#la-summary-heading"; message = saved + " Every store has a saved plan."; }
    });
    if (moved) { window.scrollTo(0, 0); if (!summaryOpen) page.querySelector("#la-store-heading")?.focus({ preventScroll: true }); }
  }
  async function confirmRun(row, a) {
    const data = await api("confirm", { wallet_id: row.wallet.id, run_id: row.run.id, revision: row.run.revision, confirm: true, acknowledge_forecast: needsAck(row) ? a.ack === true : false, exception_reason: a.reason.trim() || null });
    row.run = { id: data.run.id, revision: data.run.revision, status: data.run.status, confirmed_at: data.run.confirmed_at, confirmed_by: data.run.confirmed_by, plan: data.run.data.plan, assignments: data.run.data.assignments || [], approval_review: data.run.data.approval_review || null, forecast_reviewed: data.run.data.forecast_reviewed !== false, config_snapshot: data.run.data.config_snapshot || null, operating_review: data.run.data.operating_review || null };
    row.assignments = data.run.data.assignments || [];
    const current = locations.find((r) => r.wallet.id === row.wallet.id);
    if (current && current !== row) Object.assign(current, row);
  }
  let activeScope = null;
  const walletScope=()=>String((typeof ME!=="undefined"?ME:window.ME)?.id||"")+":"+String(typeof WALLET_ID!=="undefined"?WALLET_ID:window.WALLET_ID||"");
  async function open() {
    activeScope=walletScope();
    returnRoute = "payroll";
    detail = null;
    locations = [];
    message = "Loading next week’s labor plan…";
    switchTab("labor-agent");
    render();
    await work(load);
    // Opened from one store's Payroll page: go straight to that store when this user can plan it.
    const current = String(typeof WALLET_ID !== "undefined" ? WALLET_ID : window.WALLET_ID || "");
    if (!demo && current && current !== "all" && locations.some((r) => r.wallet.id === current)) await openLocation(current);
  }
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-la-open]")) open();
  });
  // Entry point on every Payroll page, including a single store reached through team access. The shell re-renders
  // that header, so the button is restored whenever it disappears.
  function ensureEntry() {
    const heading = document.querySelector("#page-payroll .main-hdr");
    if (!heading || heading.querySelector("[data-la-open]")) return;
    const button = document.createElement("button");
    button.className = "btn btn-primary";
    button.dataset.laOpen = "";
    button.textContent = "Plan next week";
    heading.append(button);
  }
  ensureEntry();
  window.addEventListener("fran:location", ensureEntry);
  const payrollPage = document.querySelector("#page-payroll");
  if (payrollPage && typeof MutationObserver !== "undefined") new MutationObserver(ensureEntry).observe(payrollPage, { childList: true, subtree: true });
  window.addEventListener("fran:location", () => {
    // The demo has no signed-in wallet; shell location changes do not apply to it.
    if (demo) return;
    if(activeScope!==null && activeScope===walletScope())return;
    activeScope=walletScope();
    sequence++;
    detail = null;
    locations = [];
    page.innerHTML = "";
    toast.classList.remove("show", "error");
  });
  window.FranLaborAgent = { open };
  const params = new URLSearchParams(location.search),
    requestedWeek = params.get("week");
  const requestedMonth=params.get("month");
  if(/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth||"")){month=requestedMonth;period="month";}
  if (params.get("labor") === "1") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(requestedWeek || "")) week = requestedWeek;
    if(demo)setTimeout(open,0);
    else {
      const openAfterBoot=async()=>{try{const {data:{session}}=await sb.auth.getSession();if(!session)return;if(typeof bootInFlight!=="undefined"&&bootInFlight)await bootInFlight;await open();}catch(error){message=errorMessage=error.message;render();}};
      setTimeout(openAfterBoot,0);
    }
  }
})();
