// Laawol Digital static deploy over SSH/rsync.
//
// Defaults match the current Hostinger account:
//   public_site/      -> domains/laawoldigital.com/public_html/
//   admin_web/out/   -> domains/laawoldigital.com/public_html/admin/
//   admin_web/out/   -> domains/laawoldigital.com/public_html/business/
//   admin_web/out/   -> domains/customer.laawoldigital.com/public_html/

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HOME = process.env.HOME || "";

const cfg = {
  key: process.env.SSH_KEY || path.join(HOME, ".ssh", "laawol_hostinger"),
  port: process.env.SSH_PORT || "65002",
  host: process.env.SSH_HOST || "46.202.183.189",
  user: process.env.SSH_USER || "u161013520",
  remoteRoot:
    process.env.REMOTE_ROOT || "domains/laawoldigital.com/public_html",
  remoteCustomer:
    process.env.REMOTE_CUSTOMER ||
    "domains/customer.laawoldigital.com/public_html",
};

const SITE_DIR = path.join(ROOT, "public_site");
const ADMIN_DIR = path.join(ROOT, "admin_web", "out");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    env: options.env || process.env,
    stdio: options.stdio || "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
  return result;
}

/**
 * rsync, retried, because the link to Hostinger drops mid-transfer.
 *
 * A dropped transfer is not a neutral failure: it has already replaced some
 * of the tree. The console console once ended up serving an index.html whose
 * hashed chunk had never finished uploading, which is a 404 on a live site
 * for every visitor until someone notices. Retrying in place is what turns
 * that from an outage into a slow deploy.
 */
function rsyncWithRetry(args, {attempts = 3} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync("rsync", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "inherit",
    });
    if (result.status === 0) return;
    if (attempt === attempts) {
      console.error(`\nrsync failed after ${attempts} attempts.`);
      process.exit(result.status || 1);
    }
    console.warn(
      `\nrsync attempt ${attempt} failed - retrying (the tree on the ` +
        "server is mid-update until one succeeds).",
    );
  }
}

if (!fs.existsSync(cfg.key)) {
  console.error(`Missing SSH key: ${cfg.key}`);
  process.exit(1);
}

console.log("Running static deploy preflight for SSH...");
try {
  execFileSync("node", [path.join(__dirname, "preflight.mjs")], {
    env: {
      ...process.env,
      PREFLIGHT_SCOPE: "static",
      STATIC_TRANSPORT: "ssh",
    },
    stdio: "inherit",
  });
} catch {
  console.error("\nStatic deploy preflight failed. Fix the checks above and retry.");
  process.exit(1);
}

// Keepalives because the shared host drops an idle-looking connection
// mid-transfer ("ssh_packet_write_poll: Result too large"), which is how a
// deploy gets to publish half a console.
const ssh = [
  "ssh",
  "-i",
  cfg.key,
  "-p",
  cfg.port,
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=accept-new",
  "-o",
  "ServerAliveInterval=15",
  "-o",
  "ServerAliveCountMax=8",
].join(" ");

const dest = `${cfg.user}@${cfg.host}:${cfg.remoteRoot}`;
const customerDest = `${cfg.user}@${cfg.host}:${cfg.remoteCustomer}`;
// --delete keeps the tree true to the build - but a browser tab opened
// before a deploy still lazy-loads hashed chunks from the PREVIOUS build.
// Deleting those made every open session shatter on navigation (unstyled
// panels, dead tooltips) until a hard refresh. Hashed assets are immutable
// and tiny: protect them from deletion and let deploys accumulate them.
const common = [
  "-rtz", "--delete", "--omit-dir-times", "--no-perms",
  // Keep a dropped transfer's progress so a retry finishes it rather than
  // starting the whole console again.
  "--partial", "--timeout=120",
  "--filter=P _next/static/**",
  "-e", ssh,
];

/**
 * One console, published so that a failure mid-way cannot break it.
 *
 * Assets first, HTML second. The hashed chunks are additive - nothing points
 * at them until the HTML that names them lands - so a transfer that dies
 * after pass one leaves the site untouched and serving the previous build.
 * Publishing in one pass meant a drop could replace index.html while the
 * chunk it references was still uploading, and every visitor got a 404.
 */
function publishConsole(label, target) {
  console.log(`\nPublishing ${label} assets -> ${target}/_next/static/`);
  rsyncWithRetry([
    "-rtz", "--omit-dir-times", "--no-perms", "--partial", "--timeout=120",
    "-e", ssh,
    `${ADMIN_DIR}/_next/static/`,
    `${target}/_next/static/`,
  ]);
  console.log(`\nPublishing ${label} -> ${target}/`);
  rsyncWithRetry([...common, `${ADMIN_DIR}/`, `${target}/`]);
}

console.log(`\nPublishing marketing site -> ${dest}/`);
rsyncWithRetry([
  ...common,
  "--exclude",
  "admin/",
  "--exclude",
  "business/",
  "--exclude",
  "customer/",
  `${SITE_DIR}/`,
  `${dest}/`,
]);

publishConsole("admin console", `${dest}/admin`);
publishConsole("business console", `${dest}/business`);
publishConsole("customer console", customerDest.replace(/\/$/, ""));

console.log("\nRunning read-only static smoke checks...");
run("node", [path.join(__dirname, "post-deploy-smoke.mjs")], {
  env: {
    ...process.env,
    SMOKE_SCOPE: "static",
    STATIC_SMOKE_TRANSPORT: "ssh",
    SSH_KEY: cfg.key,
    SSH_PORT: cfg.port,
    SSH_HOST: cfg.host,
    SSH_USER: cfg.user,
  },
});

console.log("\nStatic SSH deploy complete.");
