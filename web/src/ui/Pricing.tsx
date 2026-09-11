import { ArrowUpRight, Check, KeyRound, Sparkles, Zap } from 'lucide-react';
import { REFERRAL_ALLOWANCE, REFERRAL_DISCLOSURE, referralEnabled, referralLink } from '../lib/referral';
import type { Billing, BillingPlan } from '../lib/deployment';
import type { Balance, FreeTier } from '../lib/store';

// Plans, in a three-card layout.
//
// Two income streams, and they are deliberately not presented as one. Starter and Premium are
// Hey Buddy's own subscriptions, paid to Hey Buddy, and they are the product. The xKiro referral
// is a secondary note for the people who were never going to subscribe anyway — developers who
// already hold keys and want to keep using them. Putting the referral beside the paid cards
// would compete with the thing actually being sold.
//
// One honesty constraint runs through this file. A Subscribe button is a request for money, so
// it is only rendered as one when this deployment actually has somewhere to send the payment:
// `plan.checkout` comes from the server and is null until the operator configures a checkout URL.
// Unconfigured, the card keeps its price and its features and says checkout is not open yet —
// taking someone's intent to pay and dropping it into a dead link is worse than saying so.

export interface PricingProps {
  free: FreeTier; billing: Billing; freeBalance: Balance;
  onStart: () => void; onAddKey: () => void;
}

interface Tier {
  id: string; name: string; price: string; cadence: string; billedBy: string;
  icon: typeof Sparkles; featured?: boolean; blurb: string; features: string[];
  cta: string; action: 'start' | 'subscribe';
}

const PRICES: Record<string, { price: string; cadence: string }> = {
  starter: { price: '$12.90', cadence: 'per month' },
  premium: { price: '$24.90', cadence: 'per month' },
};

export default function Pricing(p: PricingProps) {
  const pool = p.free.models.length ? `${p.free.models.length} models` : 'a shared pool';
  const plan = (id: string): BillingPlan | undefined => p.billing.plans.find(x => x.id === id);
  const priced = (id: string) => plan(id) ?? { id, name: id, ...PRICES[id], checkout: null };

  const tiers: Tier[] = [
    {
      id: 'free', name: 'Free', price: '$0', cadence: 'always', billedBy: 'No card, no account',
      icon: Sparkles,
      blurb: 'The whole workspace on models this deployment pays for. Nothing to set up and nothing to cancel.',
      features: [
        `${pool} from the shared pool — GLM, DeepSeek, Qwen, Kimi, Llama`,
        `${p.free.monthlyCredits.toLocaleString()} credits a month, metered on the server`,
        `${p.free.perHour} requests an hour`,
        'Every agent, workflow and connector',
        'Notes and documents stay in your browser',
      ],
      cta: 'Start now', action: 'start',
    },
    {
      id: 'starter', name: 'Starter', price: priced('starter').price, cadence: priced('starter').cadence,
      billedBy: 'Billed by Hey Buddy', icon: KeyRound, featured: true,
      blurb: 'The managed pool. You never touch an API key — we hold the provider accounts and meter your usage against your plan.',
      features: [
        'A far larger monthly credit allowance than the free tier',
        'No per-hour request cap',
        'Every model in the hub, reasoning models included',
        'No API keys to create, paste, rotate or pay separately for',
        'Priority on the shared pool when it is busy',
      ],
      cta: 'Subscribe', action: 'subscribe',
    },
    {
      id: 'premium', name: 'Premium', price: priced('premium').price, cadence: priced('premium').cadence,
      billedBy: 'Billed by Hey Buddy', icon: Zap,
      blurb: 'Starter with room to work at length: longer runs, bigger documents, more of the expensive models.',
      features: [
        'Roughly triple the Starter allowance',
        'Highest output limits and longest context windows',
        'Multi-agent workflows without watching the meter',
        'Everything in Starter',
        'Your own key still works alongside it, at no cost to your allowance',
      ],
      cta: 'Upgrade', action: 'subscribe',
    },
  ];

  return <div className="page">
    <div className="page-head"><div>
      <h1>Plans</h1>
      <p>Start free with no account at all. Subscribe when you want the managed pool — a larger allowance on every model, with no API keys to manage.</p>
    </div></div>

    <div className="plan-grid">
      {tiers.map(t => {
        const checkout = t.action === 'subscribe' ? plan(t.id)?.checkout ?? null : null;
        return <section key={t.id} className={t.featured ? 'plan featured' : 'plan'}>
          {t.featured && <span className="plan-flag">Most popular</span>}
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
            : checkout
              ? <a className={t.featured ? 'button primary plan-cta' : 'button plan-cta'} href={checkout} rel="noopener">{t.cta}</a>
              : <button className="button plan-cta" disabled title="Checkout is not open on this deployment yet.">Checkout opening soon</button>}
          {t.action === 'subscribe' && !checkout && <small className="plan-disclosure">Not taking payment yet. The free tier below is live now.</small>}
        </section>;
      })}
    </div>

    <section className="panel">
      <h2>What a subscription changes</h2>
      <p className="help">
        Only one thing, really: <strong>who holds the API keys and who pays the model bill.</strong> On the free
        tier and on a paid plan alike, Hey Buddy runs the models for you and meters what you use — a plan
        simply raises the ceiling and unlocks the expensive models. Bring your own key instead and the app
        works identically, except your provider bills you directly and no allowance is touched at all.
        The interface, the agents, the workflows and the connectors are the same in every case.
      </p>
      {referralEnabled() && <p className="help referral-note">
        <ArrowUpRight size={12} strokeWidth={1.75} />
        <span>
          Developer, or prefer your own direct API key?{' '}
          <a {...referralLink()}>Get {REFERRAL_ALLOWANCE} on xKiro with our partner link</a>
          {' — '}{REFERRAL_DISCLOSURE} That is xKiro's figure for their own service, worth checking on their
          site; a Groq, OpenRouter, OpenAI, Anthropic or Google key works here just as well.
        </span>
      </p>}
      <p className="help">
        Running out of credits never locks anything. The workspace, your sessions and your documents stay
        exactly as they are, and adding a key or a plan picks up where the allowance left off.
      </p>
    </section>
  </div>;
}
