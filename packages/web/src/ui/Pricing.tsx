import { Check, HardDrive, KeyRound, Sparkles, Zap } from 'lucide-react';
import type { Billing, BillingPlan } from '../lib/deployment';
import type { Balance, FreeTier } from '../lib/store';

export interface PricingProps {
  free: FreeTier; billing: Billing; freeBalance: Balance;
  onStart: () => void; onAddKey: () => void;
}
// Offline copy only. Once the server answers, its limits replace these defaults.
const DEFAULT_PLANS: BillingPlan[] = [
  { id: 'starter', name: 'Starter', price: '$25', cadence: 'per month', monthlyCredits: 1000, maxOutputTokens: 16384, checkout: null },
  { id: 'premium', name: 'Builder', price: '$50', cadence: 'per month', monthlyCredits: 2500, maxOutputTokens: 32768, checkout: null },
  { id: 'pro', name: 'Studio', price: '$100', cadence: 'per month', monthlyCredits: 6000, maxOutputTokens: 65536, checkout: null },
];
export default function Pricing(p: PricingProps) {
  const plans = DEFAULT_PLANS.map(fallback => p.billing.plans.find(x => x.id === fallback.id) ?? fallback);
  return <div className="page">
    <div className="page-head"><div><h1>Plans</h1><p>One monthly price for the connected US provider models in our managed hub. Choose how much room you need for chat, builds, and DevOps workflows.</p></div></div>
    <div className="plan-grid">
      {plans.map((plan, index) => <section key={plan.id} className={index === 1 ? 'plan featured' : 'plan'}>
        {index === 1 && <span className="plan-flag">For regular builders</span>}
        <div className="plan-head"><span className="plan-icon">{index === 0 ? <KeyRound size={17} /> : index === 1 ? <Zap size={17} /> : <Sparkles size={17} />}</span><h2>{plan.name}</h2></div>
        <p className="plan-price"><strong>{plan.price}</strong><small>{plan.cadence}</small></p>
        <p className="plan-billed">Billed by Signal Forge OS</p>
        <p className="plan-blurb">{index === 0 ? 'For everyday chat and your first builds.' : index === 1 ? 'More room for regular app builds and longer workflows.' : 'Our largest allowance for sustained builds and development work.'}</p>
        <ul className="plan-features">{[
          `${(plan.monthlyCredits ?? 0).toLocaleString()} credits per month`,
          `Up to ${(plan.maxOutputTokens ?? 16384).toLocaleString()} output tokens per reply`,
          'All connected, published US provider models',
          'Chat, Build, Plan, agents, and connectors',
          'Personal API keys in Settings',
          'Local model toggle for Ollama and LM Studio',
        ].map(feature => <li key={feature}><Check size={13} />{feature}</li>)}</ul>
        {plan.checkout ? <a className={index === 1 ? 'button primary plan-cta' : 'button plan-cta'} href={plan.checkout} rel="noopener">Subscribe</a>
          : <button className="button plan-cta" disabled title="Checkout has not been configured for this plan.">Checkout opening soon</button>}
        {!plan.checkout && <small className="plan-disclosure">This plan is not taking payment yet.</small>}
      </section>)}
    </div>
    <section className="panel">
      <h2>How your allowance works</h2>
      <p className="help">Your monthly price includes a defined credit allowance, shared across managed US models. Credits measure usage; they are not dollars or a fixed token count. Model classes consume credits at different rates, and output costs more credits than input. Unused credits reset at the start of each calendar month. The same published managed models are available on every paid tier; availability depends on connected provider accounts.</p>
      <p className="help">Use a personal API key or run a model on your computer to continue without spending plan credits. Your provider bills personal-key usage separately. Local inference uses your computer’s resources. Your sessions and builds remain accessible when an allowance runs out.</p>
      <div className="row gap"><button className="button small" onClick={p.onAddKey}><HardDrive size={13} />Connect your own key or local model</button></div>
    </section>
    <section className="panel">
      <h2><Sparkles size={15} />Try the workspace</h2>
      <p className="help">{p.free.enabled ? `${p.free.monthlyCredits.toLocaleString()} free credits per month on ${p.free.models.length} connected models, with ${p.free.perHour} requests per hour per network.` : 'Connect your own API key or local model to try the workspace. Managed free access is not currently available.'}</p>
      <button className="button primary small" onClick={p.free.enabled ? p.onStart : p.onAddKey}>{p.free.enabled ? 'Start free' : 'Open Settings'}</button>
    </section>
  </div>;
}
