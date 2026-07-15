// Laawol Digital static deploy over SSH/rsync.
//
// Defaults match the current Hostinger account:
//   public_site/      -> domains/laawoldigital.com/public_html/
//   admin_web/out/   -> domains/laawoldigital.com/public_html/admin/
//   admin_web/out/   -> domains/laawoldigital.com/public_html/business/

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
].join(" ");

const dest = `${cfg.user}@${cfg.host}:${cfg.remoteRoot}`;
const common = ["-rtz", "--delete", "--omit-dir-times", "--no-perms", "-e", ssh];

console.log(`\nPublishing marketing site -> ${dest}/`);
run("rsync", [
  ...common,
  "--exclude",
  "admin/",
  "--exclude",
  "business/",
  `${SITE_DIR}/`,
  `${dest}/`,
]);

console.log(`\nPublishing admin console -> ${dest}/admin/`);
run("rsync", [...common, `${ADMIN_DIR}/`, `${dest}/admin/`]);

console.log(`\nPublishing business console -> ${dest}/business/`);
run("rsync", [...common, `${ADMIN_DIR}/`, `${dest}/business/`]);

console.log("\nRunning read-only static smoke checks...");
run("node", [path.join(__dirname, "post-deploy-smoke.mjs")], {
  env: {...process.env, SMOKE_SCOPE: "static"},
});

console.log("\nStatic SSH deploy complete.");
