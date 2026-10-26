# Payments (Stripe, test mode)

**Pricing:** the score and report are free; exporting a report's fix link costs $9, paid with Stripe Checkout (`src/lib/payments.ts`, `/api/checkout`). A payment covers **one report**: its fingerprint (`src/lib/report-fingerprint.ts`, a hash of the page checks that still need fixing) is stored on the Stripe Checkout Session as `metadata.report`. Re-checking an unchanged site gives the same fingerprint, so it stays unlocked; after the owner changes something, the new report needs a new payment. `/api/fix-link` checks the paid session and fingerprint with Stripe before creating a link, so the paywall holds for direct API calls. Test mode only: set `STRIPE_SECRET_KEY=sk_test_...` (live keys are refused). Without the key, fix links stay free. The MCP `generate_fixes` tool is not gated.

## Try it

1. In the [Stripe dashboard](https://dashboard.stripe.com) turn on **Test mode** (newer accounts call it **Sandbox**), open **Developers → API keys** and copy the **Secret key** (`sk_test_...`). Put it in `.env` as `STRIPE_SECRET_KEY=sk_test_...`, no quotes or spaces.
2. `pnpm dev`, open `/report?url=python.org`, wait for the score, and click **Get my fix link · $9**.
3. Fill in Stripe Checkout with this dummy info. Nothing is charged; real card numbers are declined in test mode.

| Field | Enter |
| --- | --- |
| Email | `test@example.com` |
| Card number | `4242 4242 4242 4242` |
| Expiry | `12/34` (any future date) |
| CVC | `123` (any 3 digits) |
| Name on card | `Test User` |
| Country / ZIP | `United States` / `10001` |
| Phone (only if Stripe Link asks, or untick "Save my information") | `(201) 555-0123` |
| Link verification code (if asked) | `000000` |

4. Pay. You're sent back to the report with **Paid ✓**; **Copy my fix link** now exports. The payment shows under **Payments** in the dashboard (test mode).
5. The payment is remembered in that browser. After clearing storage or on another device, click **Already paid? Restore with your email** and enter the checkout email: the server finds that email's paid checkout for this website's current report in Stripe (`/api/checkout/restore`, 10 tries an hour per visitor). It proves knowledge of the email, not ownership of the inbox; emailing a one-time code would.

**Free next report:** after a purchase that charged money, the report shows the buyer a code (`FREE…`) for 100% off their next report: single use, only for their Stripe customer, valid 30 days (`/api/checkout/reward`, `rewardFor` in `src/lib/payments.ts`). It's created in Stripe the first time it's shown and the same code after that. A report paid with that code earns no new one. Checkouts create a Stripe customer, and a returning buyer's next checkout reuses theirs (taken from their earlier paid checkout in Stripe, not from the browser) so the code applies. The codes show up in the dashboard under **Product catalog → Coupons** as "Free next report".

**Promo codes:** checkout accepts Stripe promotion codes. Create one in the dashboard (test mode): **Product catalog → Coupons → + New** (e.g. 100% off, or $5 off), then **Add promotion code** with a code like `DEMOFREE`. On checkout click **Add promotion code** and enter it. A 100%-off code completes at $0 and still unlocks the report. See who used a code under the coupon's **Promotion codes** (redemption count) and each checkout's **Discounts**; via the API, `GET /v1/promotion_codes?code=DEMOFREE` returns `times_redeemed`.

Other test cards:

| Card | Result |
| --- | --- |
| `4000 0000 0000 0002` | Declined; the fix link stays locked |
| `4000 0025 0000 3155` | Asks for 3-D Secure; approve it to pay |
| `4000 0000 0000 9995` | Declined for insufficient funds |

Locally the fix link itself is stored in Supabase, so exporting after paying needs the Supabase vars in `.env` too.
