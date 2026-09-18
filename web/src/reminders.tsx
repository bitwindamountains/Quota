import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Bell, Volume2 } from 'lucide-react';
import type { Metric, Source } from '../../shared/model';
import type { Alarm, ReminderState } from '../../shared/reminders';
import { api } from './api';
import { Modal } from './forms';

let sound: AudioContext | undefined;
async function enableSound() {
  try { sound ??= new AudioContext(); await sound.resume(); } catch { /* Visual reminders remain available. */ }
}
function chime() {
  if (!sound || sound.state !== 'running') return;
  for (const [offset, frequency] of [[0, 660], [0.25, 880], [0.5, 660]]) {
    const oscillator = sound.createOscillator(), gain = sound.createGain(), at = sound.currentTime + offset;
    oscillator.frequency.value = frequency; gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.12, at + 0.02); gain.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
    oscillator.connect(gain); gain.connect(sound.destination); oscillator.start(at); oscillator.stop(at + 0.24);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
}
export function useResetReminders(active: boolean) {
  const [state, setState] = useState<ReminderState>({ alarms: [], events: [], emailConfigured: false });
  const [error, setError] = useState('');
  const current = useRef(active); current.current = active;
  const refresh = useCallback(async () => {
    const value = await api<ReminderState>('/reminders');
    if (current.current) { setState(value); setError(''); }
    return value;
  }, []);
  useEffect(() => {
    if (!active) return;
    let live = true, busy = false;
    const check = async () => {
      if (busy) return; busy = true;
      try {
        const value = await refresh();
        if (!live || !current.current) return;
        let played = false;
        for (const event of value.events.filter(e => !e.notified && !e.dismissed && Date.now() - Date.parse(e.dueAt) <= 86400000)) {
          const result = await api<{ claimed: boolean }>('/reminders/' + event.id + '/claim', 'POST', {});
          if (!live || !current.current || !result.claimed) continue;
          if (!played) { chime(); played = true; }
          if ('Notification' in window && Notification.permission === 'granted') {
            try { new Notification('Reset reminder: ' + event.sourceName, { body: event.metricLabel + ' reached its tracked reset time. Check the provider.', tag: event.id }); } catch { /* The inbox is the fallback. */ }
          }
        }
      } catch { if (live) setError('Reminders could not be checked. Reconnect the dashboard.'); }
      finally { busy = false; }
    };
    void check(); const timer = setInterval(() => void check(), 5000);
    return () => { live = false; clearInterval(timer); };
  }, [active, refresh]);
  return { state: active ? state : { alarms: [], events: [], emailConfigured: false } as ReminderState, refresh, error: active ? error : '' };
}

export function AlarmForm({ source, metric, alarm, emailConfigured, close, saved }: { source: Source; metric: Metric; alarm?: Alarm; emailConfigured: boolean; close: () => void; saved: () => Promise<unknown> }) {
  const [enabled, setEnabled] = useState(alarm?.enabled ?? true);
  const [emailOn, setEmailOn] = useState(!!alarm?.email), [email, setEmail] = useState(alarm?.email ?? '');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [soundStatus, setSoundStatus] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    await enableSound();
    try {
      await api('/sources/' + source.id + '/alarm', 'PUT', { revision: alarm?.revision ?? 0, sourceRevision: source.revision, metricKey: metric.key, enabled, email: emailOn ? email : null });
      await saved(); close();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title={'Reset alarm — ' + source.name} subtitle={metric.label} close={close}>
    <form className="form" onSubmit={e => void submit(e)}>
      <p className="form-note">{metric.resetAt ? 'Tracked reset: ' + new Date(metric.resetAt).toLocaleString() : 'No reset time is currently known.'} An alarm reminds you to check the provider; it does not confirm replenishment.</p>
      <label className="check"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}/> Alarm on this reset window</label>
      <p className="form-note">Follows new reset times when this window is updated. Works with any known reset: hours, daily, weekly or monthly. Manual windows need a new reset time after each occurrence.</p>
      <label className="check"><input type="checkbox" checked={emailOn} disabled={!emailConfigured && !emailOn} onChange={e => setEmailOn(e.target.checked)}/> Email reminder</label>
      {emailOn && <label>Reminder email address<input type="email" maxLength={254} required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></label>}
      {!emailConfigured && <p className="form-note">Email needs SMTP setup in the server .env: QUOTA_SMTP_HOST, QUOTA_SMTP_PORT (587 or 465), QUOTA_SMTP_USER, QUOTA_SMTP_PASSWORD and QUOTA_SMTP_FROM. Restart the server after setup. See docs/reset-reminders.md.</p>}
      <p className="form-note">Keep the server running for reminders. Keep this dashboard open for sound and desktop alerts. Email includes the tool name, window label and reset time, sent through your configured mail provider.</p>
      <div className="reminder-controls"><button type="button" className="button secondary" onClick={() => void enableSound().then(() => { chime(); setSoundStatus(sound?.state === 'running' ? 'Sound enabled for this tab.' : 'Sound is blocked by this browser. Visual reminders remain enabled.'); })}><Volume2 size={16}/>Enable / test sound</button>
        <button type="button" className="button secondary" onClick={() => { if ('Notification' in window) void Notification.requestPermission().then(p => setSoundStatus(p === 'granted' ? 'Desktop alerts enabled.' : 'Desktop alerts unavailable or blocked. Visual reminders remain enabled.')); else setSoundStatus('Desktop alerts are not supported in this browser.'); }}><Bell size={16}/>Enable desktop alerts</button></div>
      {soundStatus && <p role="status">{soundStatus}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="modal-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save alarm'}</button></div>
    </form>
  </Modal>;
}

export function ReminderInbox({ state, close, refresh }: { state: ReminderState; close: () => void; refresh: () => Promise<unknown> }) {
  const [error, setError] = useState(''), [soundStatus, setSoundStatus] = useState('');
  const labels = { none: 'In-app reminder', pending: 'Email queued', sending: 'Sending email', sent: 'Email accepted by mail server', failed: 'Email failed', uncertain: 'Email delivery unconfirmed', expired: 'Email skipped: over 24 hours late', cancelled: 'Email cancelled' };
  return <Modal title="Reset reminders" subtitle="Recent reset alarms on this device" close={close}><div className="form">
    <p className="form-note">Set an alarm beside a reset time on any tool card. Email setup: {state.emailConfigured ? 'configured' : 'not configured — see docs/reset-reminders.md'}. The server must stay running; sound needs an open tab and browser permission to play.</p>
    <button className="button secondary" onClick={() => void enableSound().then(() => { chime(); setSoundStatus(sound?.state === 'running' ? 'Sound enabled for this tab.' : 'Sound is blocked. Visual reminders remain available.'); })}><Volume2 size={16}/>Enable / test sound</button>
    {soundStatus && <p role="status">{soundStatus}</p>}
    {!state.events.length && <p>No reset alarms have fired yet.</p>}
    {state.events.map(event => <section className="reminder-event" key={event.id}><strong>{event.sourceName} · {event.metricLabel}</strong><p>Tracked reset: {new Date(event.dueAt).toLocaleString()}</p><small>{labels[event.emailState]}</small>{event.emailError && <p className="error">{event.emailError}</p>}{event.dismissed ? <small>Dismissed</small> : <button className="text-button" onClick={() => void api('/reminders/' + event.id + '/dismiss', 'POST', {}).then(refresh).catch(() => setError('Could not dismiss this reminder. Try again.'))}>Dismiss reminder</button>}</section>)}
    {error && <p role="alert" className="error">{error}</p>}
  </div></Modal>;
}
