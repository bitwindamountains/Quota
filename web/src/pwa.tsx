import { useEffect, useState } from 'react';

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export function PwaControls() {
  const [prompt, setPrompt] = useState<InstallEvent>();
  const [message, setMessage] = useState('');
  const [installed, setInstalled] = useState(matchMedia('(display-mode: standalone)').matches);
  useEffect(() => {
    const ready = (event: Event) => { event.preventDefault(); setPrompt(event as InstallEvent); };
    const done = () => { setPrompt(undefined); setInstalled(true); setMessage(''); };
    window.addEventListener('beforeinstallprompt', ready);
    window.addEventListener('appinstalled', done);
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {
        setMessage('Offline help is unavailable. You can still use Quota while the server runs.');
      });
    }
    return () => { window.removeEventListener('beforeinstallprompt', ready); window.removeEventListener('appinstalled', done); };
  }, []);
  async function install() {
    if (!prompt) { setMessage('In Edge or Chrome, use the address-bar install icon or the browser menu to install Quota. Keep the local server running.'); return; }
    try { await prompt.prompt(); await prompt.userChoice; setPrompt(undefined); }
    catch { setMessage('Use your browser menu to install Quota.'); }
  }
  return <div className="pwa-controls">
    {!installed && <button className="text-button" onClick={() => void install()}>Install app</button>}
    {message && <div className="pwa-help" role="status"><p>{message}</p><button className="text-button" onClick={() => setMessage('')}>Dismiss</button></div>}
  </div>;
}
