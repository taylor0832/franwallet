/* FranWallet Routines: the recurring human work behind labor and payroll (portfolio and store level),
   a compact "Coming up" widget for home dashboards, and a read-only list of server automations.
   Data: the `routines` edge function. Demo: wallet.html?routines=demo (or FranRoutines.mount(el, w, {demo:true}))
   renders a session-only fixture and never calls the network.
   API: FranRoutines.mount(container, wallet) · FranRoutines.widget(container, wallet) · FranRoutines.refresh() */
(() => {
'use strict';
const TZ = 'America/Denver', DAY = 86400000;
const E = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CH = { email: 'Email', slack: 'Slack', sms: 'Text' };
const params = new URLSearchParams(location.search);
const demoWanted = () => window.FRAN_ROUTINES_DEMO === true || /^demo/.test(params.get('routines') || '') || typeof window.sb === 'undefined' && typeof sb === 'undefined';

// ---------- time (wall clock in TZ) ----------
const fmt = (ms, o) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...o }).format(new Date(ms));
const partsOf = (ms) => { const o = {}; for (const p of new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date(ms))) o[p.type] = p.value; return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, min: +o.minute, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) }; };
const zoned = (y, m, d, h, min) => { const g = Date.UTC(y, m - 1, d, h, min), off = (ms) => { const p = partsOf(ms); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ms / 60000) * 60000; }; return g - off(g - off(g)); };
const weekStart = (ms) => { const p = partsOf(ms), back = (p.dow + 6) % 7, t = new Date(Date.UTC(p.y, p.m - 1, p.d - back)); return zoned(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), 0, 0); };
const dayKey = (ms) => { const p = partsOf(ms); return p.y * 10000 + p.m * 100 + p.d; };
const timeLabel = (ms) => fmt(ms, { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
const dueLabel = (ms) => fmt(ms, { weekday: 'short' }) + ' ' + timeLabel(ms);
const rel = (ms, now) => { const d = Math.round((ms - now) / 60000); if (Math.abs(d) < 60) return d >= 0 ? 'in ' + d + ' min' : d * -1 + ' min ago'; const h = Math.round(d / 60); if (Math.abs(h) < 24) return h >= 0 ? 'in ' + h + ' h' : -h + ' h ago'; return fmt(ms, { month: 'short', day: 'numeric' }); };
const remindLabel = (m) => m === 0 ? 'Reminder at due time' : m < 60 ? 'Reminder ' + m + ' min before' : m < 1440 ? 'Reminder ' + Math.round(m / 60) + ' h before' : 'Reminder ' + Math.round(m / 1440) + ' day' + (m >= 2880 ? 's' : '') + ' before';
const initials = (n) => String(n || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const AVATAR = ['#1a6b5c', '#a94425', '#7c5cff', '#3b82f6', '#2f8a64', '#b7791f'];
const avatarColor = (n) => AVATAR[[...String(n || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];

// ---------- data ----------
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function nextOcc(c, after) { // demo-only mirror of the server cadence math
  const [h, mi] = c.time.split(':').map(Number), s = partsOf(after);
  if (c.freq === 'monthly') { let y = s.y, m = s.m; for (let i = 0; i < 14; i++) { let d = c.monthday; if (!d) { const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), t = DAYS.indexOf(c.day); d = 1 + ((t - first + 7) % 7) + (c.nth - 1) * 7; } const ms = zoned(y, m, d, h, mi); if (ms > after) return ms; if (++m > 12) { m = 1; y++; } } return null; }
  for (let i = 0; i < 9; i++) { const t = new Date(Date.UTC(s.y, s.m - 1, s.d + i)); if (c.freq === 'weekly' && !c.days.includes(DAYS[t.getUTCDay()])) continue; const ms = zoned(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), h, mi); if (ms > after) return ms; }
  return null;
}
function demoFixture(empty) {
  const now = Date.now(), ws = weekStart(now);
  const stores = [{ id: 'demo-bloomfield', name: 'Bloomfield Hills' }, { id: 'demo-waterford', name: 'Waterford' }, { id: 'demo-apple', name: 'Apple Valley' }];
  const people = { taylor: { name: 'Taylor', email: 'taylor@example.com' }, rachel: { name: 'Rachel', email: 'rachel@example.com' }, flor: { name: 'Flor', email: 'flor@example.com' }, megan: { name: 'Megan Ortiz', email: 'megan@example.com' }, natalia: { name: 'Natalia', email: 'natalia@example.com' } };
  const T = {
    pos_weekly_sales: ['Collect closed weekly sales', 'Pull last week’s closed point-of-sale sales for every store so next week’s labor plan starts from real numbers.', { freq: 'weekly', days: ['SU'], time: '09:00' }, 'Sundays at 9 AM MT', 60, 'Operations'],
    wiw_close_week: ['Close last week in When I Work', 'Approve timesheets and close the prior week before they lock at 5 PM MT, then export schedules and timesheets.', { freq: 'weekly', days: ['SU'], time: '17:00' }, 'Sundays at 5 PM MT', 180, 'Store manager'],
    labor_plan_next_week: ['Plan next week’s labor budget', 'Payroll → Plan next week: choose down, flat or up for each store, approve the hour budgets and send the manager brief.', { freq: 'weekly', days: ['SU'], time: '19:00' }, 'Sundays at 7 PM MT', 120, 'Owner'],
    wiw_publish_schedule: ['Publish next week’s schedule', 'Build the schedule inside the approved hour budget and publish it in When I Work.', { freq: 'weekly', days: ['MO'], time: '12:00' }, 'Mondays at 12 PM MT', 180, 'Store manager'],
    gusto_payroll: ['Process payroll in Gusto', 'After timesheets lock, review and submit payroll in Gusto, then import the payroll journal into FranWallet.', { freq: 'weekly', days: ['MO'], time: '19:00' }, 'Mondays at 7 PM MT', 120, 'Payroll processor'],
    books_close: ['Close the books in QuickBooks', 'Reconcile bank and card accounts, post payroll journals and close last month in QuickBooks.', { freq: 'monthly', monthday: 10, time: '17:00' }, 'Monthly on day 10 at 5 PM MT', 1440, 'Bookkeeper'],
    monthly_labor_review: ['Review last month’s labor vs budget', 'Compare planned, scheduled and paid hours for every store and decide what changes next month.', { freq: 'monthly', nth: 1, day: 'MO', time: '09:00' }, 'The first Monday of each month at 9 AM MT', 60, 'Owner'],
  };
  const make = (key, store, who, channels, watching) => {
    const [title, description, cadence, label, remind, role] = T[key], p = people[who];
    const runs = []; let t = ws - DAY;
    for (let i = 0; i < 40; i++) { const n = nextOcc(cadence, t); if (!n || n > now + 35 * DAY) break; t = n; const past = n < now; runs.push({ id: past ? 'run-' + key + n : null, due_at: new Date(n).toISOString(), status: past ? 'done' : 'pending', completed_by: past ? (p ? p.name : 'Taylor') : null, completed_at: past ? new Date(n - 40 * 60000).toISOString() : null, notified_at: past ? new Date(n - remind * 60000).toISOString() : null }); }
    return { id: 'demo-' + key + (store ? '-' + store.id : ''), wallet_id: store ? store.id : null, wallet_name: store ? store.name : null, scope: store ? 'store' : 'portfolio', template_key: key, role, title, description, kind: 'human', cadence, cadence_label: label, timezone: TZ, assignee: { name: p ? p.name : null, email: p ? p.email : null, initials: initials(p ? p.name : role), assigned: !!p }, channels, channel_status: { email: 'ready', slack: 'ready', sms: 'not_configured' }, remind_before_minutes: remind, active: true, source: 'template', watching: !!watching, can_edit: true, runs };
  };
  const routines = empty ? [] : [
    make('pos_weekly_sales', null, 'rachel', ['email', 'slack'], true),
    make('wiw_close_week', stores[0], 'megan', ['email', 'sms']),
    make('wiw_close_week', stores[1], null, ['email']),
    make('labor_plan_next_week', null, 'taylor', ['email', 'slack'], true),
    make('wiw_publish_schedule', stores[0], 'megan', ['email', 'sms']),
    make('gusto_payroll', null, 'flor', ['email', 'slack']),
    make('books_close', null, 'natalia', ['email']),
  ];
  const step = (k) => ({ key: k, title: T[k][0], cadence_label: T[k][3], role: T[k][5] });
  const ago = (min) => new Date(now - min * 60000).toISOString();
  return {
    demo: true, now: new Date(now).toISOString(), timezone: TZ,
    scope: { kind: 'portfolio', role: 'owner', stores: 3 }, stores, routines,
    bundles: [
      { key: 'weekly_labor', title: 'The weekly labor routine', summary: 'Sales in, timesheets closed, next week planned, schedules published, payroll run.', cta: 'Add the weekly labor routine', steps: ['pos_weekly_sales', 'wiw_close_week', 'labor_plan_next_week', 'wiw_publish_schedule', 'gusto_payroll'].map(step), added: !empty, available: true },
      { key: 'monthly_close', title: 'Monthly close', summary: 'Books closed by the 10th; first-Monday review of labor against budget.', cta: 'Add monthly close', steps: ['books_close', 'monthly_labor_review'].map(step), added: false, available: true },
    ],
    team: Object.values(people).map((p, i) => ({ ...p, owner: i === 0 })),
    channels: { email: 'ready', slack: 'ready', sms: 'not_configured', reminders: 'enabled' },
    automations: { items: [
      { key: 'fran-document-ingestion', title: 'Document intake', description: 'Reads newly added documents and files them to the right store.', schedule_label: 'Every minute', last_status: 'ok', last_run_at: ago(1) },
      { key: 'fran-support-outbox-dispatch', title: 'Support routing to Slack', description: 'Posts new support requests to the CoverPanda team in Slack.', schedule_label: 'Every minute', last_status: 'ok', last_run_at: ago(1) },
      { key: 'fran-accounting-source-collection', title: 'Accounting source collection', description: 'Checks connected accounting sources and collects new records.', schedule_label: 'Every 5 minutes', last_status: 'ok', last_run_at: ago(3) },
      { key: 'fran-service-notifications', title: 'Service notifications', description: 'Emails updates on service requests.', schedule_label: 'Every 5 minutes', last_status: 'ok', last_run_at: ago(3) },
      { key: 'fran-bill-spend-sync', title: 'BILL spend sync', description: 'Pulls card and spend activity from BILL.', schedule_label: 'Every 15 minutes', last_status: 'failed', last_run_at: ago(9) },
      { key: 'fran-setup-reminders', title: 'Setup reminders', description: 'Nudges new wallets to finish setup.', schedule_label: 'Every 15 minutes', last_status: 'ok', last_run_at: ago(9) },
      { key: 'fran-monthly-debt-review', title: 'Debt review', description: 'Prepares the monthly debt schedule review when it is due.', schedule_label: 'Hourly at :17', last_status: 'ok', last_run_at: ago(52) },
      { key: 'fran-sunday-labor-plans', title: 'Sunday labor plan email', description: 'Tells the owner how many stores are ready to plan next week.', schedule_label: 'Sundays at 10 AM MT', last_status: 'ok', last_run_at: new Date(weekStart(now) - DAY + 16 * 3600000 - 6 * 3600000).toISOString() },
    ] },
  };
}

const cache = new Map(), views = new Set();
let demoState = null;
const keyOf = (w) => (w && typeof w === 'object' ? w.id : w) && (w && typeof w === 'object' ? w.id : w) !== 'all' ? String(w && typeof w === 'object' ? w.id : w) : 'portfolio';
async function api(input) {
  const client = window.sb || (typeof sb !== 'undefined' ? sb : null), url = window.SUPABASE_URL || (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : ''), anon = window.SUPABASE_ANON_KEY || (typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '');
  const { data: { session } } = await client.auth.getSession(); if (!session) throw Error('Sign in again to continue.');
  const res = await fetch(url + '/functions/v1/routines', { method: 'POST', headers: { apikey: anon, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(30000) });
  const data = await res.json().catch(() => ({})); if (!res.ok) throw Error(data.error || 'Routines are unavailable right now.'); return data;
}
function load(key, demo, force) {
  if (demo) { if (!demoState || force === 'reset') demoState = demoFixture(/empty/.test(params.get('routines') || '') || window.FRAN_ROUTINES_DEMO_EMPTY === true); const s = key === 'portfolio' ? demoState : { ...demoState, scope: { kind: 'store', wallet_id: key, name: (demoState.stores.find((x) => x.id === key) || {}).name || 'Store', role: 'owner' }, routines: demoState.routines.filter((r) => r.wallet_id === key || r.wallet_id == null) }; return Promise.resolve(s); }
  if (!force && cache.has(key) && Date.now() - cache.get(key).at < 60000) return cache.get(key).p;
  const p = api({ action: 'list', wallet_id: key === 'portfolio' ? null : key }); cache.set(key, { at: Date.now(), p }); p.catch(() => cache.delete(key)); return p;
}
async function mutate(view, input) {
  if (view.demo) {
    const r = demoState.routines.find((x) => x.id === input.routine_id);
    if (input.action === 'remind' && r) r.watching = input.enabled;
    if (['complete', 'skip', 'reopen'].includes(input.action) && r) { const run = r.runs.find((x) => x.due_at === input.due_at); if (run) Object.assign(run, input.action === 'reopen' ? { status: 'pending', completed_by: null, completed_at: null } : { status: input.action === 'complete' ? 'done' : 'skipped', completed_by: 'You', completed_at: new Date().toISOString() }); }
    if (input.action === 'add_template') { const fresh = demoFixture(false); demoState.routines = fresh.routines; demoState.bundles.forEach((b) => { if (b.key === input.bundle || b.key === 'weekly_labor') b.added = true; }); }
    if (input.action === 'upsert') { const ri = input.routine, store = demoState.stores.find((s) => s.id === ri.wallet_id); const runs = []; let t = Date.now() - DAY; for (let i = 0; i < 12; i++) { const n = nextOcc(ri.cadence, t); if (!n || n > Date.now() + 35 * DAY) break; t = n; runs.push({ id: null, due_at: new Date(n).toISOString(), status: 'pending' }); } demoState.routines.push({ id: 'demo-custom-' + Date.now(), wallet_id: ri.wallet_id || null, wallet_name: store ? store.name : null, scope: store ? 'store' : 'portfolio', title: ri.title, description: ri.description || '', cadence: ri.cadence, cadence_label: 'Custom', timezone: TZ, assignee: { name: ri.assignee_email ? ri.assignee_email.replace(/@.*/, '') : null, email: ri.assignee_email, initials: initials(ri.assignee_email || 'You'), assigned: !!ri.assignee_email }, channels: ri.channels, channel_status: { email: 'ready', slack: 'ready', sms: 'not_configured' }, remind_before_minutes: ri.remind_before_minutes, active: true, source: 'custom', watching: false, can_edit: true, runs }); }
    rerenderAll(true); return {};
  }
  const out = await api(input); cache.clear(); rerenderAll(false); return out;
}
function rerenderAll(demo) { for (const v of views) if (v.host.isConnected && v.demo === demo) v.refresh(); else if (!v.host.isConnected) views.delete(v); }

// ---------- model ----------
function occurrences(data) {
  const now = Date.parse(data.now) || Date.now(), list = [];
  for (const r of data.routines) for (const run of r.runs || []) list.push({ r, run, due: Date.parse(run.due_at) });
  list.sort((a, b) => a.due - b.due);
  return { now, list };
}
function state(o, now) {
  const s = o.run.status;
  if (s === 'done') return { key: 'done', label: 'Done', tone: 'good' };
  if (s === 'skipped') return { key: 'skipped', label: 'Skipped', tone: 'muted' };
  if (o.due < now) return { key: 'overdue', label: 'Overdue', tone: 'warn' };
  if (dayKey(o.due) === dayKey(now)) return { key: 'today', label: 'Due today', tone: 'cost' };
  if (o.due - now < DAY) return { key: 'soon', label: 'Due tomorrow', tone: 'cost' };
  return { key: 'upcoming', label: 'Upcoming', tone: 'hours' };
}

// ---------- render pieces ----------
const avatar = (r) => { const name = r.assignee.name || r.role || 'You'; return '<span class="frt-avatar" style="--av:' + avatarColor(name) + '" aria-hidden="true">' + E(r.assignee.initials || initials(name)) + '</span>'; };
const ownerText = (r) => r.assignee.assigned ? E(r.assignee.name || r.assignee.email) : '<span class="frt-unassigned">' + E(r.role || 'Unassigned') + '</span>';
function chips(r) {
  return '<span class="frt-chips" aria-label="Reminder channels">' + ['email', 'slack', 'sms'].map((c) => {
    const on = r.channels.includes(c), st = r.channel_status?.[c] || 'not_configured', live = on && st === 'ready';
    const title = !on ? CH[c] + ' reminders are off' : st === 'ready' ? CH[c] + ' reminder ' + remindLabel(r.remind_before_minutes).toLowerCase().replace('reminder ', '') : st === 'no_phone' ? 'Add a phone number to send texts' : CH[c] + ' is not connected yet';
    return on ? '<span class="frt-chip ' + (live ? 'is-on' : 'is-pending') + '" title="' + E(title) + '">' + (live ? '✓ ' : '+ ') + CH[c] + '</span>' : '';
  }).filter(Boolean).join('<span class="frt-dot" aria-hidden="true">·</span>') + '</span>';
}
function row(o, now, opts = {}) {
  const r = o.r, st = state(o, now), done = st.key === 'done' || st.key === 'skipped';
  const by = done && o.run.completed_by ? ' by ' + E(o.run.completed_by) : '';
  const scope = r.wallet_name ? '<span class="frt-scope">' + E(r.wallet_name) + '</span>' : '<span class="frt-scope is-portfolio">All stores</span>';
  const id = E(r.id), due = E(o.run.due_at);
  return '<article class="frt-row tone-' + st.tone + (done ? ' is-done' : '') + '" data-routine="' + id + '" data-due="' + due + '">'
    + '<div class="frt-when"><span class="frt-dow">' + E(fmt(o.due, { weekday: 'short' })) + '</span><span class="frt-date">' + E(opts.compact ? fmt(o.due, { month: 'short', day: 'numeric' }) : timeLabel(o.due)) + '</span></div>'
    + '<div class="frt-main"><h3>' + E(r.title) + '</h3>' + (opts.compact ? '' : '<p class="frt-desc">' + E(r.description) + '</p>')
    + '<div class="frt-meta">' + scope + chips(r) + (opts.compact ? '<span class="frt-muted">' + E(timeLabel(o.due)) + ' MT</span>' : '<span class="frt-muted">' + E(remindLabel(r.remind_before_minutes)) + '</span>') + '</div></div>'
    + '<div class="frt-owner">' + avatar(r) + '<span>' + ownerText(r) + '</span></div>'
    + '<div class="frt-status"><span class="frt-pill tone-' + st.tone + '">' + (st.key === 'done' ? '✓ ' : '') + E(st.label) + by + '</span>' + (!done && st.key !== 'upcoming' ? '<span class="frt-rel">' + E(rel(o.due, now)) + '</span>' : '') + '</div>'
    + '<div class="frt-actions">' + (opts.compact ? '' : done ? '<button type="button" class="frt-btn frt-ghost" data-act="reopen">Undo</button>' : '<button type="button" class="frt-btn frt-done" data-act="complete">Mark done</button>')
    + '<label class="frt-switch"><input type="checkbox" data-act="remind"' + (r.watching ? ' checked' : '') + '><span class="frt-track" aria-hidden="true"></span><span>Remind me</span></label></div>'
    + '</article>';
}
function channelPills(c) {
  const p = (k, label, st) => '<span class="frt-conn ' + (st === 'ready' ? 'is-live' : '') + '">' + (st === 'ready' ? '✓ ' : '+ ') + label + '<small>' + (st === 'ready' ? 'Connected' : st === 'needs_channel' ? 'Choose a channel' : 'Not set up') + '</small></span>';
  return '<div class="frt-conns" aria-label="Reminder channels">' + p('email', 'Email', c.email) + p('slack', 'Slack', c.slack) + p('sms', 'Text', c.sms) + (c.reminders !== 'enabled' ? '<span class="frt-paused">Reminders are paused while we finish setup. Routines and due dates still work.</span>' : '') + '</div>';
}
function hero(data, now, week, weekly) {
  const left = week.filter((o) => o.run.status === 'pending'), done = week.filter((o) => o.run.status !== 'pending').length;
  const overdue = left.filter((o) => o.due < now).length, soon = left.filter((o) => o.due >= now && o.due - now < DAY).length;
  const next = left.find((o) => o.due >= now) || left[0];
  const ws = weekStart(now), title = data.scope.kind === 'store' ? data.scope.name : 'All stores';
  const primary = weekly && !weekly.added && weekly.available ? '<button type="button" class="frt-primary" data-bundle="' + E(weekly.key) + '">' + E(weekly.cta) + '</button>' : data.scope.role === 'owner' ? '<button type="button" class="frt-primary" data-act="new">Add a routine</button>' : '';
  if (!data.routines.length) return '<header class="frt-hero"><div class="frt-hero-copy"><p class="frt-eyebrow">Routines · ' + E(title) + '</p><h1 class="frt-h1">Put the Sunday-to-Monday payroll rhythm on rails.</h1><p class="frt-lede">Five steps keep labor and payroll on time: sales in, timesheets closed, next week planned, schedules published, payroll run. Add them once and FranWallet reminds the right person before each one is due.</p></div>' + primary + '</header>';
  return '<header class="frt-hero"><div class="frt-hero-copy"><p class="frt-eyebrow">Routines · ' + E(title) + ' · Week of ' + E(fmt(ws, { month: 'short', day: 'numeric' })) + '–' + E(fmt(ws + 6 * DAY, { month: 'short', day: 'numeric' })) + '</p>'
    + '<h1 class="frt-h1"><span class="frt-big">' + left.length + '</span> ' + (left.length === 1 ? 'routine' : 'routines') + ' left this week</h1>'
    + (next ? '<p class="frt-lede">Next up: <b>' + E(next.r.title) + '</b>' + (next.r.wallet_name ? ' · ' + E(next.r.wallet_name) : '') + ' · ' + E(dueLabel(next.due)) + ' MT</p>' : '<p class="frt-lede">Everything for this week is done.</p>') + '</div>'
    + '<div class="frt-strip"><div><span class="frt-stat">' + done + '</span><span>Done</span></div><div><span class="frt-stat">' + soon + '</span><span>Due in 24 h</span></div><div><span class="frt-stat' + (overdue ? ' is-warn' : '') + '">' + overdue + '</span><span>Overdue</span></div></div>'
    + primary + '</header>';
}
function templates(data) {
  if (data.scope.role !== 'owner') return '';
  const cards = data.bundles.filter((b) => b.available).map((b) => '<article class="frt-tpl' + (b.added ? ' is-added' : '') + '"><h3>' + E(b.title) + '</h3><p>' + E(b.summary) + '</p><ol>' + b.steps.map((s) => '<li><b>' + E(s.title) + '</b><span>' + E(s.cadence_label) + ' · ' + E(s.role) + '</span></li>').join('') + '</ol>'
    + (b.added ? '<span class="frt-added">✓ Added</span>' : '<button type="button" class="frt-btn frt-tpl-btn" data-bundle="' + E(b.key) + '">' + E(b.cta) + '</button>') + '</article>').join('');
  return '<section class="frt-sec" aria-labelledby="frt-tpl-h"><div class="frt-sec-h"><h2 id="frt-tpl-h">Templates</h2><p>One click adds the routine with sensible times. Edit owners and channels after.</p></div><div class="frt-tpls">' + cards + '</div></section>';
}
function automationList(a) {
  if (!a || !a.items || !a.items.length) return '';
  const item = (x) => { const st = x.last_status === 'ok' ? '<span class="frt-pill tone-good">✓ Ran ' + E(x.last_run_at ? rel(Date.parse(x.last_run_at), Date.now()) : '') + '</span>' : x.last_status === 'failed' ? '<span class="frt-pill tone-warn">Failed ' + E(x.last_run_at ? rel(Date.parse(x.last_run_at), Date.now()) : '') + '</span>' : x.last_status === 'running' ? '<span class="frt-pill tone-hours">Running</span>' : '<span class="frt-pill tone-muted">Not run yet</span>';
    return '<li class="frt-auto"><div><b>' + E(x.title) + '</b><p>' + E(x.description) + '</p></div><span class="frt-auto-when">' + E(x.schedule_label) + '</span>' + st + '</li>'; };
  return '<section class="frt-sec" aria-labelledby="frt-auto-h"><div class="frt-sec-h"><h2 id="frt-auto-h">What runs automatically</h2><p>Read-only. These jobs run on FranWallet’s servers; a failure here is ours to fix.</p></div><ul class="frt-autos">' + a.items.map(item).join('') + '</ul></section>';
}
function form(data) {
  if (data.scope.role !== 'owner') return '';
  const stores = data.stores || [], storeSel = data.scope.kind === 'store' ? '<input type="hidden" name="wallet_id" value="' + E(data.scope.wallet_id) + '">' : '<label>Where<select name="wallet_id"><option value="">All stores</option>' + stores.map((s) => '<option value="' + E(s.id) + '">' + E(s.name) + '</option>').join('') + '</select></label>';
  const dayOpts = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].map((d, i) => '<option value="' + d + '">' + ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i] + '</option>').join('');
  return '<details class="frt-new" id="frt-new"><summary>Add a custom routine</summary><form class="frt-form" novalidate>'
    + '<label class="frt-wide">What needs to happen<input name="title" required maxlength="140" placeholder="Count the safe and log the deposit"></label>' + storeSel
    + '<label>Repeats<select name="freq"><option value="weekly">Weekly</option><option value="monthly_nth">Monthly, on a weekday</option><option value="monthly_day">Monthly, on a date</option></select></label>'
    + '<label data-for="weekly monthly_nth">Day<select name="day">' + dayOpts + '</select></label>'
    + '<label data-for="monthly_nth" hidden>Which<select name="nth"><option value="1">First</option><option value="2">Second</option><option value="3">Third</option><option value="4">Fourth</option><option value="-1">Last</option></select></label>'
    + '<label data-for="monthly_day" hidden>Date<input name="monthday" type="number" min="1" max="28" value="1"></label>'
    + '<label>Time (MT)<input name="time" type="time" value="09:00" required></label>'
    + '<label>Owner’s email<input name="assignee_email" type="email" placeholder="Leave blank to remind you" list="frt-team"></label><datalist id="frt-team">' + (data.team || []).map((t) => '<option value="' + E(t.email) + '">' + E(t.name) + '</option>').join('') + '</datalist>'
    + '<label>Remind<select name="remind"><option value="15">15 min before</option><option value="60" selected>1 hour before</option><option value="180">3 hours before</option><option value="1440">1 day before</option></select></label>'
    + '<fieldset class="frt-wide"><legend>Send reminders by</legend>' + ['email', 'slack', 'sms'].map((c) => '<label class="frt-check"><input type="checkbox" name="ch" value="' + c + '"' + (c === 'email' ? ' checked' : '') + '> ' + CH[c] + (data.channels[c] === 'ready' ? '' : ' <small>(not set up)</small>') + '</label>').join('') + '</fieldset>'
    + '<p class="frt-form-err" role="alert" hidden></p><div class="frt-wide frt-form-actions"><button type="submit" class="frt-btn frt-done">Save routine</button></div></form></details>';
}

// ---------- page ----------
function page(view, data) {
  const { now, list } = occurrences(data), ws = weekStart(now), we = ws + 7 * DAY;
  const week = list.filter((o) => (o.due >= ws && o.due < we) || (o.due < ws && o.run.status === 'pending'));
  const seen = new Set(), upcoming = list.filter((o) => o.due >= we && o.run.status === 'pending' && !seen.has(o.r.id) && seen.add(o.r.id));
  const weekly = data.bundles.find((b) => b.key === 'weekly_labor');
  let html = hero(data, now, week, weekly) + channelPills(data.channels);
  if (data.routines.length) {
    const groups = new Map(); for (const o of week) { const k = dayKey(o.due); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
    html += '<section class="frt-sec" aria-labelledby="frt-week-h"><div class="frt-sec-h"><h2 id="frt-week-h">This week</h2><p>Monday to Sunday, Mountain Time.</p></div>'
      + [...groups.values()].map((g) => '<div class="frt-day"><h4>' + E(fmt(g[0].due, { weekday: 'long', month: 'short', day: 'numeric' })) + (dayKey(g[0].due) === dayKey(now) ? ' <span class="frt-today">Today</span>' : '') + '</h4>' + g.map((o) => row(o, now)).join('') + '</div>').join('') + '</section>';
    html += '<section class="frt-sec" aria-labelledby="frt-up-h"><div class="frt-sec-h"><h2 id="frt-up-h">Upcoming</h2><p>The next time each routine is due after this week.</p></div>' + (upcoming.length ? '<div class="frt-compact">' + upcoming.map((o) => row(o, now, { compact: true })).join('') + '</div>' : '<p class="frt-empty">Nothing scheduled.</p>') + '</section>';
  }
  html += templates(data) + form(data) + automationList(data.automations);
  if (view.demo) html += '<p class="frt-demo-note">Sample routines for a three-store portfolio. Nothing is sent.</p>';
  return html;
}
function wire(view) {
  const host = view.host;
  host.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b || !host.contains(b)) return;
    const art = b.closest('[data-routine]');
    try {
      if (b.dataset.bundle) { b.disabled = true; b.textContent = 'Adding…'; await mutate(view, { action: 'add_template', bundle: b.dataset.bundle, wallet_id: view.key === 'portfolio' ? null : view.key }); return; }
      if (b.dataset.act === 'new') { const d = host.querySelector('#frt-new'); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); d.querySelector('input[name=title]')?.focus(); } return; }
      if (art && (b.dataset.act === 'complete' || b.dataset.act === 'reopen')) { b.disabled = true; await mutate(view, { action: b.dataset.act, routine_id: art.dataset.routine, due_at: art.dataset.due }); }
    } catch (err) { b.disabled = false; toast(host, err.message); }
  };
  host.onchange = async (e) => {
    const t = e.target;
    if (t.matches('input[data-act=remind]')) { const art = t.closest('[data-routine]'); try { await mutate(view, { action: 'remind', routine_id: art.dataset.routine, enabled: t.checked }); } catch (err) { t.checked = !t.checked; toast(host, err.message); } }
    if (t.matches('select[name=freq]')) host.querySelectorAll('.frt-form [data-for]').forEach((l) => { l.hidden = !l.dataset.for.split(' ').includes(t.value); });
  };
  const f = host.querySelector('.frt-form');
  if (f) f.onsubmit = async (e) => {
    e.preventDefault(); const v = new FormData(f), err = f.querySelector('.frt-form-err'), freq = v.get('freq');
    const cadence = freq === 'weekly' ? { freq: 'weekly', days: [v.get('day')], time: v.get('time') } : freq === 'monthly_nth' ? { freq: 'monthly', nth: Number(v.get('nth')), day: v.get('day'), time: v.get('time') } : { freq: 'monthly', monthday: Number(v.get('monthday')), time: v.get('time') };
    const routine = { title: String(v.get('title') || '').trim(), wallet_id: v.get('wallet_id') || null, cadence, assignee_email: String(v.get('assignee_email') || '').trim() || null, remind_before_minutes: Number(v.get('remind')), channels: v.getAll('ch') };
    if (!routine.title) { err.hidden = false; err.textContent = 'Say what needs to happen.'; return; }
    try { f.querySelector('button[type=submit]').disabled = true; await mutate(view, { action: 'upsert', routine }); } catch (x) { err.hidden = false; err.textContent = x.message; f.querySelector('button[type=submit]').disabled = false; }
  };
}
function toast(host, msg) { let t = host.querySelector('.frt-toast'); if (!t) { t = document.createElement('p'); t.className = 'frt-toast'; t.setAttribute('role', 'status'); host.prepend(t); } t.textContent = msg; clearTimeout(t._h); t._h = setTimeout(() => t.remove(), 6000); }

function mount(container, wallet, opts = {}) {
  if (!container) return null;
  for (const v of views) if (v.host === container) views.delete(v);
  const view = { host: container, key: keyOf(wallet), demo: !!opts.demo || demoWanted(), kind: 'page' };
  view.refresh = async (force) => {
    const ticket = (view.ticket = (view.ticket || 0) + 1);
    if (!container.firstChild) container.innerHTML = '<div class="frt"><p class="frt-loading" role="status">Loading routines…</p></div>';
    try { const data = await load(view.key, view.demo, force); if (ticket !== view.ticket) return; container.innerHTML = '<div class="frt">' + page(view, data) + '</div>'; wire(view); }
    catch (e) { if (ticket !== view.ticket) return; container.innerHTML = '<div class="frt"><div class="frt-error"><p>' + E(e.message) + '</p><button type="button" class="frt-btn frt-ghost">Try again</button></div></div>'; container.querySelector('button').onclick = () => view.refresh(true); }
  };
  views.add(view); view.refresh(); return view;
}

// ---------- compact "Coming up" widget ----------
function widget(container, wallet, opts = {}) {
  if (!container) return null;
  for (const v of views) if (v.host === container) views.delete(v);
  const view = { host: container, key: keyOf(wallet), demo: !!opts.demo || demoWanted(), kind: 'widget' };
  view.refresh = async () => {
    try {
      const data = await load(view.key, view.demo), { now, list } = occurrences(data);
      const items = list.filter((o) => o.run.status === 'pending' && o.due < now + 7 * DAY).slice(0, opts.limit || 3);
      const weekly = data.bundles.find((b) => b.key === 'weekly_labor');
      const body = items.length ? '<ul>' + items.map((o) => { const st = state(o, now); return '<li class="tone-' + st.tone + '" data-routine="' + E(o.r.id) + '" data-due="' + E(o.run.due_at) + '"><span class="frt-w-when"><b>' + E(fmt(o.due, { weekday: 'short' })) + '</b>' + E(timeLabel(o.due)) + '</span><span class="frt-w-main"><b>' + E(o.r.title) + '</b><small>' + E(o.r.wallet_name || 'All stores') + ' · ' + (o.r.assignee.assigned ? E(o.r.assignee.name || o.r.assignee.email) : E(o.r.role || 'You')) + (st.key === 'overdue' ? ' · <em>Overdue</em>' : '') + '</small></span><button type="button" class="frt-btn frt-ghost" data-act="complete" aria-label="Mark ' + E(o.r.title) + ' done">Done</button></li>'; }).join('') + '</ul>'
        : data.routines.length ? '<p class="frt-w-empty">Nothing due in the next 7 days.</p>'
        : '<p class="frt-w-empty">Keep the Sunday-to-Monday payroll rhythm on time.</p>' + (weekly && data.scope.role === 'owner' ? '<button type="button" class="frt-btn frt-tpl-btn" data-bundle="weekly_labor">' + E(weekly.cta) + '</button>' : '');
      container.innerHTML = '<section class="frt frt-widget" aria-labelledby="frt-w-h"><header><h3 id="frt-w-h">Coming up</h3><button type="button" class="frt-link" data-open>All routines →</button></header>' + body + '</section>';
      container.querySelector('[data-open]').onclick = () => { if (typeof switchTab === 'function' && document.getElementById('page-routines')) switchTab('routines'); window.dispatchEvent(new CustomEvent('fran:routines-open', { detail: { wallet: view.key } })); };
      container.onclick = async (e) => { const b = e.target.closest('button'); if (!b) return; const li = b.closest('[data-routine]'); try { if (b.dataset.bundle) { b.disabled = true; await mutate(view, { action: 'add_template', bundle: b.dataset.bundle, wallet_id: view.key === 'portfolio' ? null : view.key }); } else if (li && b.dataset.act === 'complete') { b.disabled = true; await mutate(view, { action: 'complete', routine_id: li.dataset.routine, due_at: li.dataset.due }); } } catch (x) { b.disabled = false; b.title = x.message; } };
    } catch (e) { container.innerHTML = '<section class="frt frt-widget"><header><h3>Coming up</h3></header><p class="frt-w-empty">' + E(e.message) + '</p></section>'; }
  };
  views.add(view); view.refresh(); return view;
}

// ---------- wallet.html auto-integration (only if #fw-routines exists) ----------
const activeKey = () => { try { return typeof WALLET_ID !== 'undefined' && WALLET_ID !== 'all' ? WALLET_ID : null; } catch { return null; } };
function autoMount() { const host = document.getElementById('fw-routines'); if (host) mount(host, activeKey()); }
document.addEventListener('click', (e) => { if (e.target.closest('[data-page="routines"],[data-goto="routines"]')) autoMount(); });
window.addEventListener('fran:location', () => { cache.clear(); if (document.getElementById('page-routines')?.classList.contains('active')) autoMount(); });

window.FranRoutines = { mount, widget, refresh: () => { cache.clear(); rerenderAll(false); }, _demoFixture: demoFixture };
})();
