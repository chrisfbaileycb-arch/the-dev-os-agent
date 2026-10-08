import { useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound, LoaderCircle, LockKeyhole } from 'lucide-react';
import { checkPasscode, configuredHash, grant, isGranted, revoke, usingDevFallback } from '../lib/betaGate';
import { BETA_DEV_PASSCODE } from '../lib/betaHash.mjs';

// Signal Forge OS — Private Beta Access.
//
// Wraps the whole application. Until the passcode is accepted, the workspace is not rendered at
// all — not hidden behind an overlay, but never mounted — so none of its effects run: no provider
// discovery, no workspace sync, no model dock, nothing to tab into. Locking unmounts it again,
// which aborts any stream or plan in flight through the workspace's own cleanup.

export default function BetaGate({ children }: { children: (lock: () => void) => ReactNode }) {
  const [granted, setGranted] = useState(isGranted);
  const [passcode, setPasscode] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const configured = Boolean(configuredHash());

  const lock = () => { revoke(); setPasscode(''); setError(''); setGranted(false); };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!passcode.trim() || checking) return;
    setChecking(true); setError('');
    const ok = await checkPasscode(passcode);
    setChecking(false);
    if (ok) { grant(); setPasscode(''); setGranted(true); }
    else { setError('That passcode was not accepted.'); setPasscode(''); }
  }

  if (granted && configured) return <>{children(lock)}</>;

  return <main className="beta-gate">
    <form className="beta-card" onSubmit={e => void submit(e)} aria-labelledby="beta-title">
      <div className="beta-mark"><LockKeyhole size={20} strokeWidth={1.75} /></div>
      <h1 id="beta-title">Signal Forge OS <span>— Private Beta Access</span></h1>
      <p>This workspace is in a closed beta. Enter the access passcode you were given to continue.</p>
      {configured ? <>
        <label htmlFor="beta-passcode" className="sr-only">Access passcode</label>
        <div className="beta-field">
          <KeyRound size={15} strokeWidth={1.75} />
          <input id="beta-passcode" type="password" autoComplete="current-password" autoFocus spellCheck={false} value={passcode} disabled={checking} placeholder="Access passcode" onChange={e => { setPasscode(e.target.value); setError(''); }} aria-invalid={Boolean(error)} aria-describedby={error ? 'beta-error' : undefined} />
        </div>
        {error && <p id="beta-error" className="beta-error" role="alert">{error}</p>}
        <button type="submit" className="beta-submit" disabled={!passcode.trim() || checking}>{checking ? <LoaderCircle size={15} className="spin" /> : null}{checking ? 'Checking…' : 'Enter workspace'}</button>
        {usingDevFallback() && <p className="beta-note">Development build: <code>VITE_BETA_ACCESS_KEY</code> is unset, so the passcode is <code>{BETA_DEV_PASSCODE}</code>.</p>}
      </> : <p className="beta-error" role="alert">Access is not configured for this deployment. The operator needs to set <code>VITE_BETA_ACCESS_KEY</code> and rebuild.</p>}
    </form>
  </main>;
}
