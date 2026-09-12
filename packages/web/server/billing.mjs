// Hey Buddy's own paid plans.
//
// This deployment takes payment through a hosted checkout — a Stripe Payment Link or any other
// HTTPS checkout URL — and the URLs live in the environment rather than in the bundle. Two
// reasons, and the second is the important one:
//
//   1. Opening a checkout is a dashboard edit, not a rebuild. Paste the link into Render, restart,
//      and the Subscribe buttons go live; change price or processor later and no code moves.
//   2. Until a link is set, the page must not pretend to sell anything. A Subscribe button over a
//      dead href takes someone's intent to pay and drops it, which is worse than saying plainly
//      that checkout is not open yet. `billingStatus()` reports exactly what is configured and
//      the UI renders the honest state from that, rather than assuming the happy one.
//
// Nothing here handles money. It publishes a destination; the processor does the rest.

/**
 * A checkout URL the browser may be sent to. HTTPS, no credentials, no fragment — a link that
 * carries a password or a query the operator did not intend is a link worth refusing outright,
 * and a typo should read as "checkout not configured" rather than as a broken payment page.
 */
export function checkoutUrl(value) {
  const configured = (value || '').trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    return url.toString();
  } catch { return null; }
}

/** The plans this deployment sells, in display order. Prices are copy; the processor is the truth. */
export const PLANS = [
  { id: 'starter', name: 'Starter', price: '$12.90', cadence: 'per month', envKey: 'STRIPE_STARTER_URL' },
  { id: 'premium', name: 'Premium', price: '$24.90', cadence: 'per month', envKey: 'STRIPE_PREMIUM_URL' },
];

/**
 * What the browser is told about billing at load time. Never includes a secret: a Payment Link is
 * a public URL by design, which is why this is safe to publish and why the secret key stays with
 * the processor and never reaches this server at all.
 */
export function billingStatus(env = process.env) {
  const plans = PLANS.map(p => ({ id: p.id, name: p.name, price: p.price, cadence: p.cadence, checkout: checkoutUrl(env[p.envKey]) }));
  return { enabled: plans.some(p => p.checkout), plans };
}
