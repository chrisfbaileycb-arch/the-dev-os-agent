# Managed models and monthly plans

Deployment credentials are entered only in the password-protected **Admin dashboard**.
The backend provider registry limits these to integrated US providers. The dashboard's
published free and paid model lists determine which managed models are selectable.
Provider nationality does not establish data residency or a zero-retention agreement.

Personal provider keys are entered in **Settings and model hub**, with optional browser
storage. Chat's two model menus contain connected model catalogues and published managed
models, with no key-entry fields. A personal model always runs on that personal key, even
when a subscription is connected. Cached catalogues are tied to the key that discovered them.

Every tier includes the local model panel, an on/off switch, optional local server API token,
and an address for Ollama or LM Studio. Local requests go directly to the configured
loopback server; no hosted proxy receives the local token. Session storage can still sync
to the application server. Changing the local address invalidates its old catalogue.

## Subscription defaults

| Plan | Monthly price | Monthly credits | Reply output ceiling |
| --- | ---: | ---: | ---: |
| Starter | $25 | 1,000 | 8,192 tokens |
| Builder | $50 | 2,500 | 16,384 tokens |
| Studio | $100 | 6,000 | 32,768 tokens |

These are adjustable product allowances, not dollar balances or a profitability estimate.
All three plans use the same published managed model list. The server applies tier limits
regardless of client-supplied prices, tier names, workspace IDs, or token limits. Model
limits and remaining credits can reduce the reply window. Personal keys and local inference
do not consume subscription credits. The calendar-month ledger resets at 00:00 UTC on the
first of each month; changing browser workspaces or upgrading a token does not reset usage.

Paid credits are measured on the server, using reported input/output usage when available
and character estimates otherwise. Credit rates per 1,000 tokens are:

| Model class | Input credits | Output credits |
| --- | ---: | ---: |
| Fast | 0.25 | 1.25 |
| Standard | 1.5 | 7.5 |
| Reasoning / flagship | 7.5 | 37.5 |

`server/plans.mjs` classifies models by ID. These product rates do not track vendor dollar
prices automatically. Review allowances against actual provider invoices before selling.
The proxy permits one in-flight reply per subscriber token in this single-process service;
multiple service instances would require a shared reservation/lock.

## Configure and activate

1. In Admin, enter the managed US provider credentials and load their live model catalogues.
   Publish the desired models as **Paid plan**, and save the model list.
2. Adjust each tier's monthly credits and output ceiling in Admin if needed. The defaults
   above work without environment variables. Dashboard values override hosting variables.
3. Configure hosted checkouts at the displayed recurring prices and paste the new URLs into
   `BILLING_STARTER_URL`, `BILLING_PREMIUM_URL`, and `BILLING_PRO_URL` in Admin. Old
   `STRIPE_STARTER_URL` / `STRIPE_PREMIUM_URL` links are deliberately ignored because they
   may charge the old prices. Unconfigured checkouts remain disabled.
4. After confirming payment, issue a unique, randomly generated subscriber token of at least
   16 characters. Add it to the corresponding comma-separated list in Admin:
   `PLAN_STARTER_ACCESS_TOKENS`, `PLAN_PREMIUM_ACCESS_TOKENS`, or `PLAN_PRO_ACCESS_TOKENS`.
   Subscriber lists are sealed in settings storage and never included in public responses.
5. The subscriber enters the token in Settings. The server verifies its tier and returns
   the real balance. To upgrade, move the same token to the higher tier; its ledger follows
   it. To cancel or revoke access, remove the token from every list.

Checkout links do not automatically provision or revoke subscriptions. Payment webhooks
and account-linked billing are not implemented; activation and cancellation are manual.
Legacy `PLAN_ACCESS_TOKENS` and the operator's `SERVER_CREDIT_ACCESS_TOKEN` use Starter
limits. `CREDIT_MONTHLY_POOL` and `PLAN_CREDIT_MONTHLY_POOL` do not set the new plan budgets.

The free reply default is now 8,192. An existing `FREE_MAX_OUTPUT_TOKENS=1024` setting,
including a stored dashboard override, upgrades to 8,192. Other explicit caps are respected.
The bottom bar displays the effective reply ceiling and the verified server allowance;
personal-key and local modes show that they spend no plan credits.
