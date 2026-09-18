import { AlarmForm, ReminderInbox, useResetReminders } from './reminders';
import type { Alarm } from '../../shared/reminders';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Bell, Activity, LayoutGrid, SlidersHorizontal, BookOpen, Plus, RefreshCw, Search, ArrowUpRight, Clock3, ShieldCheck, ChevronRight, Settings2, Pencil, X, ArrowUp, ArrowDown, Pause, Play, Trash2, Check, CircleHelp, PanelLeftClose } from 'lucide-react';
import { type State, type Source, type Metric, providerFor, measurement, freshness, formatValue, countdown, age } from '../../shared/model';
import { api, session } from './api';
import { Modal, SourceForm, MetricForm } from './forms';

function Logo({ source, small = false }: { source: { provider: string }; small?: boolean }) {
  const p = providerFor(source.provider);
  return <span className={'tool-logo' + (small ? ' small' : '')} style={{ '--tool-color': p.color } as CSSProperties} aria-hidden="true">{p.mark}</span>;
}
function MetricRow({ metric: m, now, alarm, setAlarm }: { metric: Metric; now: number; alarm?: Alarm; setAlarm: () => void }) {
  const { remaining, percent, bar } = measurement(m), state = freshness(m, now);
  const tone = state !== 'fresh' ? 'muted' : percent !== null && percent >= 90 ? 'critical' : percent !== null && percent >= 70 ? 'caution' : 'healthy';
  let headline = 'Unknown', description = 'No reading yet';
  if (m.allowance === 'unlimited') { headline = 'No key cap'; description = 'Account credit may still be limited'; }
  else if (remaining !== null) { headline = formatValue(remaining, m.unit); description = m.kind === 'balance' ? 'available balance' : 'remaining'; }
  else if (percent !== null) { headline = formatValue(String(100 - percent), 'percent'); description = 'remaining'; }
  else if (m.used !== null) { headline = formatValue(m.used, m.unit); description = 'used · limit unknown'; }
  else if (m.limitState === 'reached') { headline = 'Limit reached'; description = 'Counts not provided'; }
  else if (m.limitState === 'not_reached') { headline = 'Limit not reached'; description = 'Counts not provided'; }
  else if (m.resetAt) { headline = 'Reset tracked'; description = 'Capacity unknown'; }
  return <div className={'metric ' + tone}>
    <div className="metric-top"><span>{m.label}</span>{m.kind === 'budget' && <span className="mini-tag">Personal budget</span>}</div>
    <div className="metric-values"><div><strong>{headline}</strong><span>{description}</span></div>
      {percent !== null && <span className="used-label">{Math.round(percent)}% used</span>}
      {percent === null && m.unit !== 'usd' && m.unit !== 'percent' && (remaining !== null || m.used !== null) && <span className="used-label">{m.unit}</span>}
    </div>
    {bar !== null && <div className="progress" role="progressbar" aria-label={m.label + ' used'} aria-valuenow={Math.round(bar)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: bar + '%' }}/></div>}
    {m.limit !== null && m.unit !== 'percent' && <p className="metric-caption">{m.used !== null ? formatValue(m.used, m.unit) + ' of ' : 'Limit: '}{formatValue(m.limit, m.unit)} {m.unit === 'usd' ? '' : m.unit}</p>}
    <div className="reset-line"><Clock3 size={13}/>{m.resetAt ? <span title={new Date(m.resetAt).toLocaleString()}>{state === 'reset_due' ? 'Reset due — awaiting update' : <>Resets in <b>{countdown(m.resetAt, now)}</b></>}</span> : <span>{m.resetKind === 'none' ? 'No scheduled reset' : 'Reset time unknown'}</span>}
      {state === 'stale' && <span className="outdated">Out of date</span>}
      <button className={alarm?.enabled ? 'alarm-button active' : 'alarm-button'} disabled={!m.resetAt && !alarm} onClick={setAlarm} aria-label={(alarm?.enabled ? 'Edit alarm for ' : 'Set alarm for ') + m.label} title={!m.resetAt ? 'Add a reset time first' : 'Reset alarm'}><Bell size={14}/>{alarm?.enabled ? 'Alarm on' : 'Set alarm'}</button>
    </div>
  </div>;
}
function Card({ source: s, now, edit, settings, details, refresh, alarms, setAlarm }: { alarms: Alarm[]; setAlarm: (metric: Metric) => void; source: Source; now: number; edit: () => void; settings: () => void; details: () => void; refresh: () => void }) {
  const p = providerFor(s.provider), hasStale = s.metrics.some(m => freshness(m, now) !== 'fresh');
  return <article className={'source-card' + (hasStale ? ' has-stale' : '')} aria-label={s.name + ' source'}>
    <div className="card-head"><Logo source={s}/><div className="card-title"><h3>{s.name}</h3><p>{s.scope}</p></div>
      <button className="icon-button" onClick={settings} aria-label={'Settings for ' + s.name}><Settings2 size={17}/></button>
    </div>
    <div className="card-badges"><span className={'badge ' + (s.mode === 'automatic' ? 'automatic' : '')}><i/>{s.mode === 'automatic' ? 'Automatic' : 'Manual'}</span>
      {hasStale && <span className="badge warning">Needs a check</span>}</div>
    <div className="card-metrics">{s.metrics.length ? s.metrics.map(m => <MetricRow key={m.key} metric={m} now={now} alarm={alarms.find(a => a.metricKey === m.key)} setAlarm={() => setAlarm(m)}/>) :
      <div className="no-reading"><Activity size={23}/><strong>No reading yet</strong><p>{s.mode === 'manual' ? 'Add a value from your provider to get started.' : 'Waiting for the first automatic check.'}</p>
        <button className="text-button" onClick={s.mode === 'manual' ? edit : refresh}>{s.mode === 'manual' ? 'Add first reading' : 'Check now'}<ChevronRight size={15}/></button></div>}</div>
    {s.error && s.mode === 'automatic' && <div className="card-error" role="status">{s.error}</div>}
    <div className="card-footer"><button className="timestamp" onClick={details} title="Reading details">{s.metrics.length ? 'Observed ' + age(s.metrics.reduce((a, b) => a.observedAt < b.observedAt ? a : b).observedAt, now).toLowerCase() : 'Not checked'}<CircleHelp size={12}/></button>
      <div><button className="icon-button" onClick={s.mode === 'manual' ? edit : refresh} aria-label={(s.mode === 'manual' ? 'Update ' : 'Refresh ') + s.name}>{s.mode === 'manual' ? <Pencil size={15}/> : <RefreshCw size={15}/>}</button>{p.url && <a className="icon-button" href={p.url} target="_blank" rel="noreferrer" aria-label={'Open ' + s.name + ' provider'}><ArrowUpRight size={17}/></a>}</div></div>
  </article>;
}
type Dialog = { type: 'source'; source?: Source } | { type: 'metric' | 'details' | 'delete'; source: Source } | { type: 'alarm'; source: Source; metric: Metric } | { type: 'reminders' } | null;
export default function App() {
  const [state, setState] = useState<State | null>(null), [demo, setDemo] = useState(false);
  const [page, setPage] = useState('dashboard'), [filter, setFilter] = useState('all'), [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null), [now, setNow] = useState(Date.now());
  const [error, setError] = useState(''), [toast, setToast] = useState(''), [loading, setLoading] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const reminders = useResetReminders(!demo && !!state && !loading);
  const unreadReminders = reminders.state.events.filter(e => !e.dismissed).length;
  const activeMode = useRef(demo);
  activeMode.current = demo;
  const requestSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const result = await api<State>(demo ? '/demo' : '/state');
    if (activeMode.current === demo && sequence === requestSequence.current) { setState(result); setError(''); }
  }, [demo]);
  useEffect(() => {
    let live = true;
    void (async () => { try { await session(); if (live) await load(); } catch (e) { if (live) setError((e as Error).message); } finally { if (live) setLoading(false); } })();
    const poll = setInterval(() => { if (!document.hidden && !demo) void load().catch(e => setError(e.message)); }, 15000);
    const visible = () => { if (!document.hidden && !demo) void load().catch(e => setError(e.message)); };
    document.addEventListener('visibilitychange', visible);
    return () => { live = false; clearInterval(poll); document.removeEventListener('visibilitychange', visible); };
  }, [load, demo]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [page, demo]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 5000); return () => clearTimeout(t); }, [toast]);
  const notify = (text: string) => setToast(text);
  const sources = state?.demo === demo ? state.sources : [], enabled = sources.filter(s => s.enabled);
  const needsAttention = (s: Source) => !!s.error || !s.metrics.length || s.metrics.some(m => freshness(m, now) !== 'fresh' || m.limitState === 'reached' || (measurement(m).percent ?? 0) >= 90);
  const attention = enabled.filter(needsAttention).length;
  const resets = enabled.flatMap(s => s.metrics.filter(m => m.kind !== 'budget' && m.resetAt && freshness(m, now) === 'fresh').map(m => ({ source: s, metric: m }))).sort((a, b) => Date.parse(a.metric.resetAt!) - Date.parse(b.metric.resetAt!));
  const next = resets[0];
  const visibleSources = enabled.filter(s => (s.name + ' ' + s.scope).toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || filter === s.mode || filter === 'attention' && needsAttention(s)));
  const edit = (nextDialog: Dialog) => { if (demo) { notify('This is sample data. Exit demo to add your own sources.'); return; } setDialog(nextDialog); };
  async function refresh(s: Source) {
    if (demo) return notify('Demo readings are samples. Your real workspace is untouched.');
    try {
      const result = await api<{ status: string }>('/sources/' + s.id + '/refresh', 'POST', {});
      notify(result.status === 'cooldown' ? 'This source is cooling down. It will retry when permitted.' : result.status === 'busy' ? 'Other sources are refreshing. Try again shortly.' : 'Checking ' + s.name + '…');
      await load();
    } catch (e) { notify((e as Error).message); }
  }
  async function update(s: Source, changes: Partial<Source>, position?: number) {
    if (demo) return notify('Exit demo to manage your own sources.');
    const { provider, name, scope, mode, enabled, pollSeconds } = { ...s, ...changes };
    await api('/sources/' + s.id, 'PATCH', { revision: s.revision, source: { provider, name, scope, mode, enabled, pollSeconds }, ...(position !== undefined ? { position } : {}) });
  }
  async function reorder(s: Source, delta: number) {
    const i = sources.findIndex(x => x.id === s.id), neighbor = sources[i + delta];
    if (!neighbor) return;
    if (demo) return notify('Exit demo to manage your own sources.');
    const ordered = [...sources]; [ordered[i], ordered[i + delta]] = [ordered[i + delta], ordered[i]];
    try { await api('/order', 'PUT', ordered.map(s => ({ id: s.id, revision: s.revision }))); await load(); }
    catch (e) { notify((e as Error).message); }
  }
  async function refreshAll() {
    if (demo) return notify('Demo readings are samples. Your real workspace is untouched.');
    const auto = enabled.filter(s => s.mode === 'automatic');
    if (!auto.length) { await load().catch(e => notify(e.message)); return notify('Manual readings stay unchanged. Use the pencil on a card to update them.'); }
    await Promise.all(auto.map(refresh));
  }
  const saved = async () => { await load(); notify('Saved to this device.'); };
  return <div className="app-shell">
    <aside className={'sidebar' + (mobileNav ? ' open' : '')}>
      <a className="brand" href="#dashboard" onClick={e => { e.preventDefault(); setPage('dashboard'); }}><span className="brand-mark"><Activity size={23} strokeWidth={2.6}/></span><span>quota<span className="brand-period">.</span></span></a>
      <div className="workspace"><span className="workspace-avatar">P</span><div><strong>Personal workspace</strong><small>On this device</small></div><ShieldCheck size={15}/></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{[{ id: 'dashboard', name: 'Overview', icon: LayoutGrid }, { id: 'sources', name: 'Sources', icon: SlidersHorizontal }, { id: 'guide', name: 'Quick guide', icon: BookOpen }].map(item => <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} onClick={() => { setPage(item.id); setMobileNav(false); }}><item.icon size={18}/><span>{item.name}</span>{item.id === 'sources' && <span className="nav-count">{sources.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="privacy-card"><ShieldCheck size={20}/><strong>Your usage. Your device.</strong><p>Stored locally. No tracking.<br/>No account required.</p></div><div className="local-indicator"><i/>Local workspace<span>v1.3</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Toggle navigation" onClick={() => setMobileNav(!mobileNav)}><PanelLeftClose size={20}/></button><span>Workspace</span><ChevronRight size={14}/><strong>{page === 'dashboard' ? 'Overview' : page === 'sources' ? 'Sources' : 'Quick guide'}</strong></div><div className="topbar-right"><button className="text-button" onClick={() => edit({ type: 'reminders' })} aria-label="Reset reminders"><Bell size={16}/><span>Reminders{unreadReminders ? ' (' + unreadReminders + ')' : ''}</span></button><span className="private-pill"><ShieldCheck size={13}/>Local & private</span><span className="profile">P</span></div></header>
      <main>
        {demo && <div className="demo-banner"><span><strong>Demo workspace</strong> · Sample readings only. Your saved sources are untouched.</span><button onClick={() => { setDemo(false); setFilter('all'); }}><X size={15}/>Exit demo</button></div>}
        {!demo && unreadReminders > 0 && <div className="reminder-banner" role="status"><Bell size={18}/><span>{unreadReminders} reset reminder{unreadReminders === 1 ? '' : 's'}: check your provider for availability.</span><button className="text-button" onClick={() => setDialog({ type: 'reminders' })}>View reminders</button></div>}
        {reminders.error && <p className="error" role="status">{reminders.error}</p>}
        {error && <div className="error-banner" role="alert"><span>{error} Last-known values may be out of date.</span><button onClick={() => void session().then(load).catch(e => notify(e.message))}>Reconnect</button></div>}
        <div className="page-heading"><div><div className="eyebrow">{page === 'dashboard' ? 'A LITTLE CLARITY FOR YOUR AI WORKFLOW' : page === 'sources' ? 'YOUR CONNECTED TOOLKIT' : 'MADE TO STAY SIMPLE'}</div><h1>{page === 'dashboard' ? 'Your AI, at a glance.' : page === 'sources' ? 'Make it your workspace.' : 'A clearer view of your limits.'}</h1><p>{page === 'dashboard' ? 'Keep an eye on your limits. Know when you’re ready to go again.' : page === 'sources' ? 'Choose what you track and how you keep it up to date.' : 'Everything you need to know to start tracking with confidence.'}</p></div>
          {page !== 'guide' && <button className="button primary" onClick={() => edit({ type: 'source' })}><Plus size={17}/>Add source</button>}
        </div>
        {page === 'dashboard' && <>
          <section className="summary-strip" aria-label="Workspace summary">
            <div className="summary-item"><div className="summary-label"><LayoutGrid size={15}/>Tracked sources</div><div className="summary-value">{String(enabled.length).padStart(2, '0')}<span>{enabled.length === 1 ? 'tool in your workspace' : 'tools in your workspace'}</span></div></div>
            <div className="summary-item"><div className="summary-label"><Activity size={15}/>Needs attention</div><div className="summary-value">{String(attention).padStart(2, '0')}<span>{attention ? 'worth a quick check' : 'you’re all caught up'}</span></div></div>
            <div className="summary-item next-reset"><div className="summary-label"><Clock3 size={15}/>Next known reset</div><div className="summary-value">{next ? countdown(next.metric.resetAt!, now) : '—'}<span>{next ? next.source.name + (next.metric.resetBasis === 'user_entered' ? ' · manual' : '') : 'add a reset to see it here'}</span></div></div>
          </section>
          <div className="section-heading"><div><h2>Your sources <span>{enabled.length}</span></h2><p>A separate view for every tool and every limit.</p></div><button className="button secondary" onClick={() => void refreshAll()}><RefreshCw size={15}/>Refresh</button></div>
          <div className="filter-bar"><div className="filters">{[{ id: 'all', name: 'All sources' }, { id: 'automatic', name: 'Automatic' }, { id: 'manual', name: 'Manual' }, { id: 'attention', name: 'Needs attention' }].map(f => <button key={f.id} className={filter === f.id ? 'filter active' : 'filter'} onClick={() => setFilter(f.id)}>{f.name}</button>)}</div><label className="search"><Search size={16}/><input aria-label="Search sources" placeholder="Find a source…" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={14}/></button>}</label></div>
          {loading ? <div className="loading-state"><RefreshCw size={22} className="spin"/>Opening your workspace…</div> : !enabled.length ? <section className="empty-state"><div className="empty-orbit"><span>✳</span><span>⌘</span><span>✦</span></div><h2>All your limits. One quiet place.</h2><p>Add your first AI tool to see usage and reset times here.<br/>Start with a quick manual reading, or connect a supported tool.</p><div><button className="button primary" onClick={() => edit({ type: 'source' })}><Plus size={17}/>Add your first source</button><button className="button secondary" onClick={() => setDemo(true)}>Explore the demo<ArrowUpRight size={16}/></button></div><small><ShieldCheck size={13}/>Your data stays on this computer.</small></section> : visibleSources.length ? <div className="card-grid">{visibleSources.map(s => <Card key={s.id} source={s} now={now} alarms={reminders.state.alarms.filter(a => a.sourceId === s.id)} setAlarm={metric => edit({ type: 'alarm', source: s, metric })} edit={() => edit({ type: 'metric', source: s })} settings={() => edit({ type: 'source', source: s })} details={() => setDialog({ type: 'details', source: s })} refresh={() => void refresh(s)}/>)}
            <button className="add-card" onClick={() => edit({ type: 'source' })}><span><Plus size={24}/></span><strong>Room for another tool</strong><p>Bring the rest of your AI workspace together.</p></button></div> : <div className="no-results"><Search size={24}/><h3>No sources match</h3><p>Try another search or filter.</p><button className="text-button" onClick={() => { setFilter('all'); setQuery(''); }}>Clear filters</button></div>}
          <div className="bottom-note"><ShieldCheck size={15}/><span>A helpful overview, not a guarantee. Your provider always has the final word.</span><button onClick={() => setPage('guide')}>How it works<ArrowUpRight size={14}/></button></div>
        </>}
        {page === 'sources' && <div className="sources-panel"><div className="panel-heading"><h2>Source management</h2><span>{sources.length} configured</span></div>{!sources.length ? <div className="no-results"><SlidersHorizontal size={27}/><h3>Your toolkit starts here</h3><p>Add the tools you use. Each source has its own scope and settings.</p><button className="button primary" onClick={() => edit({ type: 'source' })}><Plus size={16}/>Add source</button></div> : sources.map((s, i) => <div className={'source-list-row' + (!s.enabled ? ' paused' : '')} key={s.id}><Logo source={s} small/><div className="list-name"><strong>{s.name}</strong><small>{s.scope} · {s.mode === 'manual' ? 'Manual entry' : 'Every ' + s.pollSeconds / 60 + ' min'}{!s.enabled ? ' · Paused' : ''}</small></div><div className="list-actions"><button className="icon-button" aria-label={'Move ' + s.name + ' up'} disabled={i === 0} onClick={() => void reorder(s, -1)}><ArrowUp size={16}/></button><button className="icon-button" aria-label={'Move ' + s.name + ' down'} disabled={i === sources.length - 1} onClick={() => void reorder(s, 1)}><ArrowDown size={16}/></button><button className="icon-button" aria-label={(s.enabled ? 'Pause ' : 'Enable ') + s.name} onClick={() => void update(s, { enabled: !s.enabled }).then(load).catch(e => notify(e.message))}>{s.enabled ? <Pause size={16}/> : <Play size={16}/>}</button><button className="icon-button" aria-label={'Edit ' + s.name} onClick={() => edit({ type: 'source', source: s })}><Pencil size={16}/></button><button className="icon-button danger" aria-label={'Remove ' + s.name} onClick={() => edit({ type: 'delete', source: s })}><Trash2 size={16}/></button></div></div>)}</div>}
        {page === 'guide' && <div className="guide-grid">{[
          ['01', 'Start with what you know', 'Add a tool, then enter the usage or reset time shown by its provider. You can track a percentage, counts, a balance, or just a reset. Unknown values stay unknown.'],
          ['02', 'Let supported tools check in', 'Codex uses your installed CLI. Supported API providers use protected keys or server environment variables. Source settings explain the required key type and reporting scope.'],
          ['03', 'Treat resets as a checkpoint', 'A countdown reaching zero does not refill the card. Check the provider and update your reading. Old observations stay visible and are marked for a check.'],
          ['04', 'Keep the scopes separate', 'Subscription windows, API usage, and personal budgets mean different things. Each gets its own metric. BYOK tools such as Cline share their upstream provider’s usage.'],
          ['05', 'You own your data', 'Readings live in SQLite on your computer. Run npm run backup to create a consistent local backup. Closing this tab leaves the backend running; stopping it pauses monitoring.'],
          ['06', 'Recover without starting over', 'A failed refresh keeps the previous reading. Check source details, restore credentials in the official tool, and retry. You can switch to Manual in settings at any time.']
        ].map(([n, title, text]) => <section className="guide-card" key={n}><span>{n}</span><h2>{title}</h2><p>{text}</p></section>)}
          <div className="guide-footer"><ShieldCheck size={20}/><div><strong>Designed for one person, on one computer.</strong><p>No telemetry. No generation probes. Credentials stay on the server.</p></div><button className="button secondary" onClick={() => { setDemo(true); setPage('dashboard'); }}>Explore demo<ArrowUpRight size={16}/></button></div></div>}
        <footer className="page-footer"><span>QUOTA · A little more headroom.</span><span>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(now)}<i/>Local time</span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check size={17}/><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={15}/></button></div>}
    {dialog?.type === 'alarm' && <AlarmForm source={dialog.source} metric={dialog.metric} alarm={reminders.state.alarms.find(a => a.sourceId === dialog.source.id && a.metricKey === dialog.metric.key)} emailConfigured={reminders.state.emailConfigured} close={() => setDialog(null)} saved={reminders.refresh}/>}
    {dialog?.type === 'reminders' && <ReminderInbox state={reminders.state} close={() => setDialog(null)} refresh={reminders.refresh}/>}
    {dialog?.type === 'source' && <SourceForm source={dialog.source} close={() => setDialog(null)} saved={saved}/>}
    {dialog?.type === 'metric' && <MetricForm source={dialog.source} close={() => setDialog(null)} saved={saved}/>}
    {dialog?.type === 'details' && <Modal title={dialog.source.name + ' details'} subtitle={dialog.source.scope} close={() => setDialog(null)}><div className="details-body">
      <dl><dt>Collection</dt><dd>{dialog.source.mode === 'manual' ? 'User-entered observations' : 'Official read interface'}</dd><dt>Last attempt</dt><dd>{dialog.source.lastAttempt ? new Date(dialog.source.lastAttempt).toLocaleString() : 'Not checked'}</dd><dt>Last successful check</dt><dd>{dialog.source.lastSuccess ? new Date(dialog.source.lastSuccess).toLocaleString() : 'Not checked'}</dd></dl>
      {dialog.source.metrics.map(m => <section className="detail-metric" key={m.key}><strong>{m.label}</strong><dl><dt>Observed</dt><dd>{new Date(m.observedAt).toLocaleString()}</dd><dt>Provenance</dt><dd>{m.provenance.replaceAll('_', ' ')}</dd><dt>Reset</dt><dd>{m.resetAt ? new Date(m.resetAt).toLocaleString() : 'Unknown / not applicable'}</dd><dt>Reset basis</dt><dd>{m.resetBasis.replaceAll('_', ' ')}</dd><dt>Recheck after</dt><dd>{Math.round(m.freshnessSeconds / 60)} minutes</dd></dl></section>)}
      {dialog.source.error && <p className="error">{dialog.source.error}</p>}<p className="form-note">A recent check does not make an old observation current. Provider availability may change between checks.</p></div></Modal>}
    {dialog?.type === 'delete' && <Modal title={'Remove ' + dialog.source.name + '?'} subtitle="This removes its saved readings and history from this device." close={() => setDialog(null)}><div className="form"><p className="form-note">Your provider account and its credentials are not changed. You can pause the source instead to keep its history.</p><div className="modal-actions"><button className="button secondary" onClick={() => setDialog(null)}>Keep source</button><button className="button danger" onClick={() => void api('/sources/' + dialog.source.id, 'DELETE', { revision: dialog.source.revision }).then(async () => { setDialog(null); await saved(); }).catch(e => notify(e.message))}>Remove source</button></div></div></Modal>}
  </div>;
}
