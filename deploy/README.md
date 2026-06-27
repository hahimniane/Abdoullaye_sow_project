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

## 1. Get FTP credentials (hPanel)
hPanel → **Files → FTP Accounts**. Note the **FTP host/IP, username, password, port (21)**.

## 2. Create the subdomains (hPanel)
hPanel → **Domains → Subdomains** → create `admin` and `business` for
`laawoldigital.com`. Note the document roots it shows, normally
`public_html/admin` and `public_html/business`.

## 3. Add authorized domains in Firebase (for login safety)
Firebase Console → Authentication → Settings → **Authorized domains** →
add `laawoldigital.com`, `admin.laawoldigital.com`, and
`business.laawoldigital.com`.

## 4. Deploy
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
The script first runs the public CMS/privacy verifier, then prints the remote
home directory so you can confirm the paths are right, then uploads the static
sites. It is **non-destructive** (overwrites matching files, never deletes
existing ones).

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
rules. From `my_flutter_app/`, deploy those with the Firebase CLI after
reauthenticating:

```bash
firebase deploy --only functions --project car-selling-flutter-app
firebase deploy --only firestore:rules,firestore:indexes --project car-selling-flutter-app
firebase deploy --only storage --project car-selling-flutter-app
```
