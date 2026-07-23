# Laawol Digital — Hostinger Deployment Runbook

A self-contained guide for an AI agent (or human) to publish this project to
Hostinger. Three static artifacts are deployed:

| Artifact                 | Source folder        | Lives at                                     |
|--------------------------|----------------------|----------------------------------------------|
| Marketing website        | `public_site/`       | `https://laawoldigital.com/`                 |
| Admin console            | `admin_web/out/`     | `https://admin.laawoldigital.com/`           |
| Business owner dashboard | `admin_web/out/`     | `https://business.laawoldigital.com/`        |
| Customer workspace        | `admin_web/out/`     | `https://customer.laawoldigital.com/`        |

> The admin console runs on its own subdomain `admin.laawoldigital.com`, whose
> document root is `~/domains/laawoldigital.com/public_html/admin`. It is served
> at the **subdomain root** (no `basePath`), so assets are root-absolute
> (`/_next/...`). The old `laawoldigital.com/admin/` path is deprecated.
>
> The business owner dashboard runs on `business.laawoldigital.com`, whose
> document root is `~/domains/laawoldigital.com/public_html/business`. It uses
> the same static export as the admin console (`admin_web/out/`) and is also
> served at the subdomain root.
>
> The customer workspace runs on `customer.laawoldigital.com`, whose Hostinger
> website document root is
> `~/domains/customer.laawoldigital.com/public_html`. It is a separate
> Hostinger website root, not `laawoldigital.com/public_html/customer`.

All three are **static** (plain HTML/CSS/JS), so Hostinger shared hosting serves them
directly — no Node runtime is needed on the server.

---

## 1. Hosting facts

- **Provider:** Hostinger (hPanel). Account user: `u161013520`.
- **Primary domain:** `laawoldigital.com` (DNS A → `46.202.183.189`, AAAA →
  `2a02:4780:2b:1948:0:998:df10:5`).
- **Web root (marketing site):** `~/domains/laawoldigital.com/public_html`
  - There is a `DO_NOT_UPLOAD_HERE` marker file in the parent dir — always
    upload **into `public_html`**, never the parent.
- **Admin console root:** `~/domains/laawoldigital.com/public_html/admin`
  - Hostinger maps this folder to `https://admin.laawoldigital.com/`.
  - The legacy `https://laawoldigital.com/admin/` path may still resolve, but
    use the subdomain as the canonical admin URL.
- **Business owner dashboard root:**
  `~/domains/laawoldigital.com/public_html/business`
  - Hostinger maps this folder to `https://business.laawoldigital.com/`.
  - The same `admin_web/out/` static export is deployed here for business users.
- **Customer workspace root:**
  `~/domains/customer.laawoldigital.com/public_html`
  - Hostinger maps this separate website root to
    `https://customer.laawoldigital.com/`.
  - The same `admin_web/out/` static export is deployed here for customers.

### SSH / SFTP access (preferred)
- **Host:** `46.202.183.189` (or `hniane.com`)
- **Port:** `65002`  ← Hostinger uses a non-standard SSH port, not 22
- **User:** `u161013520`
- **Auth:** SSH **key-based** (no password). The private key lives only on the
  deploying machine at `~/.ssh/laawol_hostinger`. The matching public key must
  be added once in hPanel → **Advanced → SSH Access → Manage SSH keys**.

To create a new key (if deploying from a fresh machine):
```bash
ssh-keygen -t ed25519 -N "" -C "laawol-deploy" -f ~/.ssh/laawol_hostinger
cat ~/.ssh/laawol_hostinger.pub   # paste this into hPanel SSH keys
```

Smoke-test the connection:
```bash
ssh -i ~/.ssh/laawol_hostinger -p 65002 \
  -o StrictHostKeyChecking=accept-new u161013520@46.202.183.189 'pwd && ls'
```

> FTP is also available (hPanel → Files → FTP Accounts, port 21), but SSH+rsync
> is faster and non-destructive. The remote server has `rsync`, `tar`, `scp`.

---

## 2. Build the admin and business consoles

The marketing site needs **no build** (edit `public_site/` directly). The admin
and business consoles use the same Next.js static export and must be rebuilt
after any code change:

```bash
cd admin_web
npm install        # first time only
npm run build      # outputs to admin_web/out/
```

Note: `admin_web/next.config.ts` has **no** `basePath` — the admin and business
dashboards are served at the root of their subdomains, so `/_next/...` asset
URLs are root-absolute. Do not add `basePath: "/admin"` or
`basePath: "/business"` while the subdomains are the canonical URLs.

---

## 3. Deploy (guarded rsync over SSH)

Run the guarded script. It enforces a clean tree, verifies the public site,
runs console tests, verifies all three public DNS names point only to the
documented Hostinger IPv4 and IPv6 through Google and Cloudflare DNS-over-HTTPS,
rebuilds from source, uploads all three targets, and then runs HTTPS smoke checks
through the authenticated Hostinger SSH session. Those requests preserve each
public hostname and TLS SNI while connecting to the local web server, so
certificate, virtual-host, page, and Next.js runtime-asset failures still block
the release.
The trusted resolver consensus avoids false failures when the local/default DNS
path is rewritten to a security-block address:

```bash
cd deploy
npm run deploy:static:ssh
```

Do not replace this with a copied `rsync` command. The script preserves the
`admin/` and `business/` subfolders during the marketing-site sync; an
unrestricted root `--delete` can remove both dashboard deployments.

### Cache busting
`public_site/*.html` reference `assets/styles.css?v=N` and
`assets/script.js?v=N`. When you change CSS/JS, **bump `N`** so browsers fetch
fresh files:
```bash
cd public_site && perl -pi -e 's/\?v=\d+/?v=NEXT_NUMBER/g' *.html
```

### CMS/privacy verification
Before uploading the public site, run the static CMS verifier. It checks that
all public pages load `assets/content.js`, the featured-business query only
uses the curated `featuredBusinesses` collection, homepage featured cards remain
capped, and country/city fields stay selectable:
```bash
node public_site/verify-cms.mjs
```

---

## 4. Firebase configuration (one-time)

The admin and business dashboards talk to Firebase project
**`car-selling-flutter-app`**.

- **Authorized domains:** Firebase Console → Authentication → Settings →
  Authorized domains → add `laawoldigital.com`, `admin.laawoldigital.com`,
  `business.laawoldigital.com`, and `customer.laawoldigital.com`. Email/password sign-in technically works
  without this, but add them for safety/OAuth.
- **First super admin:** create and verify the Firebase Auth user, then run the
  explicit confirmation-gated command from `my_flutter_app/functions`:
  `npm run bootstrap:platform-admin -- --project PROJECT_ID --email EMAIL
  --confirm PROJECT_ID`. Runtime code never promotes an account by email.
- Functions, Firestore rules/indexes, and Storage rules are released together
  through the guarded backend command. It runs backend tests and production
  payment-mode checks before any write:
  ```bash
  cd deploy
  DEPLOY_ENV=development FIREBASE_PROJECT=car-selling-flutter-app \
    npm run deploy:backend
  ```
  Through August 31, 2026, the explicit development label authorizes the
  project's Stripe test key while retaining every other production release
  gate. The authorization expires automatically at
  `2026-09-01T04:00:00Z`; after that, use `DEPLOY_ENV=production` with a live
  Stripe key.
- If deploys fail with `ACCESS_TOKEN_TYPE_UNSUPPORTED` while checking
  `cloudresourcemanager.googleapis.com` or `iam.googleapis.com`, the Firebase
  CLI token is stale or unsupported for Google Cloud APIs. Reauth the Firebase
  CLI with a project-authorized Google account before retrying:
  ```bash
  firebase logout
  firebase login --reauth
  firebase login:list
  ```
  A local `gcloud` or ADC account is not enough unless that same account has
  access to `car-selling-flutter-app`.
- If a business owner cannot see older cars they posted, inspect those
  `cars/{id}` documents for a missing/blank or wrong/default `businessId`. Do
  not loosen business dashboard reads to match by name. Deploy and run the
  targeted super-admin callable instead:
  ```bash
    cd deploy
    DEPLOY_ENV=production FIREBASE_PROJECT=car-selling-flutter-app \
      npm run deploy:backend
  ```
  Call it first with `dryRun: true`, `businessId`, and either explicit `carIds`
  or a `legacyBusinessName`; then call again with `dryRun: false` to assign only
  cars that are currently unassigned. Review the `inspected` array in the dry
  run output: it shows each checked car's current `businessId`, title/name,
  status, and whether it is eligible for the chosen operation. To fix cars
  already assigned to the
  wrong/default business, pass explicit verified `carIds` plus
  `reassignExplicitCarIds: true`; do not use that flag with broad name-based
  migration.

  If the callable has not been deployed yet but Admin SDK credentials are
  available locally, the repo also has a dry-run-first fallback script:
  ```bash
  cd my_flutter_app/functions

  # Inspect unassigned legacy cars by old business display name.
  npm run backfill:cars -- \
    --project car-selling-flutter-app \
    --business-id alseny_business_center \
    --legacy-business-name "Alseny Business Center"

  # Commit only after reviewing the dry-run carIds.
  npm run backfill:cars -- \
    --project car-selling-flutter-app \
    --business-id alseny_business_center \
    --car-ids car_1,car_2 \
    --commit

  # Wrong/default ownership requires explicit verified IDs.
  npm run backfill:cars -- \
    --project car-selling-flutter-app \
    --business-id alseny_business_center \
    --car-ids car_3 \
    --reassign-explicit-car-ids \
    --commit
  ```
- Business Pro checkout requires these Firebase Function secrets to be real
  production values before the feature can process subscriptions:
  ```bash
  firebase functions:secrets:set BUSINESS_PRO_PRICE_ID --project car-selling-flutter-app
  firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project car-selling-flutter-app
  firebase functions:secrets:set ANTHROPIC_API_KEY --project car-selling-flutter-app
  cd deploy
  DEPLOY_ENV=production FIREBASE_PROJECT=car-selling-flutter-app \
    npm run deploy:backend
  ```
  Register the Stripe webhook endpoint as:
  `https://us-central1-car-selling-flutter-app.cloudfunctions.net/handleBusinessProStripeWebhook`.
  Subscribe it to `checkout.session.completed`,
  `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, and `invoice.payment_failed`.
  If Eventarc reports a transient permission error, re-run the guarded backend
  command. Do not switch to a targeted direct deploy, because that bypasses the
  full test/payment-mode gate and can leave rules and Functions out of sync.

---

## 5. Verify it's live

```bash
curl -sS -o /dev/null -w "root  %{http_code}\n"  https://laawoldigital.com
curl -sS -o /dev/null -w "admin %{http_code}\n"  https://admin.laawoldigital.com/
curl -sS -o /dev/null -w "biz   %{http_code}\n"  https://business.laawoldigital.com/
curl -sS -o /dev/null -w "customer %{http_code}\n" https://customer.laawoldigital.com/
# Confirm an admin asset resolves (must be 200, root-absolute on subdomain):
asset=$(curl -sS https://admin.laawoldigital.com/ | grep -o '/_next/[^"]*\.js' | head -1)
curl -sS -o /dev/null -w "asset %{http_code}\n" "https://admin.laawoldigital.com$asset"
# Confirm a business asset resolves from the same root-absolute export:
business_asset=$(curl -sS https://business.laawoldigital.com/ | grep -o '/_next/[^"]*\.js' | head -1)
curl -sS -o /dev/null -w "biz asset %{http_code}\n" "https://business.laawoldigital.com$business_asset"
```
Expected: `root 200`, `admin 200`, `biz 200`, `asset 200`, `biz asset 200`,
and both dashboard pages boot with JS loading from `/_next/...` on their
subdomains.

---

## 6. Dashboard subdomain notes

The admin subdomain is already active. Hostinger currently maps
`https://admin.laawoldigital.com/` to
`~/domains/laawoldigital.com/public_html/admin`, so keep syncing
`admin_web/out/` to `$DEST/admin/`.

The business subdomain should map `https://business.laawoldigital.com/` to
`~/domains/laawoldigital.com/public_html/business`, so sync the same
`admin_web/out/` export to `$DEST/business/`.

If Hostinger is later changed to a separate subdomain folder such as
`~/domains/admin.laawoldigital.com/public_html`, update `DEST` or the rsync
target in this runbook, but keep `admin_web/next.config.ts` without a `basePath`
as long as the dashboard is served at the subdomain root.

---

## Quick reference (copy/paste)

```bash
# Preflight, build-from-source, deploy, and run post-deploy smoke checks.
cd deploy
npm run deploy:static:ssh
```
