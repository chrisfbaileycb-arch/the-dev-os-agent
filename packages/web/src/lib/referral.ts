// Outbound referral to xKiro, in one place so it can be changed, audited, or removed wholesale.
//
// Two things are deliberate here.
//
// The link is a REFERRAL: following it and signing up may earn this project a commission. That
// is ordinary and fine, and it is also a material connection, which the US FTC's endorsement
// guides require be disclosed clearly and conspicuously wherever the link appears — not buried
// in a footer. Every component that renders a referral link renders REFERRAL_DISCLOSURE with it,
// and `referralLink()` supplies the rel/target attributes so no call site can forget them.
//
// The token allowance is a THIRD-PARTY CLAIM about someone else's product, which this project
// cannot verify and does not control. It lives here as editable copy rather than being written
// into a component, because when xKiro changes their offer this file is the only edit — and a
// stale claim in shipped UI is the operator's liability, not xKiro's.

/** The affiliate destination. Empty string removes every referral link and callout from the UI. */
export const REFERRAL_URL = 'https://xkiro.com/ref/3RMPMQ2';

/**
 * xKiro's advertised free daily allowance. UNVERIFIED by this project — confirm against
 * xkiro.com before a release, and correct or clear it here if the offer changes.
 */
export const REFERRAL_ALLOWANCE = '5M free tokens/day';

/**
 * xKiro's advertised breadth. UNVERIFIED, for the same reason as the allowance above: it is a
 * claim about someone else's catalogue, and it is the operator who is quoting it.
 */
export const REFERRAL_BREADTH = '40+ models';

/** Shown next to every referral link. Short enough to sit inline, explicit enough to be a disclosure. */
export const REFERRAL_DISCLOSURE = 'Referral link — we may earn a commission if you sign up.';

export const referralEnabled = (): boolean => REFERRAL_URL.trim().length > 0;

/** Attributes for an outbound referral anchor. `noopener noreferrer` on every one, centrally. */
export function referralLink(): { href: string; target: '_blank'; rel: string } {
  return { href: REFERRAL_URL, target: '_blank', rel: 'noopener noreferrer' };
}
