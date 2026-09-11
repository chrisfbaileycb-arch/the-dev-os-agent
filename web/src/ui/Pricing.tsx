import { ArrowUpRight, Check, KeyRound, Sparkles, Zap } from 'lucide-react';
import { REFERRAL_ALLOWANCE, REFERRAL_DISCLOSURE, referralEnabled, referralLink } from '../lib/referral';
import type { Balance, FreeTier } from '../lib/store';

// Plans, in a three-card layout.
//
// One thing here is deliberately not what a pricing page usually is. Hey Buddy has no billing:
// it never takes a payment, holds no subscription, and has no account to upgrade. The two
// right-hand cards describe a key you buy FROM XKIRO and paste in here — so they say that,
// rather than "Upgrade Plan" over a button that silently leaves for someone else's checkout.
// A visitor who pays xKiro believing they upgraded Hey Buddy has been misled, and the wording
// below is what prevents that while keeping the layout and the referral intact.
//
// Only the left card is a Hey Buddy plan, and it is genuinely free: the deployment funds it.

export interface PricingProps { free: FreeTier; freeBalance: Balance; onStart: () => void; onAddKey: () => void; }

interface Tier {
  id: string; name: string; price: string; cadence: string; billedBy: string;
  icon: typeof Sparkles; featured?: boolean; blurb: string; features: string[];
  cta: string; action: 'start' | 'key' | 'referral';
}

export default function Pricing(p: PricingProps) {
  const pool = p.free.models.length ? `${p.free.models.length} models` : 'a shared pool';
  const tiers: Tier[] = [
    {
      id: 'free', name: 'Free', price: '$0', cadence: 'always', billedBy: 'Included — nothing to pay',
      icon: Sparkles, featured: true,
      blurb: 'The whole workspace, on models this deployment pays for. No account, no card, no API key.',
      features: [
        `${pool} from the shared xKiro pool — GLM, DeepSeek, Qwen, Kimi`,
        `${p.free.monthlyCredits.toLocaleString()} credits a month, metered on the server`,
        `${p.free.perHour} requests an hour`,
        'Every agent, workflow and connector',
        'Notes and documents stay in your browser',
      ],
      cta: 'Start now', action: 'start',
    },
    {
      id: 'pro', name: 'Pro', price: 'Your key', cadence: 'billed by xKiro', billedBy: 'Paid to xKiro, not to Hey Buddy',
      icon: KeyRound,
      blurb: 'Bring an xKiro key and the allowance above stops applying. Hey Buddy takes no payment for this.',
      features: [
        'No monthly credit ceiling here — your provider sets the limits',
        'The same models, plus everything else your key can reach',
        'Deep reasoning: Claude 3.5 Sonnet, DeepSeek R1, GPT-4o',
        'Your key stays in your browser; never stored on our server',
      ],
      cta: 'Get an API key', action: 'referral',
    },
    {
      id: 'ultimate', name: 'Ultimate', price: 'Your key', cadence: 'billed by xKiro', billedBy: 'Paid to xKiro, not to Hey Buddy',
      icon: Zap,
      blurb: 'The same Hey Buddy, on a larger xKiro plan. What changes is their rate limit, not our features.',
      features: [
        'Higher throughput and priority routing on xKiro',
        'Longer context windows where the model supports them',
        'Everything in Pro',
        'Already have a key? Paste it in Settings — no plan needed',
      ],
      cta: 'Compare xKiro plans', action: 'referral',
    },
  ];

  return <div className="page">
    <div className="page-head"><div>
      <h1>Plans</h1>
      <p>Hey Buddy itself is free and takes no payment. What you can pay for is inference — the model calls — and that is billed by the provider whose key you use.</p>
    </div></div>

    <div className="plan-grid">
      {tiers.map(t => <section key={t.id} className={t.featured ? 'plan featured' : 'plan'}>
        {t.featured && <span className="plan-flag">Active now</span>}
        <div className="plan-head">
          <span className="plan-icon"><t.icon size={17} strokeWidth={1.75} /></span>
          <h2>{t.name}</h2>
        </div>
        <p className="plan-price"><strong>{t.price}</strong><small>{t.cadence}</small></p>
        <p className="plan-billed">{t.billedBy}</p>
        <p className="plan-blurb">{t.blurb}</p>
        <ul className="plan-features">{t.features.map(f => <li key={f}><Check size={13} strokeWidth={2.25} />{f}</li>)}</ul>
        {t.action === 'start'
          ? <button className="button primary plan-cta" onClick={p.onStart}>{t.cta}</button>
          : t.action === 'key'
            ? <button className="button plan-cta" onClick={p.onAddKey}>{t.cta}</button>
            : referralEnabled()
              ? <a className="button plan-cta" {...referralLink()}>{t.cta}<ArrowUpRight size={14} /></a>
              : <button className="button plan-cta" onClick={p.onAddKey}>Add your key in Settings</button>}
        {t.action === 'referral' && referralEnabled() && <small className="plan-disclosure">{REFERRAL_DISCLOSURE}</small>}
      </section>)}
    </div>

    <section className="panel">
      <h2>What you are actually buying</h2>
      <p className="help">
        Only the Free plan is ours to give: this deployment funds it from its own xKiro key, and the
        credits on the left are what it will spend on you each month. <strong>Pro and Ultimate are xKiro's
        plans, not ours.</strong> Following either button takes you to xKiro, you buy a key from them, and
        you paste it into Settings here. No money reaches Hey Buddy, there is nothing to cancel with us,
        and the app works identically either way — the difference is only who pays for the model calls.
      </p>
      {referralEnabled() && <p className="help">
        {REFERRAL_DISCLOSURE} It costs you nothing extra, and
        you are equally welcome to go to xKiro directly, or to use a Groq, OpenRouter or custom key
        instead — the model dropdown treats them all the same. xKiro advertises {REFERRAL_ALLOWANCE} on
        a free account; that is their claim about their own product, so check it on their site before
        relying on it.
      </p>}
      <p className="help">
        Running low on free credits does not lock anything: the workspace, your sessions and your
        documents stay exactly as they are, and adding a key picks up where the allowance left off.
      </p>
    </section>
  </div>;
}
