import { Coins, Cpu, Gauge, Sparkles, WifiOff, Zap, Database } from 'lucide-react';
import type { Balance } from '../lib/store';
export interface Stats { latencyMs: number; tokensPerSecond: number; tokens: number; }
export interface StatusBarProps { model: string; tier: string; mode: string; stats: Stats | null; balance: Balance; freeTier: boolean; backgroundWorker: boolean; busy: boolean; online: boolean; synced: boolean; }

export default function StatusBar({ model, tier, mode, stats, balance, freeTier, backgroundWorker, busy, online, synced }: StatusBarProps) {
  return <footer className="statusbar" aria-live="polite">
    {/* On the free tier the model's tier and its payment mode are the same word; say it once. */}
    <span className="status-model"><span className={busy ? 'dot live' : 'dot'} aria-hidden="true" />{model}<small>{tier === mode ? mode : `${tier} · ${mode}`}</small></span>
    <span className="status-metrics">
      <span title="Time to first token on the last request"><Gauge size={12} strokeWidth={1.75} />{stats ? `${stats.latencyMs} ms` : '— ms'}</span>
      <span title="Output speed on the last request"><Zap size={12} strokeWidth={1.75} />{stats && stats.tokensPerSecond ? `${stats.tokensPerSecond} tok/s` : '— tok/s'}</span>
      <span className={freeTier ? 'status-free' : undefined} title={freeTier
        ? `Free credits left this month (${balance.month}), metered by the server. Your own key draws none of these.`
        : `Platform credits remaining this month (${balance.month}); requests on your own key never draw credits`}>
        {freeTier ? <Sparkles size={12} strokeWidth={1.75} /> : <Coins size={12} strokeWidth={1.75} />}
        {balance.remaining.toLocaleString()} {freeTier ? 'free' : 'credits'}
      </span>
      {backgroundWorker && <span title="A Render background worker is online for heavier multi-step runs"><Cpu size={12} strokeWidth={1.75} />worker</span>}
      <span title={synced ? 'Sessions and ledger are saved on the server' : 'Server not reachable; saved in this browser only'}><Database size={12} strokeWidth={1.75} />{synced ? 'synced' : 'local'}</span>
      {!online && <span className="status-offline"><WifiOff size={12} strokeWidth={1.75} />offline</span>}
    </span>
  </footer>;
}
