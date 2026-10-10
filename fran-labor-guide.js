/* Labor planner guide. Two pieces, both built on the real product:
   1. "What to expect": time, what you need, what you leave with, what a finished week looks like.
   2. The guided walkthrough: runs on the store's actual page. It spotlights each step, counts the real numbers
      in, tags each one with the system it came from, waits for the operator to try the one decision, and can
      load last week's schedule on request. Plays like a video (auto-advance, pause, back) or step by step.
   Stops and their copy come from the planner, so every sentence uses this store's numbers.
   Remembers only per-browser conveniences (what-to-expect seen, walkthrough finished) in localStorage. */
(function (root) {
  "use strict";
  const KEY = "franwallet.laborGuide.v1";
  const E = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const reduced = () => !!root.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const read = () => { try { return JSON.parse(root.localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
  const write = (patch) => { try { root.localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch })); } catch {} };

  /* ---------- What to expect ---------- */
  let sheet = null;
  function intro(ctx = {}) {
    write({ introSeen: true });
    sheet?.remove();
    sheet = document.createElement("dialog");
    sheet.className = "lg-dialog";
    sheet.setAttribute("aria-labelledby", "lg-title");
    sheet.innerHTML = '<div class="lg-shell"><header><div><span class="lg-kicker">Weekly labor plan</span><h2 id="lg-title" tabindex="-1">What to expect</h2><p class="lg-lede">Each week you plan every store’s hours from numbers that are already loaded. You make one call per store, FranWallet does the math, and the manager gets a brief.</p></div><button type="button" class="lg-x" data-lg-close aria-label="Close">×</button></header>' +
      '<div class="lg-expect"><div><small>Time</small><b>About 10 minutes</b><span>for your first store, about 5 after that.</span></div><div><small>When</small><b>Sunday evening</b><span>or Monday after payroll posts at 5 pm MT.</span></div><div><small>You’ll need</small><b>Your read on next week</b><span>Events, promos, weather or staffing changes. Everything else is loaded.</span></div></div>' +
      '<ol class="lg-flow" aria-label="The four steps"><li><b>Sales outlook</b><span>Start from last week’s closed Crumbl sales. Choose up, flat or down.</span></li><li><b>Hours</b><span>FranWallet recommends hours from your labor target, never below the 110 h floor.</span></li><li><b>Schedule</b><span>Start from last week’s When I Work schedule, trimmed to budget. Optional.</span></li><li><b>Approve and hand off</b><span>Approve, save, send the manager brief, move to the next store.</span></li></ol>' +
      '<h3>A finished week looks like this</h3><ul class="lg-success"><li>Every store has an approved budget at or under 25% labor, or at the 110-hour floor.</li><li>Each schedule draft fits the budget and every open day is covered.</li><li>Managers have their brief and publish in When I Work by Monday night.</li><li>Next Sunday, plan versus actual shows how close each store landed.</li></ul>' +
      '<div class="lg-final-actions">' + (ctx.onStart ? '<button type="button" class="btn btn-primary" data-lg-start><span aria-hidden="true">▶</span> ' + E(ctx.startLabel || "Walk me through it") + "</button>" : "") + '<button type="button" class="btn btn-ghost" data-lg-close>' + (ctx.onStart ? "I’ll explore on my own" : "Close") + "</button><small>" + (ctx.onStart ? "About 2 minutes, on your real store, with your real numbers." : "") + "</small></div></div>";
    document.body.append(sheet);
    const close = () => { sheet?.close(); sheet?.remove(); sheet = null; };
    sheet.addEventListener("click", (e) => {
      if (e.target === sheet || e.target.closest("[data-lg-close]")) return close();
      if (e.target.closest("[data-lg-start]")) { close(); ctx.onStart?.(); }
    });
    sheet.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    sheet.showModal();
    sheet.querySelector("h2").focus();
  }

  /* ---------- Counting the real numbers in ---------- */
  // Animates the first number in an element's first numeric text node from zero, then restores the exact original text.
  function countIn(el) {
    if (!el || reduced()) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (/\d/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    const node = walker.nextNode(); if (!node) return;
    const original = node.nodeValue, m = original.match(/-?[\d,]*\.?\d+/); if (!m) return;
    const target = Number(m[0].replace(/,/g, "")), decimals = (m[0].split(".")[1] || "").length, comma = m[0].includes(",");
    const fmt = (v) => (comma ? v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : v.toFixed(decimals));
    const t0 = performance.now(), ms = 1100;
    el.classList.add("lg-counting");
    const step = (t) => {
      if (!node.isConnected) return;
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      node.nodeValue = k < 1 ? original.slice(0, m.index) + fmt(target * e) + original.slice(m.index + m[0].length) : original;
      if (k < 1) requestAnimationFrame(step); else el.classList.remove("lg-counting");
    };
    requestAnimationFrame(step);
  }

  /* ---------- Guided walkthrough on the real page ---------- */
  const DWELL = 8000;
  let active = null;
  function stop(done) {
    const st = active; if (!st) return;
    clearTimeout(st.timer); st.cleanup.forEach((f) => f());
    st.spot.remove(); st.pop.remove(); st.tag.remove();
    active = null;
    if (done) write({ tourDone: true });
    st.returnFocus?.focus?.({ preventScroll: true });
  }
  function run(scope = document, stopsFn, opts = {}) {
    stop(false);
    const getStops = typeof stopsFn === "function" ? stopsFn : () => stopsFn || [];
    let stops = getStops().filter((s) => scope.querySelector(s.sel));
    if (!stops.length) return;
    const spot = document.createElement("div"), pop = document.createElement("div"), tag = document.createElement("div");
    spot.className = "lg-spot"; tag.className = "lg-tag"; tag.hidden = true;
    pop.className = "lg-pop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-modal", "false"); pop.setAttribute("aria-labelledby", "lg-pop-title");
    document.body.append(spot, tag, pop);
    const st = (active = { spot, pop, tag, i: 0, auto: opts.auto !== false && !reduced(), timer: null, cleanup: [], returnFocus: document.activeElement });
    const target = () => scope.querySelector(stops[st.i]?.sel);
    const place = () => {
      const el = target(); if (!el) return;
      const r = el.getBoundingClientRect(), pad = 8, vw = document.documentElement.clientWidth, vh = root.innerHeight;
      const top = Math.max(4, r.top - pad), height = Math.max(24, Math.min(r.height + pad * 2, vh - top - 4));
      Object.assign(spot.style, { top: top + "px", left: Math.max(4, r.left - pad) + "px", width: Math.min(vw - 8, r.width + pad * 2) + "px", height: height + "px" });
      if (!tag.hidden) { const tw = tag.offsetWidth; Object.assign(tag.style, { top: Math.max(6, top - 15) + "px", left: Math.min(vw - tw - 8, Math.max(8, r.right - tw - 6)) + "px" }); }
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let y = top + height + 14; if (y + ph > vh - 8) y = top - ph - 14; if (y < 8) y = Math.max(8, vh - ph - 8);
      const x = Math.min(Math.max(8, r.left), vw - pw - 8);
      Object.assign(pop.style, { top: y + "px", left: x + "px" });
    };
    const schedule = () => {
      clearTimeout(st.timer);
      const s = stops[st.i], bar = pop.querySelector(".lg-pop-progress i"), timed = st.auto && !s.waitFor && !s.action;
      if (bar) { bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = timed ? "lg-fill " + DWELL + "ms linear forwards" : "none"; bar.style.width = timed ? "" : "0"; }
      if (timed) st.timer = setTimeout(() => (st.i < stops.length - 1 ? show(st.i + 1) : stop(true)), DWELL);
    };
    const show = (i) => {
      stops = getStops().filter((s) => scope.querySelector(s.sel));
      st.i = Math.max(0, Math.min(stops.length - 1, i));
      const s = stops[st.i];
      if (s.open) { const d = document.getElementById(s.open); if (d && d.tagName === "DETAILS" && !d.open) { d.open = true; d.dispatchEvent(new Event("toggle")); } }
      target()?.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
      pop.innerHTML = '<div class="lg-pop-head"><span class="lg-pop-step">' + (st.i + 1) + " / " + stops.length + '</span><span class="lg-pop-progress" aria-hidden="true"><i></i></span><button type="button" class="lg-x-sm" data-lg-skip aria-label="End walkthrough">×</button></div><h3 id="lg-pop-title" tabindex="-1">' + E(s.title) + "</h3><p>" + E(s.body) + "</p>" +
        (s.math ? '<div class="lg-math" aria-label="' + E(s.math.join(" ")) + '">' + s.math.map((m, k) => '<span style="--k:' + k + '">' + E(m) + "</span>").join("") + "</div>" : "") +
        (s.waitFor ? '<p class="lg-try">Your turn. It continues when you choose.</p>' : "") +
        (s.action ? '<button type="button" class="btn btn-primary lg-action" data-lg-act>' + E(s.action.label) + "</button>" : "") +
        '<div class="lg-pop-actions"><button type="button" class="lg-icon" data-lg-prev aria-label="Previous step" ' + (st.i ? "" : "disabled") + '>←</button><button type="button" class="lg-icon" data-lg-play aria-pressed="' + st.auto + '" aria-label="' + (st.auto ? "Pause" : "Play") + '">' + (st.auto ? "❚❚" : "▶") + '</button><button type="button" class="btn btn-primary lg-next" data-lg-fwd>' + (st.i === stops.length - 1 ? "Done" : "Next →") + "</button></div>";
      if (s.tag) { tag.hidden = false; tag.innerHTML = '<i aria-hidden="true"></i>From <b>' + E(s.tag.label) + "</b>" + (s.tag.detail ? '<span>' + E(s.tag.detail) + "</span>" : ""); tag.classList.remove("lg-in"); void tag.offsetWidth; tag.classList.add("lg-in"); }
      else tag.hidden = true;
      spot.classList.remove("lg-pulse"); void spot.offsetWidth; spot.classList.add("lg-pulse");
      place();
      [120, 320, 600, 900].forEach((ms) => setTimeout(() => active === st && place(), ms));
      setTimeout(() => { if (active === st && stops[st.i] === s) (s.count || []).forEach((sel) => scope.querySelectorAll(sel).forEach(countIn)); }, reduced() ? 0 : 500);
      pop.querySelector("h3").focus({ preventScroll: true });
      schedule();
      if (s.waitFor) {
        const el = target(), once = () => { if (s.ready && !s.ready()) return; el?.removeEventListener(s.waitFor, once); if (active === st && stops[st.i] === s) setTimeout(() => show(st.i + 1), 900); };
        el?.addEventListener(s.waitFor, once);
        st.cleanup.push(() => el?.removeEventListener(s.waitFor, once));
      }
    };
    pop.addEventListener("click", (e) => {
      if (e.target.closest("[data-lg-skip]")) return stop(true);
      if (e.target.closest("[data-lg-prev]")) return show(st.i - 1);
      if (e.target.closest("[data-lg-fwd]")) return st.i === stops.length - 1 ? stop(true) : show(st.i + 1);
      if (e.target.closest("[data-lg-play]")) { st.auto = !st.auto; const b = e.target.closest("[data-lg-play]"); b.textContent = st.auto ? "❚❚" : "▶"; b.setAttribute("aria-label", st.auto ? "Pause" : "Play"); b.setAttribute("aria-pressed", String(st.auto)); return schedule(); }
      if (e.target.closest("[data-lg-act]")) { stops[st.i].action?.run(); setTimeout(() => active === st && show(st.i + 1), 800); }
    });
    // Hold the step while the operator reads or works inside the popover.
    pop.addEventListener("pointerenter", () => clearTimeout(st.timer));
    pop.addEventListener("pointerleave", () => schedule());
    const keys = (e) => { if (e.key === "Escape") { e.stopPropagation(); stop(true); } };
    document.addEventListener("keydown", keys, true);
    root.addEventListener("resize", place); root.addEventListener("scroll", place, true);
    st.cleanup.push(() => { document.removeEventListener("keydown", keys, true); root.removeEventListener("resize", place); root.removeEventListener("scroll", place, true); });
    show(0);
  }

  // What to expect opens once per browser, never inside automated browsers (tests drive the page directly).
  function shouldIntro() { return !read().introSeen && !root.navigator?.webdriver; }

  root.FranLaborGuide = { intro, run, tour: (scope, stops) => run(scope, stops, { auto: false }), stop, shouldIntro, state: read, markSeen: () => write({ introSeen: true }) };
})(typeof window !== "undefined" ? window : globalThis);
