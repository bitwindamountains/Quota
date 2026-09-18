import { keyIntegration, minimumPoll, environmentPattern, manualReason } from '../../shared/integrations';
import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import { X, Plus, ArrowRight, Trash2 } from 'lucide-react';
import { Decimal } from 'decimal.js';
import { providers, providerFor, supportsAuto, metricSchema, type Source, type SourceInput, type Metric } from '../../shared/model';
import { api } from './api';

export function Modal({ title, subtitle, children, close }: { title: string; subtitle?: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = ref.current!; const previous = document.activeElement as HTMLElement; el.showModal(); return () => { el.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} className="modal" onCancel={e => { e.preventDefault(); close(); }}>
    <div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={close} aria-label="Close dialog"><X size={20}/></button></div>
    {children}
  </dialog>;
}
export function SourceForm({ source: initialSource, close, saved }: { source?: Source; close: () => void; saved: () => Promise<void> }) {
  const [source, setSource] = useState(initialSource);
  const [revision, setRevision] = useState(source?.revision ?? 1);
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [provider, setProvider] = useState(source?.provider ?? 'codex');
  const [name, setName] = useState(source?.name ?? 'Codex');
  const [scope, setScope] = useState(source?.scope ?? 'Personal');
  const [mode, setMode] = useState<SourceInput['mode']>(source?.mode ?? 'manual');
  const [poll, setPoll] = useState((source?.pollSeconds ?? 300) / 60);
  const [enabled, setEnabled] = useState(source?.enabled ?? true);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const data = { provider, name, scope, mode, pollSeconds: Math.max(minimumPoll(provider), poll * 60), enabled };
      if (source) await api('/sources/' + source.id, 'PATCH', { revision, source: data });
      else {
        const created = await api<Source>('/sources', 'POST', data);
        if (keyIntegration(provider)) { setSource(created); setRevision(created.revision); await saved(); return; }
      }
      await saved(); close();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title={source ? 'Source settings' : 'Add a source'} subtitle="Keep your tools in view, on your terms." close={close}>
    <form onSubmit={e => void submit(e)} className="form">
      <label>AI tool<select value={provider} disabled={!!source} onChange={e => { const id = e.target.value as Source['provider']; setProvider(id); setName(providerFor(id).name); setMode('manual'); setPoll(minimumPoll(id) / 60); }}>
        {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <div className="form-row"><label>Display name<input value={name} onChange={e => setName(e.target.value)} maxLength={60} required /></label>
        <label>Account or scope<input value={scope} disabled={!!source} onChange={e => setScope(e.target.value)} maxLength={80} required placeholder="Personal" /></label></div>
      <fieldset className="mode-options"><legend>How to track</legend>
        <label className={mode === 'manual' ? 'selected' : ''}><input type="radio" name="mode" checked={mode === 'manual'} onChange={() => setMode('manual')}/><span><strong>Manual entry</strong><small>Copy what your provider shows.</small></span></label>
        <label className={mode === 'automatic' ? 'selected' : ''}><input type="radio" name="mode" checked={mode === 'automatic'} disabled={!supportsAuto(provider)} onChange={() => { setMode('automatic'); setPoll(value => Math.max(value, minimumPoll(provider) / 60)); }}/><span><strong>Automatic</strong><small>{supportsAuto(provider) ? 'Read-only, refreshed locally.' : 'Not available for this tool yet.'}</small></span></label>
      </fieldset>
      {(supportsAuto(provider) || mode === 'automatic') && <div className="form-note">{provider === 'codex' ? 'Uses your installed Codex CLI and its existing ChatGPT sign-in. The CLI owns authentication; no prompts or generation requests are sent.' : keyIntegration(provider)?.description}</div>}
      {!supportsAuto(provider) && <p className="form-note">{manualReason(provider)}</p>}
      {!initialSource && source && <p role="status" className="form-note">Source added. Configure its credential below, then choose Automatic when ready.</p>}
      {provider === 'cline' && <div className="form-note">For BYOK, track the upstream provider instead. Use this card for Cline-managed credits or a subscription.</div>}
      {mode === 'automatic' && <label>Refresh interval (minutes)<input type="number" min={minimumPoll(provider) / 60} max={1440} value={poll} onChange={e => setPoll(Number(e.target.value))} required /></label>}
      {source && <label className="check"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}/> Show and refresh this source</label>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button primary" disabled={busy || credentialBusy}>{busy ? 'Saving…' : source ? 'Save changes' : 'Add source'}<ArrowRight size={16}/></button></div>
    </form>
    {source && keyIntegration(source.provider) && <CredentialForm source={source} revision={revision} changed={setRevision} busyChanged={setCredentialBusy} parentBusy={busy} />}
  </Modal>;
}

type CredentialStatus = { method: 'protected' | 'environment' | 'none'; variable?: string; configured: boolean; protectedAvailable: boolean; revision?: number };
function CredentialForm({ source, revision, changed, busyChanged, parentBusy }: { parentBusy: boolean; source: Source; revision: number; changed: (revision: number) => void; busyChanged: (busy: boolean) => void }) {
  const integration = keyIntegration(source.provider)!;
  const [status, setStatus] = useState<CredentialStatus>();
  const [method, setMethod] = useState<CredentialStatus['method']>('environment');
  const [variable, setVariable] = useState<string>(integration.variable);
  const [key, setKey] = useState(''), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void api<CredentialStatus>('/sources/' + source.id + '/credential').then(value => {
      if (active) { setStatus(value); setMethod(value.method === 'none' ? (value.protectedAvailable ? 'protected' : 'environment') : value.method); setVariable(value.variable ?? integration.variable); }
    }).catch(() => { if (active) setMessage('Could not load credential settings. Reopen this dialog.'); });
    return () => { active = false; };
  }, [source.id, integration.variable]);
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); busyChanged(true); setMessage('');
    const credential = method === 'protected' ? { method, key } : method === 'environment' ? { method, variable } : { method };
    setKey('');
    try {
      const result = await api<CredentialStatus>('/sources/' + source.id + '/credential', 'PUT', { revision, credential });
      changed(result.revision!); setStatus(result);
      setMessage(method === 'none' ? 'Credential removed. Automatic collection needs a credential to resume.' : 'Credential settings saved.');
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); busyChanged(false); }
  }
  return <form className="form" onSubmit={e => void save(e)}>
    <h3>{integration.name} credential</h3>
    <p className="form-note">Required: {integration.credentialLabel}. <a href={integration.docs} target="_blank" rel="noreferrer">Provider documentation</a></p>
    <p className="form-note">{status ? (status.configured ? 'A credential is configured. Saved keys are never displayed.' : 'No credential is configured for the selected method.') : 'Loading credential settings...'}</p>
    <label>Credential storage<select disabled={!status || busy} value={method} onChange={e => { setMethod(e.target.value as CredentialStatus['method']); setKey(''); setMessage(''); }}>
      <option value="protected" disabled={!status?.protectedAvailable}>Windows-protected key</option>
      <option value="environment">Server environment variable</option>
      <option value="none">Remove credential / disconnect</option>
    </select></label>
    {method === 'protected' && <label>New API key<input type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="new-password" spellCheck={false} minLength={10} maxLength={4096} required placeholder="Paste a key to save or replace" /></label>}
    {method === 'environment' && <label>Environment variable name<input value={variable} onChange={e => setVariable(e.target.value)} required pattern={environmentPattern(source.provider)} maxLength={110} /></label>}
    <p className="form-note">Protected keys are encrypted for this Windows user. Environment mode reads a server variable; changing .env requires a restart. Switching methods removes the previous protected key and never falls back to it. A different key needs a new source once readings have been collected.</p>
    {message && <p role="status">{message}</p>}
    <button type="submit" className="button secondary" disabled={busy || parentBusy || !status}>{busy ? 'Saving credential...' : 'Save credential settings'}</button>
  </form>;
}

type EntryMode = 'percent_used' | 'percent_remaining' | 'counts' | 'remaining' | 'balance' | 'usage' | 'budget' | 'reset' | 'reached' | 'unknown';
const localTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export function MetricForm({ source, close, saved }: { source: Source; close: () => void; saved: () => Promise<void> }) {
  const [selected, setSelected] = useState(source.metrics[0]?.key ?? '');
  const [label, setLabel] = useState('Current window');
  const [mode, setMode] = useState<EntryMode>('percent_used');
  const [value, setValue] = useState(''), [limit, setLimit] = useState(''), [unit, setUnit] = useState('requests');
  const [reset, setReset] = useState(''), [observed, setObserved] = useState(localTime(new Date().toISOString()));
  const [freshHours, setFreshHours] = useState(24);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    const m = source.metrics.find(m => m.key === selected);
    setLabel(m?.label ?? 'New window');
    setUnit(m?.unit === 'percent' ? 'requests' : m?.unit ?? 'requests');
    setLimit(m?.limit ?? '');
    setReset(localTime(m?.resetAt ?? null));
    setFreshHours(m ? m.freshnessSeconds / 3600 : 24);
    setObserved(localTime(new Date().toISOString()));
    if (!m) { setMode('percent_used'); setValue(''); return; }
    if (m.usedPercent !== null) { setMode('percent_used'); setValue(m.usedPercent); }
    else if (m.kind === 'balance') { setMode('balance'); setValue(m.remaining ?? ''); }
    else if (m.kind === 'usage_total') { setMode('usage'); setValue(m.used ?? ''); }
    else if (m.kind === 'budget') { setMode('budget'); setValue(m.used ?? ''); }
    else if (m.used !== null) { setMode('counts'); setValue(m.used); }
    else if (m.remaining !== null) { setMode('remaining'); setValue(m.remaining); }
    else { setMode(m.limitState === 'reached' ? 'reached' : m.resetAt ? 'reset' : 'unknown'); setValue(''); }
  }, [selected, source]);
  async function commit(metrics: Metric[]) {
    setBusy(true); setError('');
    try { await api('/sources/' + source.id + '/manual', 'PUT', { revision: source.revision, metrics }); await saved(); close(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    try {
      if (reset && new Date(reset).getTime() <= Date.now()) throw new Error('Replace the expired reset time, or clear it if the next reset is unknown.');
      const countMode = ['counts', 'remaining', 'budget'].includes(mode);
      const noValue = ['reset', 'unknown', 'reached'].includes(mode);
      if (!noValue && !value.trim()) throw new Error('Enter the value you observed, or choose Unknown.');
      if (mode === 'reset' && !reset) throw new Error('Enter a reset time.');
      const m = metricSchema.parse({
        key: selected || 'manual:' + crypto.randomUUID(), label,
        kind: mode === 'balance' ? 'balance' : mode === 'usage' ? 'usage_total' : mode === 'budget' ? 'budget' : 'quota',
        unit: mode.startsWith('percent') ? 'percent' : mode === 'balance' || mode === 'budget' ? 'usd' : unit,
        used: ['counts', 'usage', 'budget'].includes(mode) ? value : null,
        remaining: ['balance', 'remaining'].includes(mode) ? value : null,
        limit: countMode && limit ? limit : null,
        usedPercent: mode === 'percent_used' ? value : mode === 'percent_remaining' ? new Decimal(100).minus(value).toString() : null,
        allowance: mode.startsWith('percent') || (countMode && limit) ? 'finite' : ['balance', 'usage'].includes(mode) ? 'not_applicable' : 'unknown',
        enforcement: mode === 'budget' ? 'advisory' : 'unknown',
        limitState: mode === 'reached' ? 'reached' : 'unknown',
        resetAt: reset ? new Date(reset).toISOString() : null,
        resetKind: reset ? 'fixed' : mode === 'balance' ? 'none' : 'unknown', resetBasis: reset ? 'user_entered' : 'unknown',
        observedAt: new Date(observed).toISOString(), provenance: 'user_entered', freshnessSeconds: Math.round(freshHours * 3600)
      });
      const metrics = source.metrics.filter(x => x.key !== selected); metrics.push(m);
      void commit(metrics);
    } catch (e) { setError(e instanceof Error && 'issues' in e ? 'Check your numeric values and time fields. Percentages must be between 0 and 100.' : (e as Error).message); }
  }
  return <Modal title={'Update ' + source.name} subtitle="Enter only what you know. Unknown is always an option." close={close}>
    <form onSubmit={submit} className="form">
      <div className="metric-tabs">{source.metrics.map(m => <button key={m.key} type="button" className={selected === m.key ? 'chip active' : 'chip'} onClick={() => setSelected(m.key)}>{m.label}</button>)}<button type="button" className={!selected ? 'chip active' : 'chip'} onClick={() => setSelected('')}><Plus size={14}/>New metric</button></div>
      <label>Window or metric name<input value={label} onChange={e => setLabel(e.target.value)} required maxLength={80}/></label>
      <label>What does the provider show?<select value={mode} onChange={e => { setMode(e.target.value as EntryMode); setValue(''); setLimit(''); }}>
        <option value="percent_used">Percent used</option><option value="percent_remaining">Percent remaining</option>
        <option value="counts">Used count / optional limit</option><option value="remaining">Remaining count / optional limit</option>
        <option value="balance">Credit balance (USD)</option><option value="usage">Usage total</option><option value="budget">Personal budget (USD, advisory)</option>
        <option value="reset">Reset time only</option><option value="reached">Limit reached, counts unknown</option><option value="unknown">Unknown</option>
      </select></label>
      {!['reset', 'reached', 'unknown'].includes(mode) && <div className="form-row"><label>{mode === 'percent_remaining' || mode === 'remaining' || mode === 'balance' ? 'Remaining' : 'Used'}{mode.startsWith('percent') ? ' (%)' : ''}
        <input inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} placeholder="0" required /></label>
        {['counts', 'remaining', 'budget'].includes(mode) && <label>Limit (optional)<input inputMode="decimal" value={limit} onChange={e => setLimit(e.target.value)} placeholder="Unknown"/></label>}
        {['counts', 'remaining', 'usage'].includes(mode) && <label>Unit<input value={unit} onChange={e => setUnit(e.target.value)} required maxLength={30}/></label>}
      </div>}
      <label>Next reset (optional)<input type="datetime-local" value={reset} onChange={e => setReset(e.target.value)}/><small>{Intl.DateTimeFormat().resolvedOptions().timeZone} · {reset ? new Date(reset).toLocaleString() : 'Leave blank when unknown or not applicable.'}</small></label>
      <div className="quick-times">{[1, 5, 24].map(h => <button key={h} type="button" className="chip" onClick={() => setReset(localTime(new Date(Date.now() + h * 3600000).toISOString()))}>In {h}h</button>)}<button type="button" className="chip" onClick={() => setReset('')}>Clear reset</button></div>
      <details><summary>Observation & freshness</summary><div className="form-row"><label>Observed at<input type="datetime-local" value={observed} onChange={e => setObserved(e.target.value)} required/></label><label>Recheck after (hours)<input type="number" min="0.01" max="744" step="0.01" value={freshHours} onChange={e => setFreshHours(Number(e.target.value))} required/></label></div></details>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">{selected && <button type="button" className="button danger subtle" disabled={busy} onClick={() => void commit(source.metrics.filter(m => m.key !== selected))}><Trash2 size={15}/>Remove metric</button>}<button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save reading'}</button></div>
    </form>
  </Modal>;
}
