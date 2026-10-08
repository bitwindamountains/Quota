import { useEffect, useState, type CSSProperties } from 'react';
import { Check, LoaderCircle, Radar } from 'lucide-react';
import { minimumPoll } from '../../shared/integrations';
import { providerFor, type Source } from '../../shared/model';
import { Modal } from './forms';
import { api } from './api';

export type Candidate = { provider: Source['provider']; name: string; mode: 'automatic' | 'manual'; found: string; environment?: string };
type Progress = 'waiting' | 'adding' | 'added' | string;

// Adds one detected tool using the same endpoints and order as the source dialog.
async function addCandidate(c: Candidate) {
  const data = { provider: c.provider, name: c.name, scope: 'Personal', mode: c.mode, pollSeconds: minimumPoll(c.provider), enabled: true };
  if (!c.environment) { await api<Source>('/sources', 'POST', data); return; }
  const created = await api<Source>('/sources', 'POST', { ...data, mode: 'manual' });
  const credential = await api<{ revision: number }>('/sources/' + created.id + '/credential', 'PUT', { revision: created.revision, credential: { method: 'environment', variable: c.environment } });
  await api('/sources/' + created.id, 'PATCH', { revision: credential.revision, source: data });
}

export function ScanDialog({ close, saved }: { close: () => void; saved: () => Promise<void> }) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null), [error, setError] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set()), [progress, setProgress] = useState<Record<string, Progress>>({});
  const [busy, setBusy] = useState(false), [done, setDone] = useState(false), [disabled, setDisabled] = useState(false);
  useEffect(() => {
    let live = true;
    void api<{ candidates: Candidate[]; disabled?: boolean }>('/scan').then(result => { if (!live) return; setDisabled(!!result.disabled); setCandidates(result.candidates); setChosen(new Set(result.candidates.map(c => c.provider))); })
      .catch(e => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, []);
  async function addAll() {
    if (!candidates) return;
    setBusy(true);
    for (const c of candidates.filter(c => chosen.has(c.provider))) {
      setProgress(p => ({ ...p, [c.provider]: 'adding' }));
      try { await addCandidate(c); setProgress(p => ({ ...p, [c.provider]: 'added' })); }
      catch (e) { setProgress(p => ({ ...p, [c.provider]: (e as Error).message })); }
    }
    await saved(); setBusy(false); setDone(true);
  }
  const toggle = (provider: string) => setChosen(current => { const next = new Set(current); if (next.has(provider)) next.delete(provider); else next.add(provider); return next; });
  return <Modal title="Scan this computer" subtitle="Finds installed AI tools and configured keys. Only file names are checked; nothing is read or sent." close={close}>
    <div className="form scan-body">
      {!candidates && !error && <div className="scan-radar" role="status"><Radar size={30}/><span>Looking for tools…</span></div>}
      {error && <p className="error" role="alert">{error}</p>}
      {disabled && <p className="form-note" role="status">Detection is turned off on this computer (QUOTA_SCAN=off). Add tools manually instead.</p>}
      {candidates && !candidates.length && !disabled && <p className="form-note" role="status">No new tools found. Everything detected is already on your dashboard. You can still add any tool manually.</p>}
      {candidates && candidates.length > 0 && <ul className="scan-list">{candidates.map((c, i) => {
        const state = progress[c.provider], failed = state && !['adding', 'added', 'waiting'].includes(state);
        return <li key={c.provider} className={'scan-item' + (state === 'added' ? ' added' : '') + (failed ? ' failed' : '')} style={{ '--i': i } as CSSProperties}>
          <label><input type="checkbox" checked={chosen.has(c.provider)} disabled={busy || done} onChange={() => toggle(c.provider)}/>
            <span className="tool-logo small" style={{ '--tool-color': providerFor(c.provider).color } as CSSProperties} aria-hidden="true">{providerFor(c.provider).mark}</span>
            <span className="scan-text"><strong>{c.name}</strong><small>{c.found}</small>{failed && <small className="scan-error">{state}</small>}</span>
            <span className={'badge' + (c.mode === 'automatic' ? ' automatic' : '')}><i/>{c.mode === 'automatic' ? 'Automatic' : 'Manual'}</span>
            <span className="scan-state" aria-live="polite">{state === 'adding' ? <LoaderCircle size={16} className="spin" aria-label="Adding"/> : state === 'added' ? <Check size={16} aria-label="Added"/> : null}</span>
          </label></li>;
      })}</ul>}
      {candidates && candidates.some(c => c.mode === 'manual') && !done && <p className="form-note">Manual tools have no reporting API on this computer. Record readings from each provider's usage page with the pencil on its card.</p>}
      <div className="modal-actions">
        <button type="button" className="button secondary" onClick={close}>{done ? 'Close' : 'Cancel'}</button>
        {!done && candidates && candidates.length > 0 && <button type="button" className="button primary" disabled={busy || !chosen.size} onClick={() => void addAll()}>{busy ? 'Adding…' : 'Add ' + chosen.size + (chosen.size === 1 ? ' tool' : ' tools')}</button>}
      </div>
    </div>
  </Modal>;
}
