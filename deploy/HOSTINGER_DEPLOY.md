# Laawol Digital — Hostinger Deployment Runbook

A self-contained guide for an AI agent (or human) to publish this project to
Hostinger. Three static artifacts are deployed:

| Artifact                 | Source folder        | Lives at                                     |
|--------------------------|----------------------|----------------------------------------------|
| Marketing website        | `public_site/`       | `https://laawoldigital.com/`                 |
| Admin console            | `admin_web/out/`     | `https://admin.laawoldigital.com/`           |
| Business owner dashboard | `admin_web/out/`     | `https://business.laawoldigital.com/`        |

> The admin console runs on its own subdomain `admin.laawoldigital.com`, whose
> document root is `~/domains/laawoldigital.com/public_html/admin`. It is served
> at the **subdomain root** (no `basePath`), so assets are root-absolute
> (`/_next/...`). The old `laawoldigital.com/admin/` path is deprecated.
>
> The business owner dashboard runs on `business.laawoldigital.com`, whose
> document root is `~/domains/laawoldigital.com/public_html/business`. It uses
> the same static export as the admin console (`admin_web/out/`) and is also
> served at the subdomain root.

All three are **static** (plain HTML/CSS/JS), so Hostinger shared hosting serves them
directly — no Node runtime is needed on the server.

---

## 1. Hosting facts

- **Provider:** Hostinger (hPanel). Account user: `u161013520`.
- **Primary domain:** `laawoldigital.com` (DNS A record → `46.202.183.189`).
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

## 3. Deploy (rsync over SSH)

Run from the **project root**. These are non-destructive uploads (`--delete`
only prunes files inside the target dir that no longer exist in the source).

```bash
KEY=~/.ssh/laawol_hostinger
SSH="ssh -i $KEY -p 65002 -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
DEST=u161013520@46.202.183.189:domains/laawoldigital.com/public_html

# Marketing site -> web root. Preserve dashboard subdomain folders that live
# under the same Hostinger public_html root.
rsync -rtz --delete --exclude admin/ --exclude business/ \
  --omit-dir-times --no-perms -e "$SSH" public_site/ "$DEST/"

# Admin console -> admin.laawoldigital.com document root
rsync -rtz --delete --omit-dir-times --no-perms -e "$SSH" \
  admin_web/out/ "$DEST/admin/"

# Business owner dashboard -> business.laawoldigital.com document root
rsync -rtz --delete --omit-dir-times --no-perms -e "$SSH" \
  admin_web/out/ "$DEST/business/"
```

Do not remove the `--exclude admin/ --exclude business/` flags from the
marketing-site line. Hostinger maps `admin.laawoldigital.com` and
`business.laawoldigital.com` to subfolders inside the same `public_html` root,
so an unrestricted root `--delete` can remove the dashboard deployments.

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
  Authorized domains → add `laawoldigital.com`, `admin.laawoldigital.com`, and
  `business.laawoldigital.com`. Email/password sign-in technically works
  without this, but add them for safety/OAuth.
- **Super admin account:** `admin@gmail.com`. The deployed Cloud Function
  `ensurePlatformAdminProfile` bootstraps it to `role: admin / adminRole:
  superAdmin` on first sign-in. **Change its password before going public.**
- Functions, Firestore rules, and Storage rules are deployed separately with the
  Firebase CLI. Storage rules matter for dashboard uploads such as business
  profile images, car listing photos, and featured-business logos:
  ```bash
  cd my_flutter_app
  firebase deploy --only functions --project car-selling-flutter-app
  firebase deploy --only firestore:rules,firestore:indexes --project car-selling-flutter-app
  firebase deploy --only storage --project car-selling-flutter-app
  ```
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
  cd my_flutter_app
  firebase deploy --only functions:backfillBusinessCarListings \
    --project car-selling-flutter-app
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
  firebase deploy --only \
    functions:createBusinessProCheckout,functions:handleBusinessProStripeWebhook,\
functions:generateBusinessInsights \
    --project car-selling-flutter-app
  ```
  Register the Stripe webhook endpoint as:
  `https://us-central1-car-selling-flutter-app.cloudfunctions.net/handleBusinessProStripeWebhook`.
  Subscribe it to `checkout.session.completed`,
  `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, and `invoice.payment_failed`.
  Note: a full functions deploy occasionally hits a transient Eventarc
  permission error on the `notify*` Firestore-trigger functions. If that
  happens, simply re-run:
  ```bash
  firebase deploy --only \
    functions:notifyBarrelShipmentStatus,functions:notifyCarPurchaseStatus,\
functions:notifyWalletRefundStatus,functions:notifyBusinessApplicationStatus \
    --project car-selling-flutter-app
  ```

---

## 5. Verify it's live

```bash
curl -sS -o /dev/null -w "root  %{http_code}\n"  https://laawoldigital.com
curl -sS -o /dev/null -w "admin %{http_code}\n"  https://admin.laawoldigital.com/
curl -sS -o /dev/null -w "biz   %{http_code}\n"  https://business.laawoldigital.com/
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
# build dashboards
cd admin_web && npm run build && cd ..

# deploy all static artifacts
KEY=~/.ssh/laawol_hostinger
SSH="ssh -i $KEY -p 65002 -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
DEST=u161013520@46.202.183.189:domains/laawoldigital.com/public_html
rsync -rtz --delete --exclude admin/ --exclude business/ --omit-dir-times --no-perms -e "$SSH" public_site/   "$DEST/"
rsync -rtz --delete --omit-dir-times --no-perms -e "$SSH" admin_web/out/ "$DEST/admin/"
rsync -rtz --delete --omit-dir-times --no-perms -e "$SSH" admin_web/out/ "$DEST/business/"

# verify
curl -sS -o /dev/null -w "root %{http_code}  " https://laawoldigital.com
curl -sS -o /dev/null -w "admin %{http_code}  " https://admin.laawoldigital.com/
curl -sS -o /dev/null -w "business %{http_code}\n" https://business.laawoldigital.com/
```
