import { Coins, Gauge, WifiOff, Zap, Database } from 'lucide-react';
import type { Balance } from '../lib/store';
export interface Stats { latencyMs: number; tokensPerSecond: number; tokens: number; }
export default function StatusBar({ model, tier, mode, stats, balance, busy, online, synced }: { model: string; tier: string; mode: string; stats: Stats | null; balance: Balance; busy: boolean; online: boolean; synced: boolean }) {
  return <footer className="statusbar" aria-live="polite">
    <span className="status-model"><span className={busy ? 'dot live' : 'dot'} aria-hidden="true" />{model}<small>{tier} · {mode}</small></span>
    <span className="status-metrics">
      <span title="Time to first token on the last request"><Gauge size={12} strokeWidth={1.75} />{stats ? `${stats.latencyMs} ms` : '— ms'}</span>
      <span title="Output speed on the last request"><Zap size={12} strokeWidth={1.75} />{stats && stats.tokensPerSecond ? `${stats.tokensPerSecond} tok/s` : '— tok/s'}</span>
      <span title={`Platform credits remaining this month (${balance.month}); BYOK requests never draw credits`}><Coins size={12} strokeWidth={1.75} />{balance.remaining.toLocaleString()} credits</span>
      <span title={synced ? 'Sessions and ledger are saved on the server' : 'Server not reachable; saved in this browser only'}><Database size={12} strokeWidth={1.75} />{synced ? 'synced' : 'local'}</span>
      {!online && <span className="status-offline"><WifiOff size={12} strokeWidth={1.75} />offline</span>}
    </span>
  </footer>;
}
