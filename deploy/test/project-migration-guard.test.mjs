// Pins the project-migration contract (docs/PROJECT_MIGRATION.md):
//   (a) no source file outside the per-component single-source config files
//       hardcodes the current project's id, number, keys or URLs, so moving
//       to the new project is a small, reviewable change to those files;
//   (b) the deploy tooling accepts a project override;
//   (c) every component's config agrees on which two projects exist.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

import {
  ACTIVE_PROJECT,
  DEFAULT_PROJECT_ID,
  PROJECTS,
  loadProjectConfig,
  resolveProjectId,
  resolveRegion,
} from "../project-config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const OLD_VALUES = [
  "car-selling-flutter-app",
  "577373430777",
  // Public web API key + reCAPTCHA Enterprise key registered in that project.
  "AIzaSyBrRDTd5w2iWxTIfvsn7ra0xjW7M-iuPN8",
  "6Lcs5FUtAAAAAA_XmvDg0rDqUE4noHLjFCLqofHX",
];

// Files that ARE the single source of truth for a component (or a native
// config file that exists to hold these values), plus the tests that pin the
// old defaults. Everything else must stay free of the old project's values.
const SINGLE_SOURCE_FILES = new Set([
  "deploy/project-config.json",
  "my_flutter_app/functions/project_config.js",
  "admin_web/src/lib/project-config.ts",
  "public_site/assets/site-config.js",
  "public_site/.htaccess",
  "my_flutter_app/lib/firebase_options.dart",
  "my_flutter_app/android/app/google-services.json",
  "my_flutter_app/ios/Runner/Info.plist",
  "my_flutter_app/macos/Runner/GoogleService-Info.plist",
  "my_flutter_app/macos/firebase_app_id_file.json",
  "my_flutter_app/.firebaserc",
  "admin_web/.firebaserc",
  // Per-project functions env files: Firebase picks `.env.<project id>` by
  // its name, so the id is the file name (and its un-ignore line).
  "my_flutter_app/functions/.env.car-selling-flutter-app",
  "my_flutter_app/functions/.env.laawol-a855a",
  "my_flutter_app/functions/.gitignore",
]);
const PIN_TESTS = new Set([
  "deploy/test/project-migration-guard.test.mjs",
  "my_flutter_app/functions/test/project-config.test.js",
  "admin_web/src/lib/project-config.test.ts",
  "my_flutter_app/test/firebase_environment_options_test.dart",
  "public_site/verify-cms.mjs",
]);

const SKIP_DIRS = new Set([
  ".git", ".claude", "node_modules", "build", ".next", "out", ".dart_tool",
  "Pods", ".gradle", ".idea", ".symlinks", "ephemeral",
]);
const BINARY = /\.(png|jpe?g|gif|ico|pdf|ttf|otf|woff2?|zip|jar|keystore|jks|webp|mp4|mov|icns|a|so|dylib)$/i;

function* sourceFiles(dir = ROOT) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* sourceFiles(path.join(dir, entry.name));
      continue;
    }
    if (!entry.isFile() || BINARY.test(entry.name)) continue;
    if (entry.name === "package-lock.json" || entry.name === "pubspec.lock") continue;
    yield path.join(dir, entry.name);
  }
}

test("no source outside the single-source config files names the old project", () => {
  const offenders = [];
  let scanned = 0;
  for (const file of sourceFiles()) {
    const relative = path.relative(ROOT, file).split(path.sep).join("/");
    if (relative.endsWith(".md")) continue; // documentation may name it
    if (SINGLE_SOURCE_FILES.has(relative) || PIN_TESTS.has(relative)) continue;
    if (fs.statSync(file).size > 2_000_000) continue;
    scanned += 1;
    const text = fs.readFileSync(file, "utf8");
    for (const value of OLD_VALUES) {
      if (text.includes(value)) offenders.push(`${relative}: ${value.slice(0, 12)}...`);
    }
  }
  assert.ok(scanned > 200, `expected to scan the whole repo, scanned ${scanned}`);
  assert.deepEqual(
      offenders,
      [],
      "hardcoded project values must live in the component's single-source " +
      "config (see docs/PROJECT_MIGRATION.md):\n" + offenders.join("\n"),
  );
});

test("every single-source file still exists (the allowlist cannot rot)", () => {
  for (const relative of [...SINGLE_SOURCE_FILES, ...PIN_TESTS]) {
    assert.ok(fs.existsSync(path.join(ROOT, relative)), `${relative} is missing`);
  }
});

test("production stays on the current project until the switch is flipped", () => {
  const config = loadProjectConfig();
  assert.equal(config.active, "current");
  assert.equal(DEFAULT_PROJECT_ID, "car-selling-flutter-app");
  assert.equal(ACTIVE_PROJECT.projectNumber, "577373430777");
  assert.equal(PROJECTS.new.projectId, "laawol-a855a");
  assert.equal(PROJECTS.new.projectNumber, "127318353394");
});

test("deploy tooling accepts a project override (env, flag, alias)", () => {
  const none = {env: {}, argv: []};
  assert.equal(resolveProjectId(none), DEFAULT_PROJECT_ID);
  assert.equal(
      resolveProjectId({env: {FIREBASE_PROJECT: "laawol-a855a"}, argv: []}),
      "laawol-a855a",
  );
  assert.equal(
      resolveProjectId({env: {FIREBASE_PROJECT: "new"}, argv: []}),
      "laawol-a855a",
  );
  assert.equal(
      resolveProjectId({env: {FIREBASE_PROJECT: "current"}, argv: []}),
      DEFAULT_PROJECT_ID,
  );
  assert.equal(
      resolveProjectId({env: {FIREBASE_PROJECT: "x-1234"}, argv: ["--project", "laawol-a855a"]}),
      "laawol-a855a",
      "the command-line flag wins over the environment",
  );
  assert.equal(
      resolveProjectId({env: {}, argv: ["--project=laawol-a855a"]}),
      "laawol-a855a",
  );
  assert.equal(resolveRegion({env: {}, projectId: "laawol-a855a"}), "us-central1");
  assert.equal(
      resolveRegion({env: {FUNCTIONS_REGION: "europe-west1"}, projectId: "laawol-a855a"}),
      "europe-west1",
  );
});

test("every deploy script takes its project from project-config.mjs", () => {
  for (const file of [
    "backend-deploy.mjs",
    "preflight.mjs",
    "post-deploy-smoke.mjs",
    "prune-cloud-run-revisions.mjs",
  ]) {
    const source = read(`deploy/${file}`);
    assert.match(source, /from "\.\/project-config\.mjs"/, `${file} must import project-config.mjs`);
    assert.match(source, /resolveProjectId\(/, `${file} must call resolveProjectId`);
    assert.doesNotMatch(
        source,
        /process\.env\.FIREBASE_PROJECT\s*\|\|/,
        `${file} must not read FIREBASE_PROJECT with its own literal default`,
    );
  }
  assert.match(read("deploy/preflight-lib.mjs"), /DEFAULT_PRODUCTION_PROJECT = DEFAULT_PROJECT_ID/);
  assert.match(read("deploy/store/gate.py"), /project-config\.json/);
});

test(".firebaserc keeps default on production and adds a `new` alias", () => {
  for (const file of ["my_flutter_app/.firebaserc", "admin_web/.firebaserc"]) {
    const {projects} = JSON.parse(read(file));
    assert.equal(projects.default, ACTIVE_PROJECT.projectId, `${file} default`);
    assert.equal(projects.production, ACTIVE_PROJECT.projectId, `${file} production`);
    assert.equal(projects.new, PROJECTS.new.projectId, `${file} new alias`);
  }
});

test("every component's config registers the same two projects", () => {
  const current = PROJECTS.current;
  const next = PROJECTS.new;
  const components = {
    functions: read("my_flutter_app/functions/project_config.js"),
    admin: read("admin_web/src/lib/project-config.ts"),
    site: read("public_site/assets/site-config.js"),
    flutter: read("my_flutter_app/lib/firebase_options.dart") +
      read("my_flutter_app/lib/firebase_options_new.dart"),
  };
  for (const [name, source] of Object.entries(components)) {
    for (const value of [current.projectId, current.projectNumber, next.projectId, next.projectNumber]) {
      assert.ok(source.includes(value), `${name} config must register ${value}`);
    }
    assert.match(source, /NEW_PROJECT_CONFIG/, `${name} config must carry a NEW_PROJECT_CONFIG block`);
  }
  // The new project's placeholders are never the old project's values.
  const newDart = read("my_flutter_app/lib/firebase_options_new.dart");
  assert.ok(!newDart.includes(current.projectNumber));
});

test("both projects deploy the functions with the same per-project env", () => {
  // `firebase deploy` reads functions/.env.<project id>. A project without
  // one silently loses its settings (PLAID_ENV=production -> sandbox).
  const settings = (projectId) => read(`my_flutter_app/functions/.env.${projectId}`)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .sort();
  const reference = settings(PROJECTS.current.projectId);
  assert.ok(reference.length > 0);
  for (const project of Object.values(PROJECTS)) {
    assert.deepEqual(settings(project.projectId), reference, `.env.${project.projectId}`);
  }
});
