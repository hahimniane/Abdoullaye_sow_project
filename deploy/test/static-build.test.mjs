import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import {createRequire} from "node:module";
import os from "node:os";
import path from "node:path";
import {afterEach, test} from "node:test";
import {fileURLToPath} from "node:url";

import {nextAssetPaths, remoteStaticSmokeScript} from "../smoke-lib.mjs";
import {
  debugTokenValues,
  devFirebaseBuildSettings,
  loadNextBuildEnv,
  readBuildFiles,
  scanStaticBuild,
  sourcePrefixesForScope,
  workingTreeState,
} from "../static-build-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_DIR = path.resolve(__dirname, "..", "..", "admin_web");

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), {recursive: true, force: true});
});
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "laawol-static-"));
  tempDirs.push(dir);
  return dir;
}

// --- Clean tree ---------------------------------------------------------------

// Regression: the clean-tree gate ran `--untracked-files=no`, so a component
// someone forgot to `git add` was imported by the build and shipped while the
// gate reported "working tree matches HEAD".
test("untracked source under a deployed path blocks; other untracked files do not", () => {
  const porcelain = [
    "?? admin_web/src/components/new-panel.tsx",
    "?? docs/notes.md",
    "?? \"public_site/caf\\u00e9.html\"",
    "?? my_flutter_app/functions/new_module.js",
  ].join("\n");
  const staticTree = workingTreeState(porcelain, sourcePrefixesForScope("static"));
  assert.equal(staticTree.clean, false);
  assert.deepEqual(staticTree.untrackedSource, [
    "admin_web/src/components/new-panel.tsx",
    "public_site/café.html",
  ]);
  assert.deepEqual(staticTree.modified, []);

  const backendTree = workingTreeState(porcelain, sourcePrefixesForScope("backend"));
  assert.deepEqual(backendTree.untrackedSource, ["my_flutter_app/functions/new_module.js"]);

  assert.equal(workingTreeState("?? docs/notes.md\n", sourcePrefixesForScope("full")).clean, true);
});

test("modified tracked files still block, anywhere", () => {
  const tree = workingTreeState(" M README.md\nA  deploy/new.mjs\n", sourcePrefixesForScope("static"));
  assert.equal(tree.clean, false);
  assert.deepEqual(tree.modified, ["README.md", "deploy/new.mjs"]);
  assert.equal(workingTreeState("", sourcePrefixesForScope("full")).clean, true);
});

test("the preflight asks git for untracked files and gates on them", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "preflight.mjs"), "utf8");
  assert.match(source, /"--untracked-files=all"/);
  assert.doesNotMatch(source, /"--untracked-files=no"/);
  assert.match(source, /workingTreeState\(status\.stdout, sourcePrefixesForScope\(SCOPE\)\)/);
});

// --- Build env ------------------------------------------------------------------

// Regression: the App Check check read process.env only. `next build` also
// reads admin_web/.env*, so a debug token or the emulator switch in .env.local
// reached the bundle while the preflight said the config was clean.
test("the build env is loaded like Next: exported vars over .env files", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, ".env.local"), [
    "NEXT_PUBLIC_FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY=from_env_local_1234",
    "NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN=abcd-1234-debug-token",
    "NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true",
  ].join("\n"));
  fs.writeFileSync(path.join(dir, ".env"), "NEXT_PUBLIC_FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY=from_env_file\n");
  const nextEnv = createRequire(path.join(ADMIN_DIR, "package.json"))("@next/env");

  const processEnv = {PATH: "/usr/bin", NEXT_PUBLIC_USE_FIREBASE_EMULATORS: "false"};
  const before = {...processEnv};
  // @next/env works on the real process.env; run it in a child so this test
  // cannot disturb the runner, and check what it reports.
  const script = `
    import {createRequire} from "node:module";
    import {loadNextBuildEnv} from ${JSON.stringify(path.join(__dirname, "..", "static-build-lib.mjs"))};
    const nextEnv = createRequire(${JSON.stringify(path.join(ADMIN_DIR, "package.json"))})("@next/env");
    const before = JSON.stringify(process.env);
    const {env, files} = loadNextBuildEnv({adminDir: ${JSON.stringify(dir)}, nextEnv});
    process.stdout.write(JSON.stringify({env, files, restored: JSON.stringify(process.env) === before}));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    env: {...processEnv, NODE_ENV: "production"},
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr);
  const {env, files, restored} = JSON.parse(child.stdout);
  assert.deepEqual(files, [".env.local", ".env"]);
  assert.equal(env.NEXT_PUBLIC_FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY, "from_env_local_1234");
  assert.equal(env.NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN, "abcd-1234-debug-token");
  // An exported variable beats the file, as in `next build`.
  assert.equal(env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS, "false");
  assert.equal(restored, true, "process.env is restored after loading");
  assert.deepEqual(processEnv, before);
  assert.equal(typeof nextEnv.loadEnvConfig, "function");
  assert.equal(typeof loadNextBuildEnv, "function");
});

test("dev-only Firebase settings in the build env are refused", () => {
  assert.deepEqual(devFirebaseBuildSettings({}), {ok: true, problems: []});
  const result = devFirebaseBuildSettings({
    NEXT_PUBLIC_USE_FIREBASE_EMULATORS: "true",
    NEXT_PUBLIC_FIREBASE_EMULATOR_HOST: "127.0.0.1",
    NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN: "abcd-1234",
  });
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 3);
});

test("the preflight checks App Check against the loaded build env", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "preflight.mjs"), "utf8");
  assert.match(source, /\(\"@next\/env\"\)/);
  assert.match(source, /siteKey: buildEnv\.NEXT_PUBLIC_FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY/);
  assert.match(source, /debugToken: buildEnv\.NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN/);
  assert.doesNotMatch(source, /siteKey: process\.env\.NEXT_PUBLIC_FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY/);
  assert.match(source, /scanStaticBuild\(readBuildFiles\(path\.join\(adminDir, "out"\)\)/);
});

// --- Built output -----------------------------------------------------------------

// Shapes observed in real `next build` output (Turbopack, Next 16): a normal
// build reads the emulator switch at runtime; an emulator build compiles the
// switch away and connects unconditionally.
const CLEAN_CHUNK =
  'p="true"===t.default.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS;' +
  "if(p&&!globalThis.__laawolEmulatorsConnected){globalThis.__laawolEmulatorsConnected=!0;" +
  'let e=t.default.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST??"127.0.0.1"}' +
  "if(e.FIREBASE_APPCHECK_DEBUG_TOKEN&&!0!==e.FIREBASE_APPCHECK_DEBUG_TOKEN)return";
const EMULATOR_CHUNK =
  "if(!globalThis.__laawolEmulatorsConnected){globalThis.__laawolEmulatorsConnected=!0;" +
  'let e=t.default.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST??"127.0.0.1";(0,n.connectAuthEmulator)(a,`http://${e}:9099`)}';

test("a clean production bundle passes the scan", () => {
  assert.deepEqual(scanStaticBuild([{path: "chunk.js", content: CLEAN_CHUNK}], {debugTokens: []}), []);
});

test("an emulator build, an emulator address or a debug token is caught", () => {
  assert.match(scanStaticBuild([{path: "a.js", content: EMULATOR_CHUNK}]).join(), /emulators are compiled in/);
  assert.match(
      scanStaticBuild([{path: "b.js", content: 'fetch("http://127.0.0.1:8080/v1")'}]).join(),
      /emulator address 127\.0\.0\.1:8080/,
  );
  assert.match(
      scanStaticBuild([{path: "c.js", content: "self.FIREBASE_APPCHECK_DEBUG_TOKEN=\"x\""}]).join(),
      /sets FIREBASE_APPCHECK_DEBUG_TOKEN/,
  );
  assert.match(
      scanStaticBuild([{path: "d.js", content: 'const k="abcd-1234-debug-token"'}], {
        debugTokens: ["abcd-1234-debug-token"],
      }).join(),
      /contains an App Check debug token/,
  );
});

test("debug tokens are collected from the build env and every env file", () => {
  assert.deepEqual(
      debugTokenValues({
        env: {NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN: "from-env-12345"},
        envFileTexts: [
          "NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN=\"from-file-12345\" # dev",
          "export NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN=true",
          "NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN=",
        ],
      }).sort(),
      ["from-env-12345", "from-file-12345"],
  );
});

test("the scan reads text files from a build directory", () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, "_next", "static", "chunks"), {recursive: true});
  fs.writeFileSync(path.join(dir, "index.html"), "<html></html>");
  fs.writeFileSync(path.join(dir, "_next", "static", "chunks", "a.js"), EMULATOR_CHUNK);
  fs.writeFileSync(path.join(dir, "logo.png"), Buffer.from([0x89, 0x50]));
  const files = readBuildFiles(dir).map((file) => file.path).sort();
  assert.deepEqual(files, ["_next/static/chunks/a.js", "index.html"]);
});

// --- Post-deploy smoke ------------------------------------------------------------

// Regression: the smoke fetched only the first /_next script in index.html, so
// a deploy missing any other chunk passed while the console failed to hydrate.
test("the smoke collects every chunk index.html names", () => {
  const html =
    '<link rel="stylesheet" href="/_next/static/chunks/3jy193lew6e5i.css"/>' +
    '<script src="/_next/static/chunks/turbopack-1li9ktb77b5a0.js" async=""></script>' +
    '<script src="/_next/static/chunks/0cz1d0mv5g_q7.js" noModule=""></script>' +
    '<script>self.__next_f.push([1,"2:I[1,[\\"/_next/static/chunks/42p9rbpa2ci6s.js\\",' +
    '\\"/_next/static/chunks/14mrh2-p_w84d.js\\"]]"])</script>' +
    '<script src="/_next/static/chunks/14mrh2-p_w84d.js"></script>';
  assert.deepEqual(nextAssetPaths(html), [
    "/_next/static/chunks/0cz1d0mv5g_q7.js",
    "/_next/static/chunks/14mrh2-p_w84d.js",
    "/_next/static/chunks/3jy193lew6e5i.css",
    "/_next/static/chunks/42p9rbpa2ci6s.js",
    "/_next/static/chunks/turbopack-1li9ktb77b5a0.js",
  ]);
  assert.deepEqual(nextAssetPaths("<html></html>"), []);
});

test("the direct and SSH smokes both fetch every asset", () => {
  const smoke = fs.readFileSync(path.join(__dirname, "..", "post-deploy-smoke.mjs"), "utf8");
  assert.match(smoke, /const assetPaths = nextAssetPaths\(html\);/);
  assert.match(smoke, /for \(const assetPath of assetPaths\)/);
  const script = remoteStaticSmokeScript({
    marketingHost: "laawoldigital.com",
    consoleHosts: ["admin.laawoldigital.com"],
  });
  assert.match(script, /for asset in \$assets; do/);
  assert.doesNotMatch(script, /head -n 1/);
});

test("the real build output, when present, has every chunk its index.html names", () => {
  const out = path.join(ADMIN_DIR, "out");
  if (!fs.existsSync(path.join(out, "index.html"))) return;
  const html = fs.readFileSync(path.join(out, "index.html"), "utf8");
  const assets = nextAssetPaths(html);
  assert.ok(assets.length > 3, "index.html names its chunks");
  for (const asset of assets) {
    assert.ok(fs.existsSync(path.join(out, asset)), `${asset} is in out/`);
  }
});
