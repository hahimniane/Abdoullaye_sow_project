// Laawol Digital — Hostinger FTP deploy.
//
//   Root marketing site (public_site/)  -> laawoldigital.com web root
//   Admin console (admin_web/out/)      -> admin.laawoldigital.com web root
//   Business console (admin_web/out/)   -> business.laawoldigital.com web root
//
// Usage (from project root):
//   cd deploy && npm i basic-ftp
//   FTP_HOST=... FTP_USER=... FTP_PASS=... \
//   [REMOTE_ROOT=public_html] [REMOTE_ADMIN=public_html/admin] \
//   [REMOTE_BUSINESS=public_html/business] \
//   [FTP_SECURE=true] [DEPLOY_ADMIN=true] [DEPLOY_BUSINESS=true] node deploy.mjs
//
// Hostinger notes:
//  - FTP_HOST / FTP_USER / FTP_PASS come from hPanel -> Files -> FTP Accounts.
//  - For the PRIMARY domain, REMOTE_ROOT is usually "public_html".
//  - A subdomain's web root is whatever you set when creating it in hPanel
//    (commonly "public_html/admin", "public_html/business", or
//    "domains/admin.laawoldigital.com/public_html").
//  - The script lists the remote home dir first so you can confirm the paths.

import { Client } from "basic-ftp";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const cfg = {
  host: process.env.FTP_HOST,
  user: process.env.FTP_USER,
  password: process.env.FTP_PASS,
  secure: String(process.env.FTP_SECURE || "true").toLowerCase() === "true",
  remoteRoot: process.env.REMOTE_ROOT || "public_html",
  remoteAdmin: process.env.REMOTE_ADMIN || "public_html/admin",
  remoteBusiness: process.env.REMOTE_BUSINESS || "public_html/business",
  deployAdmin: String(process.env.DEPLOY_ADMIN || "true").toLowerCase() === "true",
  deployBusiness: String(process.env.DEPLOY_BUSINESS || "true").toLowerCase() === "true",
};

const SITE_DIR = path.join(ROOT, "public_site");
const ADMIN_DIR = path.join(ROOT, "admin_web", "out");

console.log("Running static deploy preflight...");
try {
  execFileSync("node", [path.join(__dirname, "preflight.mjs")], {
    env: {
      ...process.env,
      PREFLIGHT_SCOPE: "static",
    },
    stdio: "inherit",
  });
} catch {
  console.error("\nStatic deploy preflight failed. Fix the checks above and retry.");
  process.exit(1);
}

if (!cfg.host || !cfg.user || !cfg.password) {
  console.error("Missing FTP_HOST / FTP_USER / FTP_PASS env vars.");
  process.exit(1);
}

const client = new Client(30000);
client.ftp.verbose = false;

try {
  await client.access({
    host: cfg.host,
    user: cfg.user,
    password: cfg.password,
    secure: cfg.secure,
    secureOptions: { rejectUnauthorized: true },
  });
  console.log("Connected to", cfg.host, "as", cfg.user);

  const home = await client.pwd();
  console.log("\nRemote home directory:", home);
  for (const item of await client.list()) {
    console.log("   " + (item.isDirectory ? "[dir] " : "      ") + item.name);
  }

  // Non-destructive: uploadFromDir ensures the target dir and overwrites
  // same-named files; it does not delete anything already there.
  console.log(`\nUploading marketing site -> ${cfg.remoteRoot}`);
  await client.cd(home);
  await client.uploadFromDir(SITE_DIR, cfg.remoteRoot);
  console.log("Marketing site uploaded.");

  if (cfg.deployAdmin) {
    console.log(`\nUploading admin console -> ${cfg.remoteAdmin}`);
    await client.cd(home);
    await client.uploadFromDir(ADMIN_DIR, cfg.remoteAdmin);
    console.log("Admin console uploaded.");
  }

  if (cfg.deployBusiness) {
    console.log(`\nUploading business console -> ${cfg.remoteBusiness}`);
    await client.cd(home);
    await client.uploadFromDir(ADMIN_DIR, cfg.remoteBusiness);
    console.log("Business console uploaded.");
  }

  console.log("\nRunning read-only static smoke checks...");
  execFileSync("node", [path.join(__dirname, "post-deploy-smoke.mjs")], {
    env: {...process.env, SMOKE_SCOPE: "static"},
    stdio: "inherit",
  });

  console.log("\n✅ Deploy complete.");
} catch (err) {
  console.error("\n❌ Deploy failed:", err.message);
  process.exitCode = 1;
} finally {
  client.close();
}
