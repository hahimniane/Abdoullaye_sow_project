# Deploying to Hostinger

For the full production runbook, use
[HOSTINGER_DEPLOY.md](./HOSTINGER_DEPLOY.md). This file is only the short
static-site deploy reference.

Three static targets are deployed:

| Site            | Source folder         | Goes to                       |
|-----------------|-----------------------|-------------------------------|
| Marketing site  | `public_site/`        | `laawoldigital.com` web root  |
| Admin console   | `admin_web/out/`      | `admin.laawoldigital.com`     |
| Business console| `admin_web/out/`      | `business.laawoldigital.com`  |
| Customer console| `admin_web/out/`      | `customer.laawoldigital.com`  |

## 1. Confirm static deploy access

Preferred path is SSH/rsync with the Hostinger key at
`~/.ssh/laawol_hostinger`. FTP remains available as a fallback from hPanel →
**Files → FTP Accounts**.

## 2. Create the subdomains (hPanel)
hPanel → **Domains → Subdomains** → create `admin` and `business` for
`laawoldigital.com`. Note the document roots it shows, normally
`public_html/admin` and `public_html/business`.

## 3. Add authorized domains in Firebase (for login safety)
Firebase Console → Authentication → Settings → **Authorized domains** →
add `laawoldigital.com`, `admin.laawoldigital.com`,
`business.laawoldigital.com`, and `customer.laawoldigital.com`.

## 4. Deploy
Before uploading or deploying backend code, run the non-destructive preflight:

```bash
cd deploy
npm run preflight
```

The default `preflight`/`preflight:full` check covers the public-site verifier,
the admin static build, Hostinger FTP env vars, Firebase login/project access,
the Stripe secret shape, the shared barrel Firestore indexes, and a Firebase
Functions dry-run so project API blockers are visible before the real deploy.
It does not print secret values and it does not deploy.

Backend preflight also runs Functions lint plus the complete
unit/callable/Firestore/Storage emulator suite. Java 21 or newer and Firebase
CLI `14.22.0` must be available locally. The deploy tooling automatically
prefers Homebrew's versioned Java 21 installation on macOS and prepends the
selected `JAVA_HOME/bin` to `PATH`; set `DEPLOY_JAVA_HOME` to override it. For
the production project it rejects
`SIMULATE_PAYMENTS` and requires `STRIPE_SECRET_KEY` to be a live key. A
non-production project must be explicitly labeled, for example:

```bash
DEPLOY_ENV=test FIREBASE_PROJECT=demo-laawol npm run preflight:backend
```

Production preflight also requires an authenticated `gh` CLI and a successful
`CI` workflow run for the exact commit being deployed. `ALLOW_UNVERIFIED_CI=1`
is an emergency-only, logged override; it is not a routine deployment option.
The Functions dry run uses a temporary Firebase config without duplicate
predeploy hooks because lint and the complete test suite have already passed in
the same preflight; the real deploy retains and reruns those hooks.

For path-specific checks, run:

```bash
npm run preflight:static
npm run preflight:backend
```

The static production gate verifies the committed Hostinger IPv4 and IPv6
through both Google and Cloudflare DNS-over-HTTPS and requires them to agree.
Do not replace this with the machine's ordinary UDP resolver: the local/default
DNS path can substitute unrelated block-page addresses even when the
authoritative Hostinger records and the public site are healthy.

Preferred SSH publish:

```bash
cd deploy
npm run deploy:static:ssh
```

The SSH deploy performs its post-upload HTTPS smoke checks from the Hostinger
server with each hostname and TLS SNI preserved. This avoids the operator's
local DNS/network filtering while still checking the deployed virtual hosts,
certificates, console HTML, and Next.js runtime assets. Run the same read-only
check manually with `npm run smoke:static:ssh`.

FTP fallback:

```bash
cd deploy
npm i            # installs basic-ftp (already done)
FTP_HOST=ftp.laawoldigital.com \
FTP_USER=your_ftp_user \
FTP_PASS=your_ftp_password \
REMOTE_ROOT=public_html \
REMOTE_ADMIN=public_html/admin \
REMOTE_BUSINESS=public_html/business \
FTP_SECURE=true \
node deploy.mjs
```

Plain FTP and invalid TLS certificates are rejected. If the host cannot provide
a valid FTPS endpoint, use the preferred SSH deployment instead.

Both scripts run the public CMS/privacy verifier and confirm the admin static
build exists before upload. The SSH script uses `rsync --delete` on each target
and keeps the root upload from deleting `admin/` or `business/`.

You can run the verifier by itself with:
```bash
cd deploy && npm run verify:public
```

## 5. Rebuild the admin console after code changes
```bash
cd admin_web && npm run build   # regenerates out/
```

## 6. Deploy Firebase backend/rules separately

The static upload does not deploy Cloud Functions, Firestore rules, or Storage
rules. From `deploy/`, use the guarded backend deploy after reauthenticating and
fixing the backend preflight checks:

```bash
npm run deploy:backend
```

The guarded command deploys Functions, Firestore rules/indexes, and Storage
rules through one Firebase CLI invocation, then runs read-only backend smoke
checks. Do not replace it with a direct `firebase deploy` command.
The legacy `my_flutter_app/functions` `npm run deploy` script is also a bypass:
do not use it for production.

Both static deployment commands run read-only HTTP smoke checks after upload.
They can also be run independently with `npm run smoke:static` and
`npm run smoke:backend`.

Mobile binaries follow [RELEASE_ARTIFACTS.md](./RELEASE_ARTIFACTS.md); new
AAB/APK/IPA outputs must live in the CI/release artifact store with commit and
checksum provenance, not in Git.
