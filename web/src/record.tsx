import { useState, type CSSProperties, type FormEvent } from 'react';
import { ArrowUpRight, ClipboardPaste, Trash2 } from 'lucide-react';
import { countdown, parseDuration, metricSchema, providerFor, type Metric, type Source } from '../../shared/model';
import { matchWindows, parseUsageText } from '../../shared/usage-text';
import { Modal } from './forms';
import { api } from './api';

const editable = (m: Metric) => m.unit === 'percent' && m.usedPercent !== null;
// Manual sources can always record (the first paste creates their windows); automatic ones need percentage windows.
export const recordable = (source: Source) => source.mode === 'manual' || source.metrics.some(editable);

// `exact` keeps a precise reset parsed from pasted text while its displayed countdown is unchanged.
type Row = { key: string; label: string; used: string; resetsIn: string; exact?: { text: string; iso: string }; added?: boolean; metric?: Metric };
const rowFor = (m: Metric, now: number): Row => ({ key: m.key, label: m.label, metric: m,
  used: String(Math.round(Number(m.usedPercent) * 100) / 100), resetsIn: m.resetAt && Date.parse(m.resetAt) > now ? countdown(m.resetAt, now) : '' });

// Quick, consistent entry of what the provider's usage page shows, for every window at once.
// In a catch-up queue, `next` moves to the following source after saving or skipping; `close` ends the queue.
export function RecordReading({ source, close, saved, step, next }: { source: Source; close: () => void; saved: () => Promise<void>; step?: { index: number; total: number }; next?: () => void }) {
  const provider = providerFor(source.provider), manual = source.mode === 'manual';
  const [rows, setRows] = useState<Row[]>(() => source.metrics.filter(editable).map(m => rowFor(m, Date.now())));
  const [pasted, setPasted] = useState(''), [pasteNote, setPasteNote] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const change = (key: string, patch: Partial<Row>) => setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row));
  function applyPaste(text: string) {
    setPasted(text);
    if (!text.trim()) { setPasteNote(''); return; }
    const now = Date.now(), parsed = parseUsageText(text, now);
    if (!parsed.length) { setPasteNote('No usage percentages found. Copy the whole usage page (Ctrl+A, then Ctrl+C) and paste again, or type the values below.'); return; }
    const { matched, unmatched } = matchWindows(source.metrics.filter(editable), parsed);
    const shown = (iso: string | null) => iso ? { resetsIn: countdown(iso, now), exact: { text: countdown(iso, now), iso } } : { resetsIn: '', exact: undefined };
    setRows(current => {
      const next = current.map(row => { const hit = matched.get(row.key); return hit ? { ...row, used: String(hit.usedPercent), ...shown(hit.resetAt) } : row; });
      if (manual) for (const window of unmatched) next.push({ key: 'manual:' + crypto.randomUUID(), label: window.label.slice(0, 80), used: String(window.usedPercent), added: true, ...shown(window.resetAt) });
      return next;
    });
    const skipped = manual ? 0 : unmatched.length;
    setPasteNote('Filled ' + (matched.size + (manual ? unmatched.length : 0)) + ' of ' + parsed.length + ' windows found. Check the values below, then save.' + (skipped ? ' ' + skipped + ' extra ' + (skipped === 1 ? 'window was' : 'windows were') + ' not tracked by this source.' : ''));
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      if (!rows.length) throw new Error('Paste the usage page or add values first.');
      const observedAt = new Date().toISOString();
      const updated = rows.map(row => {
        const used = Number(row.used);
        if (!row.used.trim() || !Number.isFinite(used) || used < 0 || used > 100) throw new Error(row.label + ': enter a percentage from 0 to 100.');
        const resetAt = row.exact && row.exact.text === row.resetsIn ? row.exact.iso : (() => { const ms = parseDuration(row.resetsIn); return ms ? new Date(Date.now() + ms).toISOString() : null; })();
        const base = row.metric ?? { key: row.key, label: row.label, kind: 'quota', unit: 'percent', resetKind: 'unknown', freshnessSeconds: 86400 };
        return metricSchema.parse({ ...base, label: row.label, usedPercent: String(used), used: null, remaining: null, limit: null, allowance: 'finite', limitState: 'unknown',
          resetAt, resetKind: resetAt ? base.resetKind === 'none' || base.resetKind === 'unknown' ? 'fixed' : base.resetKind : 'unknown', resetBasis: resetAt ? 'user_entered' : 'unknown',
          observedAt, provenance: 'user_entered' });
      });
      const keys = new Set(updated.map(m => m.key));
      const metrics = [...source.metrics.filter(m => !keys.has(m.key)), ...updated];
      await api('/sources/' + source.id + '/manual', 'PUT', { revision: source.revision, metrics });
      await saved(); (next ?? close)();
    } catch (e) { setError(e instanceof Error && 'issues' in e ? 'Check the values: percentages must be between 0 and 100.' : (e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title={'Record ' + source.name + ' reading'} subtitle={(step ? step.index + ' of ' + step.total + ' · ' : '') + (manual ? 'Paste or type what ' + provider.name + ' shows.' : 'Copy what ' + provider.name + ' shows. Newer automatic reports replace it.')} close={close}>
    <form onSubmit={e => void submit(e)} className="form record-form">
      {provider.url && <a className="text-button record-link" href={provider.url} target="_blank" rel="noreferrer">Open {provider.name} usage page<ArrowUpRight size={15}/></a>}
      <label className="paste-box"><span><ClipboardPaste size={15}/>Paste the usage page</span>
        <textarea value={pasted} rows={3} onChange={e => applyPaste(e.target.value)} placeholder="On the usage page press Ctrl+A, then Ctrl+C, and paste here. Numbers fill in below."/>
        {pasteNote && <small role="status">{pasteNote}</small>}</label>
      {rows.map(row => <fieldset key={row.key} className={'record-row' + (row.added ? ' added' : '')}><legend>{row.label}{row.added && <span className="mini-tag">New</span>}</legend>
        <div className="record-slider"><input type="range" min={0} max={100} step={1} value={Number(row.used) || 0} aria-label={row.label + ' percent used slider'} onChange={e => change(row.key, { used: e.target.value })}
          style={{ '--fill': (Number(row.used) || 0) + '%' } as CSSProperties}/>
          <label>Used (%)<input inputMode="decimal" value={row.used} onChange={e => change(row.key, { used: e.target.value })} required/></label></div>
        <label>Resets in<input value={row.resetsIn} onChange={e => change(row.key, { resetsIn: e.target.value })} placeholder="e.g. 3h 12m or 2d 5h"/><small>Leave blank if the page shows no reset time.</small></label>
        {row.added && <button type="button" className="text-button danger-text" onClick={() => setRows(current => current.filter(r => r.key !== row.key))}><Trash2 size={14}/>Don't add this window</button>}
      </fieldset>)}
      {!rows.length && <p className="form-note">No windows yet. Paste the usage page above to create them, or use the pencil on the card for other kinds of readings.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={next ?? close}>{next ? 'Skip' : 'Cancel'}</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : step && step.index < step.total ? 'Save and next' : 'Save reading'}</button></div>
    </form>
  </Modal>;
}
