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
  function status(row) {
    if (row.run?.status === "confirmed") return ["Confirmed", "confirmed"];
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
  function source(row) {
    if (!row.prior_week_sales?.complete && !row.run)
      return (
        E(row.prior_week_sales?.source || "Closed sales not received") +
        "<small>missing · enter last week’s total to plan</small>"
      );
    const p = row.preview.forecast.provenance,
      asOf = p.as_of || (row.prior_week_sales?.complete ? row.prior_week_sales.end : null);
    return (
      E(p.source) +
      "<small>" +
      E((p.type || "source").replaceAll("-", " ")) +
      (asOf ? " · " + date(asOf) : " · awaiting prior-week sales") +
      "</small>"
    );
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
  function managerBrief(row, decision = row.run?.plan || row.preview) {
    const days = decision.envelope
        .filter((d) => d.open)
        .map((d) => d.day + " " + number(d.hours) + "h")
        .join(" · "),
      prior = decision.forecast.base_sales,
      f = decision.financials,
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
      decision.criteria.notes.join(" ") +
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
    return {person,start:clock(start),end:clock(start+hours*60),hours,reason:offered(person)?"Marked “"+offered(person)+"” in the imported roster.":"Not on the "+dayName+" schedule yet"+(person.common_start?" · usually starts "+timeLabel(person.common_start):"")+"."};
  }
  function renderScheduleBuilder(row,decision,isConfirmed){
    const roster=row.roster?.people||[],items=assignments(row),day=decision.envelope[activeDay]||decision.envelope[0],dayItems=items.filter(item=>item.day===activeDay).sort((a,b)=>a.start.localeCompare(b.start)),assigned=dayItems.reduce((sum,item)=>sum+assignmentHours(item),0),weeklyAssigned=items.reduce((sum,item)=>sum+assignmentHours(item),0),remaining=Number(day.hours||0)-assigned,weeklyRemaining=Number(decision.decision.hours||0)-weeklyAssigned,daysOnTarget=decision.envelope.filter((entry,index)=>entry.open&&Math.abs(items.filter(item=>item.day===index).reduce((sum,item)=>sum+assignmentHours(item),0)-Number(entry.hours||0))<=.5).length,openDays=decision.envelope.filter(entry=>entry.open).length;
    const filtered=roster.filter(person=>!rosterSearch||[person.name,person.role,...(person.tags||[])].join(" ").toLowerCase().includes(rosterSearch.toLowerCase()));
    const people=filtered.map(person=>'<button type="button" class="la-person '+(selectedEmployee===person.name?'selected':'')+'" aria-pressed="'+(selectedEmployee===person.name)+'" draggable="'+(!isConfirmed)+'" data-la-person="'+E(person.name)+'"><span class="la-avatar">'+E(person.name.split(/\s+/).map(x=>x[0]).slice(0,2).join(""))+'</span><span class="la-person-copy"><strong>'+E(person.name)+'</strong><small>'+E(person.role||"Team member")+(person.scheduled_rate!=null?" · "+money2(person.scheduled_rate)+"/hr in WIW":"")+(person.common_start?' · usually '+timeLabel(person.common_start):'')+'</small><span class="la-person-tags">'+((person.tags||[]).length?(person.tags||[]).slice(0,3).map(tag=>'<i>'+E(tag)+'</i>').join(""):'<i>No imported tags</i>')+'</span></span></button>').join("");
    const saved=row.roster?.templates||[],imported=row.roster?.imported_template,previous=row.roster?.previous_schedule;
    const starts=[];
    if(imported?.assignments?.length)starts.push('<button type="button" class="la-start-card" data-la-use-imported><strong>Start from latest When I Work week</strong><span>'+date(imported.start)+'–'+date(imported.end)+' · '+imported.assignments.length+' shifts</span></button>');
    if(previous?.assignments?.length)starts.push('<button type="button" class="la-start-card" data-la-use-previous><strong>Start from last FranWallet plan</strong><span>Week of '+date(previous.week_start)+' · '+previous.assignments.length+' shifts</span></button>');
    if(saved.length)starts.push('<label class="la-template-select"><span>Saved template</span><select data-la-template-choice>'+saved.map(t=>'<option value="'+E(t.id)+'">'+E(t.name)+'</option>').join("")+'</select><button type="button" class="btn btn-ghost" data-la-use-template>Use template</button></label>');
    const hourLabels=Array.from({length:24},(_,hour)=>'<span>'+String(hour).padStart(2,"0")+'</span>').join("");
    const dropHours=Array.from({length:24},(_,hour)=>'<button type="button" data-la-hour="'+hour+'" aria-label="Add selected employee at '+timeLabel(clock(hour*60))+'"></button>').join("");
    const rows=dayItems.map(item=>{const person=roster.find(entry=>entry.name===item.employee),left=(timeMinutes(item.start)/1440)*100,width=((timeMinutes(item.end)-timeMinutes(item.start))/1440)*100;return '<article class="la-timeline-row'+(freshIds.has(item.id)?' fresh':'')+'" style="--la-delay:'+(freshIds.has(item.id)?Math.min(8,[...freshIds].indexOf(item.id))*70:0)+'ms" data-la-assignment="'+E(item.id)+'"><div class="la-shift-person"><strong>'+E(item.employee)+'</strong><small>'+E(item.position||person?.role||"Team member")+'</small></div><div class="la-shift-track"><div class="la-shift-block" style="left:'+left+'%;width:'+Math.max(2,width)+'%"><span>'+timeLabel(item.start)+'–'+timeLabel(item.end)+'</span></div></div><div class="la-shift-edit"><label><span>Start</span><select data-la-assignment-start '+(isConfirmed?'disabled':'')+'>'+timeOptions(item.start)+'</select></label><label><span>End</span><select data-la-assignment-end '+(isConfirmed?'disabled':'')+'>'+timeOptions(item.end,true)+'</select></label><label><span>Break</span><select data-la-assignment-break '+(isConfirmed?'disabled':'')+'>'+[0,.25,.5,.75,1].map(value=>'<option value="'+value+'" '+(Number(item.break_hours||0)===value?'selected':'')+'>'+number(value)+' h</option>').join("")+'</select></label>'+(person?.effective_gross_per_hour!=null?'<small>'+money2(person.effective_gross_per_hour)+' recent gross/paid hr</small>':'')+(!isConfirmed?'<button type="button" data-la-remove-assignment aria-label="Remove '+E(item.employee)+'">Remove</button>':'')+'</div></article>';}).join("");
    return '<section class="la-schedule-builder" id="la-schedule"><header><div><span class="la-kicker">Weekly schedule workspace</span><h2>Start with a pattern. Adjust only what changed.</h2><p>Use the latest imported week or a saved template, then drag a person onto an hour. The manager can confirm the final handoff in When I Work.</p></div><div class="la-weekly-progress"><strong>'+number(weeklyAssigned)+' / '+number(decision.decision.hours)+' h</strong><span>'+(weeklyRemaining>=0?number(weeklyRemaining)+' h left':number(Math.abs(weeklyRemaining))+' h over')+' · '+daysOnTarget+' of '+openDays+' open days on target</span></div></header>'+
      (starts.length?'<div class="la-starting-points"><div><span class="la-kicker">Fast start</span><strong>Reuse what already works</strong></div>'+starts.join("")+'</div>':'')+
      '<nav class="la-day-tabs" aria-label="Schedule days">'+decision.envelope.map((entry,index)=>{const total=items.filter(item=>item.day===index).reduce((sum,item)=>sum+assignmentHours(item),0);return '<button type="button" data-la-day="'+index+'" class="'+(activeDay===index?'active ':'')+(entry.open&&Math.abs(total-Number(entry.hours||0))<=.5?'complete'+(completedBefore.has(index)?'':' just-complete'):'')+'" '+(!entry.open?'disabled':'')+'><span>'+E(entry.day.slice(0,3))+'</span><small>'+number(total)+' / '+number(entry.hours)+' h</small></button>';}).join("")+'</nav>'+
      '<div class="la-day-summary"><div><span>'+E(day.day)+' target</span><strong>'+number(day.hours)+' hours</strong></div><div><span>Assigned</span><strong>'+number(assigned)+' hours</strong></div><div class="'+(remaining<0?'over':'')+'"><span>'+(remaining<0?'Over target':'Remaining')+'</span><strong>'+number(Math.abs(remaining))+' hours</strong></div><div class="la-day-progress"><i style="width:'+Math.min(100,day.hours?(assigned/day.hours)*100:0)+'%" class="'+(remaining<0?'over':'')+'"></i></div></div>'+
      (()=>{if(isConfirmed||!day.open||!items.length)return "";const gap=gapSuggestion(roster,day.day,dayItems,remaining);
        if(gap)return '<div class="la-gap"><span class="la-gap-mark" aria-hidden="true"></span><div><b>'+number(remaining)+' hours open on '+E(day.day)+'</b><span>'+E(gap.person.name)+' can cover it. '+E(gap.reason)+' Confirm availability in When I Work.</span></div><button type="button" class="btn btn-primary" data-la-fill="'+E(gap.person.name)+'" data-la-fill-start="'+gap.start+'" data-la-fill-end="'+gap.end+'">Add '+E(gap.person.name.split(" ")[0])+' '+timeLabel(gap.start)+'–'+timeLabel(gap.end)+'</button></div>';
        if(remaining<-0.5)return '<div class="la-gap over"><span class="la-gap-mark" aria-hidden="true"></span><div><b>'+number(Math.abs(remaining))+' hours over the '+E(day.day)+' target</b><span>Shorten or remove a shift, or keep it and flag it for the manager.</span></div></div>';
        return "";})()+
      '<div class="la-workspace"><aside class="la-people-rail"><header><strong>Team · '+roster.length+'</strong><span>Click, then choose an hour. Or drag.</span><small>'+E(row.roster?.template_source||"Latest connected roster")+'</small>'+(row.roster?.template_source&&row.roster?.source?'<small>'+E(row.roster.source)+'</small>':'')+'</header><input type="search" data-la-roster-search value="'+E(rosterSearch)+'" placeholder="Search people or tags" aria-label="Search people or tags">'+(row.roster_loading?'<p class="la-rail-note">Loading roster…</p>':people||(roster.length?'<p class="la-rail-note">No matching employees.</p>':'<p class="la-rail-note"><strong>No roster imported yet.</strong> When I Work has not supplied this store’s team. The hour budget and manager brief still work; the manager assigns people in When I Work.</p>'))+'</aside><main class="la-timeline"><div class="la-timeline-toolbar"><div><strong>'+E(day.day)+'</strong><span>24-hour schedule · click an employee, then an hour</span></div><div><button type="button" class="btn btn-ghost" data-la-copy-day '+(!dayItems.length||isConfirmed?'disabled':'')+'>Copy day forward</button><button type="button" class="btn btn-ghost" data-la-clear-day '+(!dayItems.length||isConfirmed?'disabled':'')+'>Clear day</button></div></div><div class="la-hour-axis">'+hourLabels+'</div><div class="la-hour-drop" aria-label="Hourly drop zones">'+dropHours+'</div><div class="la-timeline-rows">'+(rows||'<div class="la-empty-canvas"><strong>No shifts yet</strong><span>Choose a team member, then click their starting hour above.</span></div>')+'</div></main></div>'+
      '<footer><div class="la-day-navigation"><button type="button" class="btn btn-ghost" data-la-previous-day '+(activeDay===0?'disabled':'')+'>← Previous day</button><button type="button" class="btn btn-ghost" data-la-next-day '+(activeDay>=decision.envelope.length-1?'disabled':'')+'>Next day →</button></div><div class="la-schedule-actions"><label class="la-template-name"><span>Template name</span><input data-la-template-name value="'+E(templateName)+'" maxlength="80"></label><button type="button" class="btn btn-ghost" data-la-save-template '+(!items.length||!row.pro||isConfirmed?'disabled':'')+'>Save as template</button><button type="button" class="btn btn-ghost" data-la-copy-schedule '+(!items.length?'disabled':'')+'>Copy weekly schedule</button><button type="button" class="btn btn-primary" data-la-save-schedule '+(!row.pro||isConfirmed?'disabled':'')+'>Save schedule draft</button></div></footer>'+(!row.pro?'<p class="la-save-help">Saving requires Location Pro. Review access in Billing.</p>':'')+'</section>';
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
      closed = locations.filter((r) => r.prior_week_sales?.complete).length,
      reviewed = locations.filter((r) => r.run).length,
      confirmed = locations.filter((r) => r.run?.status === "confirmed").length,
      scheduled = locations.filter(
        (r) => r.preview.schedule.scheduled_hours != null,
      ).length,
      next =
        locations.find(
          (r) => r.run?.status !== "confirmed" && r.prior_week_sales?.complete,
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
      ["4", "Schedules checked", p.scheduled],
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
        (r) => r.preview.financials?.estimated_labor_cost != null,
      ),
      laborCost = costRows.reduce(
        (n, r) => n + Number(r.preview.financials.estimated_labor_cost),
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
      ? '<div><h2>Budgets confirmed. Finish the handoff.</h2><p>Every store is ready for manager review. Copy the approved briefs into your manager workflow; publishing stays a separate approval in When I Work.</p></div><div class="la-next-buttons"><button class="btn btn-primary" data-la-copy-all>Copy approved briefs</button><a class="btn btn-ghost" href="https://app.wheniwork.com/" target="_blank" rel="noopener noreferrer">Open When I Work ↗</a></div>'
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
      '<section class="la-hero"><div><span class="la-kicker">Sunday planning run</span><h1>Finish next week’s labor plan while the numbers are fresh.</h1><p>FranWallet brings in the closed sales week. You make one outlook decision per store, confirm the budget, and leave with a schedule-ready manager brief.</p></div><div class="la-week"><button data-la-week="-7" aria-label="Previous week">←</button><span><b>' +
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
      '%"></i></div></section><div class="la-metrics"><div><span>Total sales projection</span><strong>' +
      money(sales) +
      "</strong><small>" +
      p.closed +
      " of " +
      p.total +
      " stores pulled from a complete prior week</small></div><div><span>Labor hours</span><strong>" +
      number(hours) +
      " h</strong><small>" +
      p.confirmed +
      " confirmed · " +
      p.scheduled +
      (p.scheduled === 1 ? " schedule checked" : " schedules checked") +
      "</small></div><div><span>Estimated weekly labor</span><strong>" +
      money(laborCost) +
      "</strong><small>" +
      costRows.length +
      " of " +
      p.total +
      " stores with measured employer cost</small></div><div><span>Labor % of projected sales</span><strong>" +
      percent(laborPercent) +
      '</strong><small>Comparable stores · provisional until wage inputs are approved</small></div></div><section class="la-worklist"><header><div><h2>Plan store by store</h2><p>Each target follows that store’s operating framework. Sales outlook changes context; it never silently adds hours.</p></div><div class="la-worklist-actions"><span class="la-model">Deterministic · labor-v2</span><button class="btn btn-ghost" data-la-copy-all>Copy all targets</button></div></header><div class="la-table"><table><thead><tr><th>Location</th><th>Prior week → projection</th><th>Labor budget</th><th>Current schedule</th><th>Status</th><th></th></tr></thead><tbody>' +
      locations
        .map((row) => {
          const [label, tone] = status(row),
            plan = row.preview,
            schedule = plan.schedule,
            prior = priorValue(row, plan),
            f = plan.financials;
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
                : money(prior) + " closed") +
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
              ? percent(f.estimated_labor_percent) + " of sales · "
              : "") +
            E(plan.model.method.replaceAll("_", " ")) +
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
  // Where this store stands: one decision, one budget, one schedule, one approval.
  function storeSteps(row, decision, isConfirmed) {
    const weekly = assignments(row).reduce((sum, item) => sum + assignmentHours(item), 0),
      hours = Number(decision.decision.hours || 0),
      chosen = !!(row.run || row.outlook_touched),
      scheduled = weekly > 0 && Math.abs(weekly - hours) <= 0.5,
      steps = [
        ["la-plan-form", "Sales outlook", chosen ? (outlook(decision.forecast) === "about the same" ? "Flat" : outlook(decision.forecast).replace(/^./, (c) => c.toUpperCase())) : "One choice", chosen],
        ["la-plan-form", "Hour budget", row.run ? number(hours) + " h saved" : number(hours) + " h recommended", !!row.run],
        ["la-schedule", "Schedule", weekly ? number(weekly) + " / " + number(hours) + " h" : "Start from last week", scheduled],
        ["la-handoff", "Manager handoff", isConfirmed ? "Ready for review" : "After approval", isConfirmed],
      ],
      current = steps.findIndex((step) => !step[3]);
    return (
      '<ol class="la-store-steps" aria-label="' + E(row.wallet.name) + ' planning steps">' +
      steps
        .map(
          ([target, label, state, done], index) =>
            '<li class="' + (done ? "done" : index === current ? "current" : "") + '"><a href="#' + target + '" data-la-jump="' + target + '"' +
            (index === current ? ' aria-current="step"' : "") +
            "><span>" + (done ? "✓" : index + 1) + "</span><div><b>" + label + "</b><small>" + E(state) + "</small></div></a></li>",
        )
        .join("") +
      "</ol>"
    );
  }
  // One-sentence explanation at the decision point: what the outlook changes and what it does not.
  function impactText(row, decision, sales) {
    const hours = Number(decision.decision.hours),
      cost = decision.financials?.estimated_labor_cost,
      review = row.config.review_below_sales,
      held =
        "Hours stay at " +
        number(hours) +
        " h under " +
        row.wallet.name +
        "’s framework (floor " +
        number(row.config.minimum_hours) +
        " h); sales never add hours on their own.";
    if (!(sales > 0)) return "Enter last week’s closed sales to see the projection. " + held;
    return (
      held +
      (cost != null
        ? " Estimated labor " + money(cost) + " is " + percent(Math.round((cost / sales) * 1000) / 10) + " of this projection."
        : " Labor % needs measured employer cost.") +
      (review != null && sales < review
        ? " Below the " + money(review) + " review line: confirm coverage before cutting hours."
        : "")
    );
  }
  function renderDetail() {
    const row = detail,
      decision = row.run?.plan || row.preview,
      financials = decision.financials || {},
      isConfirmed = row.run?.status === "confirmed",
      variance = decision.schedule.variance,
      prior = priorValue(row, decision),
      adjustment = Number(decision.forecast.adjustment_percent || 0),
      direction =
        row.run || row.outlook_touched
          ? adjustment > 0
            ? "up"
            : adjustment < 0
              ? "down"
              : "same"
          : "",
      absolute = Math.abs(adjustment),
      fixed = [5, 10, 15, 20],
      custom = absolute > 0 && !fixed.includes(absolute),
      maximum = Number(row.config.maximum_hours),
      target = Number(row.config.baseline_hours),
      eventCap =
        Number.isFinite(maximum) && maximum > target ? maximum - target : 0,
      method = decision.model.method.replaceAll("_", " "),
      priorMeta = row.prior_week_sales || {},
      suggestion = row.sales_suggestion || {},
      priorHelper = priorMeta.complete
        ? "Pulled automatically from " +
          date(priorMeta.start) +
          "–" +
          date(priorMeta.end) +
          " · " +
          priorMeta.source
        : "Crumbl Internal has not supplied a complete closed week yet" +
          (priorMeta.days != null && priorMeta.expected
            ? " (" + priorMeta.days + " of " + priorMeta.expected + " days closed" +
              (priorMeta.missing_days?.length ? "; " + priorMeta.missing_days.join(", ") + " missing" : "") +
              ")"
            : "") +
          ". Enter the Monday–Saturday total to plan; it will be labeled operator-set.",
      salesKnown = prior != null,
      p = planningProgress(),
      nextRow = locations.find(
        (r) => r.wallet.id !== row.wallet.id && r.run?.status !== "confirmed",
      );
    const approval =
      (!row.pro
        ? '<section class="la-upgrade"><span>Location Pro</span><h3>Save and compare each weekly plan</h3><p>Your free wallet can build the budget. Pro retains decisions, plan-to-actual tracking and cited Fran AI explanations.</p><button class="btn btn-primary" data-la-upgrade>Review Location Pro</button></section>'
        : row.run && !isConfirmed
          ? '<section class="la-confirm"><div><span class="la-kicker">Draft saved · approval</span><h3>Approve ' +
            E(row.wallet.name) +
            "’s budget?</h3><p>" +
            number(decision.decision.hours) +
            " hours · " +
            money(decision.forecast.sales) +
            " projected sales" +
            (financials.estimated_labor_percent != null && salesKnown ? " · " + percent(financials.estimated_labor_percent) + " labor" : "") +
            '. You can also keep moving and approve it later.</p></div><div class="la-approval-actions"><label><input type="checkbox" id="la-confirm-check"> I approve this exact weekly hour budget.</label><button class="btn btn-primary" data-la-confirm disabled>Confirm weekly plan</button>' +
            (nextRow
              ? '<button class="btn btn-ghost" data-la-next="' +
                E(nextRow.wallet.id) +
                '">Continue to ' +
                E(nextRow.wallet.name) +
                " →</button>"
              : "") +
            "</div></section>"
          : isConfirmed
            ? '<section class="la-completion"><div><span>Plan confirmed</span><h3>' +
              (p.confirmed === p.total
                ? "All budgets are ready for When I Work."
                : E(row.wallet.name) + " is ready for manager review.") +
              "</h3><p><b>" +
              E(row.wallet.name) +
              " is ready.</b> " +
              p.confirmed +
              " of " +
              p.total +
              " labor budgets confirmed for this week. " +
              (p.confirmed === p.total
                ? "Managers review each plan and assign people in When I Work. Publishing stays a separate approval there."
                : p.total - p.confirmed + (p.total - p.confirmed === 1 ? " plan left." : " plans left.")) +
              '</p></div><div class="la-approval-actions">' +
              (nextRow
                ? '<button class="btn btn-primary" data-la-next="' +
                  E(nextRow.wallet.id) +
                  '">Continue to ' +
                  E(nextRow.wallet.name) +
                  " →</button>"
                : '<button class="btn btn-primary" data-la-list>Review all plans</button>') +
              '<button class="btn btn-ghost" data-la-copy>Copy this manager brief</button></div></section>'
            : "");
    return (
      '<button class="la-back" data-la-list>← All location plans</button><section class="la-detail-head"><div><span class="la-kicker">' +
      E(date(week) + " – " + date(add(week, 6))) +
      "</span><h1>" +
      E(row.wallet.name) +
      '</h1><p>Start with last week, apply what you know, and approve the store’s hour budget.</p></div><span class="la-status ' +
      (isConfirmed ? "confirmed" : row.run ? "draft" : "ready") +
      '">' +
      (isConfirmed ? "Confirmed" : row.run ? "Draft saved" : "Recommendation") +
      '</span></section>' +
      storeSteps(row, decision, isConfirmed) +
      (isConfirmed ? '<div class="la-approval top">' + approval + "</div>" : "") +
      '<div class="la-detail-grid"><main><form id="la-plan-form" class="la-plan-form" data-wallet="' +
      E(row.wallet.id) +
      '" data-prior-imported="' +
      (priorMeta.complete ? "true" : "false") +
      '"><section class="la-sales-builder"><div class="la-step"><span>1</span><div class="la-field"><label>Last week’s sales <em>' +
      (priorMeta.complete ? "Auto-filled" : "Needed") +
      '</em><div><span>$</span><input name="last_week_sales" type="number" min="1" step="1" value="' +
      E(prior ?? "") +
      '" ' +
      (isConfirmed ? "disabled" : priorMeta.complete ? "readonly" : "") +
      " required></div><small>" +
      E(priorHelper) +
      '</small></label></div></div><div class="la-step"><span>2</span><fieldset ' +
      (isConfirmed ? "disabled" : "") +
      "><legend>What will sales do next week?</legend>" +
      (suggestion.available && !row.run
        ? '<div class="la-suggestion"><span>Fran suggests <b>' +
          E(
            suggestion.direction === "same"
              ? "flat"
              : suggestion.direction + " " + suggestion.percent + "%",
          ) +
          "</b></span><small>" +
          E(suggestion.reason) +
          '</small><button type="button" data-la-use-suggestion>Use suggestion</button></div>'
        : "") +
      '<div class="la-direction"><label><input type="radio" name="direction" value="down" ' +
      (direction === "down" ? "checked" : "") +
      ' required>Down</label><label><input type="radio" name="direction" value="same" ' +
      (direction === "same" ? "checked" : "") +
      '>Flat</label><label><input type="radio" name="direction" value="up" ' +
      (direction === "up" ? "checked" : "") +
      '>Up</label></div><div class="la-change-options" data-la-change-options ' +
      (direction === "up" || direction === "down" ? "" : "hidden") +
      "><span>By</span>" +
      fixed
        .map(
          (x) =>
            '<label><input type="radio" name="change_percent" value="' +
            x +
            '" ' +
            (absolute === x ? "checked" : "") +
            "><i>" +
            x +
            "%</i></label>",
        )
        .join("") +
      '<label><input type="radio" name="change_percent" value="custom" ' +
      (custom ? "checked" : "") +
      '><i>Custom</i></label><label class="la-custom" ' +
      (custom ? "" : "hidden") +
      '><input name="custom_percent" type="number" min="0.1" max="90" step="0.1" value="' +
      (custom ? absolute : "") +
      '" aria-label="Custom sales change percentage"><span>%</span></label></div></fieldset></div><div class="la-projection"><span>Next week’s sales projection</span><strong data-la-projection>' +
      money(salesKnown ? decision.forecast.sales : null) +
      '</strong><small data-la-impact>' +
      E(impactText(row, decision, salesKnown ? decision.forecast.sales : null)) +
      '</small></div></section><section class="la-budget-builder"><div class="la-field"><label>Weekly hour budget <span>Operator decision</span><div><input name="hours" type="number" min="1" max="1000" step="0.5" value="' +
      E(decision.decision.hours) +
      '" ' +
      (isConfirmed ? "disabled" : "") +
      "><span>hours</span></div><small>Store framework recommends " +
      number(decision.model.recommended_hours) +
      " hours · " +
      E(method) +
      "</small></label></div>" +
      (eventCap
        ? '<div class="la-field"><label>Approved event flex <span>Optional</span><div><input name="event_hours" type="number" min="0" max="' +
          eventCap +
          '" step="0.5" value="' +
          E(decision.model.inputs?.event_hours || 0) +
          '" ' +
          (isConfirmed ? "disabled" : "") +
          "><span>hours</span></div><small>Up to " +
          number(eventCap) +
          " extra hours for a qualified offsite or event.</small></label></div>"
        : "") +
      (financials.estimated_labor_cost != null
        ? '<div class="la-budget-result"><div><span>Estimated weekly labor</span><strong>' +
          money(financials.estimated_labor_cost) +
          "</strong></div><div><span>Labor % of projected sales</span><strong data-la-labor-percent>" +
          percent(salesKnown ? financials.estimated_labor_percent : null) +
          "</strong></div><div><span>Hours supported at " +
          percent(financials.labor_goal_percent) +
          " goal</span><strong>" +
          number(financials.goal_hours_supported) +
          " h</strong></div><small>" +
          E(
            financials.basis === "imported_schedule"
              ? "Based on the imported schedule"
              : "Based on the proposed hour budget",
          ) +
          (financials.goal_below_coverage_floor
            ? " · Goal math falls below the " +
              number(financials.coverage_floor_hours) +
              " h coverage floor; the store framework protects coverage."
            : "") +
          (financials.provisional
            ? " · provisional measured employer cost"
            : "") +
          "</small></div>"
        : '<div class="la-budget-result missing"><strong>Labor cost pending</strong><small>Connect or confirm measured payroll cost to calculate labor dollars, percentage and goal-supported hours.</small></div>') +
      "</section>" +
      (decision.model.review_required
        ? '<div class="la-review"><b>Operator review needed</b><span>Projected sales are below this store’s documented review threshold. Confirm coverage before changing the target.</span></div>'
        : "") +
      (isConfirmed
        ? ""
        : '<div class="la-actions"><button type="submit" name="intent" value="preview" class="btn btn-ghost">Build budget</button>' +
          (row.pro
            ? '<button type="submit" name="intent" value="save" class="btn btn-primary">Save draft</button>'
            : '<button type="button" class="btn btn-primary" data-la-upgrade>Review access to save</button>') +
          "</div>") +
      '</form>' +
      (isConfirmed ? "" : '<div class="la-approval">' + approval + "</div>") +
      '<section class="la-envelope"><header><div><h2>Manager schedule outline</h2><p>Use this in When I Work, then confirm people, keyholders and coverage.</p></div><span>' +
      number(decision.decision.hours) +
      " weekly hours</span></header><ol>" +
      decision.envelope
        .map(
          (d, i) =>
            '<li class="' +
            (d.day === decision.criteria.biggest_day ? "biggest" : "") +
            '"><div><b>' +
            E(d.day) +
            "</b><small>" +
            (d.open
              ? d.day === decision.criteria.biggest_day
                ? "Protect the biggest day"
                : number(d.share) + "% of weekly hours"
              : "Closed") +
            '</small></div><span class="la-bar"><i style="width:' +
            Math.max(0, (d.share / 30) * 100) +
            '%"></i></span><strong>' +
            number(d.hours) +
            " h</strong>" +
            (decision.schedule.days[i].scheduled_hours != null
              ? '<em class="' +
                decision.schedule.days[i].status +
                '">' +
                (decision.schedule.days[i].variance > 0 ? "+" : "") +
                number(decision.schedule.days[i].variance) +
                " scheduled</em>"
              : "<em>No When I Work schedule yet</em>") +
            "</li>",
        )
        .join("") +
      "</ol></section>" +
      '</main><aside><section class="la-decision"><span>Next week’s plan</span><strong>' +
      number(decision.decision.hours) +
      " hours</strong><p data-la-side-summary>" +
      (salesKnown ? money(decision.forecast.sales) + " projected sales" : "Projected sales pending last week’s closed total") +
      (salesKnown && financials.estimated_labor_cost != null
        ? " · " +
          money(financials.estimated_labor_cost) +
          " labor · " +
          percent(financials.estimated_labor_percent)
        : "") +
      "</p>" +
      (decision.schedule.scheduled_hours != null
        ? '<div class="la-variance ' +
          (variance > 0 ? "over" : variance < 0 ? "under" : "") +
          '"><b>' +
          (variance > 0 ? "+" : "") +
          number(variance) +
          " hours</b><span>current schedule vs budget</span></div>"
        : (assignments(row).length
            ? '<div class="la-variance"><b>' + number(assignments(row).reduce((sum, item) => sum + assignmentHours(item), 0)) + " / " + number(decision.decision.hours) + ' h in the FranWallet draft</b><span>FranWallet compares the live When I Work week once the manager saves it.</span></div>'
            : '<div class="la-variance"><b>No schedule for this week yet</b><span>Build it below from last week’s When I Work schedule.</span></div>')) +
      "</section><details open><summary>Why this is the target</summary><p>" +
      (row.config.planning_mode === "store_framework"
        ? "FranWallet applies this store’s documented operating framework. Your sales outlook adds context and a downside warning; it does not inflate hours automatically."
        : decision.model.method === "economic_capacity"
          ? "Measured employer cost and fixed leadership costs determine affordable crew hours."
          : "The owner-approved sales-to-hours baseline is used until a store framework is confirmed.") +
      "</p><dl><div><dt>Framework source</dt><dd>" +
      E(row.config.baseline_source) +
      "</dd></div><div><dt>Target hours</dt><dd>" +
      number(row.config.baseline_hours) +
      " h</dd></div><div><dt>Coverage floor</dt><dd>" +
      number(row.config.minimum_hours) +
      " h</dd></div><div><dt>Updated</dt><dd>" +
      date(row.config.baseline_as_of) +
      "</dd></div>" +
      (row.config.review_below_sales != null
        ? "<div><dt>Review below</dt><dd>" +
          money(row.config.review_below_sales) +
          "</dd></div>"
        : "") +
      (row.config.blended_hourly_cost != null
        ? "<div><dt>Measured employer cost</dt><dd>" +
          money2(row.config.blended_hourly_cost) +
          "/h</dd></div><div><dt>Fixed weekly leadership</dt><dd>" +
          money(row.config.weekly_salaried_cost || 0) +
          "</dd></div>"
        : "") +
      "</dl></details>" +
      (decision.readiness.missing.length
        ? "<details><summary>Inputs to confirm</summary><ul>" +
          decision.readiness.missing
            .map((x) => "<li>" + E(x) + "</li>")
            .join("") +
          "</ul></details>"
        : "") +
      "</aside></div>" +
      renderScheduleBuilder(row, decision, isConfirmed) +
      '<section class="la-criteria" id="la-handoff"><span class="la-kicker">Last step</span><h2>Hand off to the manager</h2><p>Store rules that travel with the brief:</p><ul>' +
      decision.criteria.notes
        .map((note) => "<li>" + E(note) + "</li>")
        .join("") +
      '</ul><div class="la-handoff"><button class="btn btn-primary" data-la-copy>Copy manager brief</button><a class="btn btn-ghost" href="https://app.wheniwork.com/" target="_blank" rel="noopener noreferrer">Open When I Work ↗</a></div><p class="la-handoff-note">'+(isConfirmed?'<b>Ready for manager review.</b> ':'')+'The brief includes the week, projected sales, hours, daily targets and open coverage. FranWallet does not publish to When I Work; publishing is a separate approval.</p><details class="la-brief-preview" open><summary>What the manager receives</summary><pre>'+E(managerBrief(row))+'</pre></details></section>'
    );
  }
  // Re-rendering replaces the DOM; keep keyboard focus on the equivalent control.
  function focusKey(el) {
    if (!el || !page.contains(el) || el === page) return null;
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
  let preserveForm = true,
    quietProjection = false;
  function render() {
    const key = pendingFocus || focusKey(document.activeElement),
      formState = preserveForm ? captureForm() : null;
    preserveForm = true;
    pendingFocus = null;
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
      (detail ? renderDetail() : renderPortfolio());
    bind();
    restoreForm(formState);
    if (detail) completedBefore = completeDays(detail);
    freshIds = new Set();
    showToast();
    scrollTimeline();
    if (key) page.querySelector(key)?.focus({ preventScroll: true });
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
      currentRecommendation = Number(
        (detail.run?.plan || detail.preview).model.recommended_hours,
      ),
      hoursChanged = Math.abs(enteredHours - currentRecommendation) > 0.01;
    return {
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
    assignments(row);
    completedBefore = completeDays(row);
    if (!row.roster) {
      row.roster_loading = true;
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
    // The operator may have moved on while the roster loaded.
    if (detail === row) render();
  }
  async function saveDraft(form, note) {
    const input = values(form),
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
    };
    detail.assignments = data.run.data.assignments || [];
    detail.preview = data.run.data.plan;
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
  function bind() {
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
          (button.onclick = () => openLocation(button.dataset.laWallet)),
      );
    page
      .querySelector("[data-la-next]")
      ?.addEventListener("click", (event) =>
        openLocation(event.currentTarget.dataset.laNext),
      );
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
        if (laborPercent && cost != null && projected)
          laborPercent.textContent = percent(Math.round((cost / projected) * 1000) / 10);
        if (impact) impact.textContent = impactText(detail, decision, projected);
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
          "[name=last_week_sales],[name=direction],[name=change_percent],[name=custom_percent]",
        )
        .forEach((input) => input.addEventListener("input", updateProjection));
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
        render();
      }),
    );
    page
      .querySelector("[data-la-previous-day]")
      ?.addEventListener("click", () => {
        activeDay = Math.max(0, activeDay - 1);
        render();
      });
    page.querySelector("[data-la-next-day]")?.addEventListener("click", () => {
      activeDay = Math.min(6, activeDay + 1);
      render();
    });
    const applyStartingPoint=(source,label)=>{
      detail.assignments=templateAssignments(source);
      freshIds=new Set(detail.assignments.filter(item=>item.day===activeDay).map(item=>item.id));
      message=label+" loaded. Adjust only what changed, then save the draft.";
      render();
    };
    const addPersonAt=(name,hour)=>{
      if(!name){message=errorMessage="Choose a team member first, then click a starting hour.";render();return;}
      const person=(detail.roster?.people||[]).find(entry=>entry.name===name),start=clock(Number(hour)*60),end=clock(Number(hour)*60+4*60);
      const id=crypto.randomUUID?crypto.randomUUID():"assignment-"+Date.now();
      assignments(detail).push({id,day:activeDay,employee:name,employee_id:person?.id||null,start,end,break_hours:0,hours:4,position:person?.role||null,tag:(person?.tags||[])[0]||null,note:null});
      freshIds=new Set([id]);
      render();
    };
    page.querySelector("[data-la-fill]")?.addEventListener("click",event=>{
      const button=event.currentTarget,name=button.dataset.laFill,person=(detail.roster?.people||[]).find(entry=>entry.name===name),id=crypto.randomUUID?crypto.randomUUID():"assignment-"+Date.now(),item={id,day:activeDay,employee:name,employee_id:person?.id||null,start:button.dataset.laFillStart,end:button.dataset.laFillEnd,break_hours:0,position:person?.role||null,tag:(person?.tags||[])[0]||null,note:"Suggested from imported roster tags"};
      item.hours=assignmentHours(item);
      assignments(detail).push(item);
      freshIds=new Set([id]);
      const day=(detail.run?.plan||detail.preview).envelope[activeDay].day;
      message=name+" added "+timeLabel(item.start)+"–"+timeLabel(item.end)+". "+day+" is covered.";
      pendingFocus="[data-la-next-day]";
      render();
    });
    page.querySelector("[data-la-use-imported]")?.addEventListener("click",()=>applyStartingPoint(detail.roster.imported_template.assignments,"Latest When I Work week"));
    page.querySelector("[data-la-use-previous]")?.addEventListener("click",()=>applyStartingPoint(detail.roster.previous_schedule.assignments,"Last FranWallet plan"));
    page.querySelector("[data-la-use-template]")?.addEventListener("click",()=>{const id=page.querySelector("[data-la-template-choice]")?.value,template=(detail.roster?.templates||[]).find(item=>item.id===id);if(template)applyStartingPoint(template.assignments,template.name);});
    page.querySelector("[data-la-roster-search]")?.addEventListener("input",event=>{rosterSearch=event.target.value;const term=rosterSearch.toLowerCase();page.querySelectorAll("[data-la-person]").forEach(card=>card.hidden=!!term&&!card.innerText.toLowerCase().includes(term));});
    page.querySelectorAll("[data-la-person]").forEach(button=>{
      button.addEventListener("click",()=>{
        selectedEmployee=button.dataset.laPerson;
        const person=(detail.roster?.people||[]).find(entry=>entry.name===selectedEmployee),hour=person?.common_start?Math.floor(timeMinutes(person.common_start)/60):null;
        message=selectedEmployee+" selected. Choose a starting hour"+(hour!=null?"; "+timeLabel(person.common_start)+" is their usual start.":".");
        if(hour!=null)pendingFocus='[data-la-hour="'+hour+'"]';
        render();
      });
      button.addEventListener("dragstart",event=>event.dataTransfer.setData("text/plain",button.dataset.laPerson));
    });
    page.querySelectorAll("[data-la-hour]").forEach(button=>{
      button.addEventListener("dragover",event=>event.preventDefault());
      button.addEventListener("drop",event=>{event.preventDefault();addPersonAt(event.dataTransfer.getData("text/plain"),button.dataset.laHour);});
      button.addEventListener("click",()=>addPersonAt(selectedEmployee,button.dataset.laHour));
    });
    page.querySelector("[data-la-copy-day]")?.addEventListener("click",()=>{
      const source=assignments(detail).filter(item=>item.day===activeDay),targets=(detail.run?.plan||detail.preview).envelope.filter((entry,index)=>entry.open&&index>activeDay&&!assignments(detail).some(item=>item.day===index)).map(entry=>entry.index);
      for(const dayIndex of targets)for(const item of source)assignments(detail).push({...item,id:crypto.randomUUID?crypto.randomUUID():"assignment-"+Date.now()+dayIndex,day:dayIndex});
      message=targets.length?"Copied "+(detail.run?.plan||detail.preview).envelope[activeDay].day+" to "+targets.length+" empty "+(targets.length===1?"day.":"days."):"Every later open day already has shifts.";render();
    });
    page.querySelector("[data-la-clear-day]")?.addEventListener("click",()=>{detail.assignments=assignments(detail).filter(item=>item.day!==activeDay);render();});
    page.querySelectorAll("[data-la-assignment]").forEach((row) => {
      const item = assignments(detail).find(
        (entry) => entry.id === row.dataset.laAssignment,
      );
      row.querySelector("[data-la-assignment-start]")?.addEventListener("change",event=>{item.start=event.target.value;if(timeMinutes(item.end)<=timeMinutes(item.start))item.end=clock(timeMinutes(item.start)+4*60);item.hours=assignmentHours(item);render();});
      row.querySelector("[data-la-assignment-end]")?.addEventListener("change",event=>{if(timeMinutes(event.target.value)<=timeMinutes(item.start)){message=errorMessage="End time must be after the start time.";render();return;}item.end=event.target.value;item.hours=assignmentHours(item);render();});
      row.querySelector("[data-la-assignment-break]")?.addEventListener("change",event=>{item.break_hours=Number(event.target.value||0);item.hours=assignmentHours(item);render();});
      row
        .querySelector("[data-la-remove-assignment]")
        ?.addEventListener("click", () => {
          detail.assignments = assignments(detail).filter(
            (entry) => entry.id !== item.id,
          );
          render();
        });
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
    const check = page.querySelector("#la-confirm-check"),
      confirm = page.querySelector("[data-la-confirm]");
    if (check && confirm) {
      check.onchange = () => (confirm.disabled = !check.checked);
      confirm.onclick = () =>
        work(async () => {
          const data = await api("confirm", {
            wallet_id: detail.wallet.id,
            run_id: detail.run.id,
            revision: detail.run.revision,
            confirm: true,
          });
          detail.run = {
            id: data.run.id,
            revision: data.run.revision,
            status: data.run.status,
            confirmed_at: data.run.confirmed_at,
            confirmed_by: data.run.confirmed_by,
            plan: data.run.data.plan,
            assignments: data.run.data.assignments || [],
          };
          detail.assignments = data.run.data.assignments || [];
          const current = locations.find(
            (r) => r.wallet.id === detail.wallet.id,
          );
          Object.assign(current, detail);
          message = detail.wallet.name + " is ready for When I Work.";
        });
    }
  }
  async function open() {
    returnRoute = "payroll";
    detail = null;
    locations = [];
    message = "Loading next week’s labor plan…";
    switchTab("labor-agent");
    render();
    await work(load);
  }
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-la-open]")) open();
  });
  const heading = document.querySelector("#page-payroll .main-hdr");
  if (heading && !heading.querySelector("[data-la-open]")) {
    const button = document.createElement("button");
    button.className = "btn btn-primary";
    button.dataset.laOpen = "";
    button.textContent = "Plan next week";
    heading.append(button);
  }
  window.addEventListener("fran:location", () => {
    // The demo has no signed-in wallet; shell location changes do not apply to it.
    if (demo) return;
    sequence++;
    detail = null;
    locations = [];
    page.innerHTML = "";
    toast.classList.remove("show", "error");
  });
  window.FranLaborAgent = { open };
  const params = new URLSearchParams(location.search),
    requestedWeek = params.get("week");
  if (params.get("labor") === "1") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(requestedWeek || "")) week = requestedWeek;
    setTimeout(open, 0);
  }
})();
