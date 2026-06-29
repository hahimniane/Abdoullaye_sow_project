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
add `laawoldigital.com`, `admin.laawoldigital.com`, and
`business.laawoldigital.com`.

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

For path-specific checks, run:

```bash
npm run preflight:static
npm run preflight:backend
```

Preferred SSH publish:

```bash
cd deploy
npm run deploy:static:ssh
```

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
FTP_SECURE=false \
node deploy.mjs
```

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
