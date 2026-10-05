// Checks on what a static deploy is built from and what it produced.
// Pure functions (plus one injectable env loader) so test/static-build.test.mjs
// covers them without a build, git, or the network.

import fs from "node:fs";
import path from "node:path";

/** Source the deploy builds from or ships, per preflight scope. An untracked
 * file under one of these is code that would ship without being committed. */
export const DEPLOYED_SOURCE_PREFIXES = Object.freeze({
  static: ["admin_web/", "public_site/"],
  backend: [
    "my_flutter_app/functions/",
    "my_flutter_app/firestore.rules",
    "my_flutter_app/storage.rules",
    "my_flutter_app/firestore.indexes.json",
    "my_flutter_app/firebase.json",
  ],
});

export function sourcePrefixesForScope(scope) {
  if (scope === "static") return [...DEPLOYED_SOURCE_PREFIXES.static];
  if (scope === "backend") return [...DEPLOYED_SOURCE_PREFIXES.backend];
  return [...DEPLOYED_SOURCE_PREFIXES.static, ...DEPLOYED_SOURCE_PREFIXES.backend];
}

function unquotePorcelainPath(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * Split `git status --porcelain --untracked-files=all` into modified tracked
 * paths and untracked paths under the deployed source prefixes. Untracked
 * files elsewhere (notes, scratch files) still do not block a deploy.
 */
export function workingTreeState(porcelain, prefixes) {
  const modified = [];
  const untrackedSource = [];
  for (const line of String(porcelain || "").split("\n")) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2);
    const file = unquotePorcelainPath(line.slice(3));
    if (status === "??") {
      if (prefixes.some((prefix) => file === prefix || file.startsWith(prefix))) {
        untrackedSource.push(file);
      }
    } else if (status !== "!!") {
      modified.push(file);
    }
  }
  return {modified, untrackedSource, clean: modified.length === 0 && untrackedSource.length === 0};
}

/**
 * The environment `next build` will see for admin_web: the operator's
 * exported variables over admin_web's .env files, loaded the way Next loads
 * them (@next/env, production mode). process.env is restored afterwards so
 * nothing read from a file leaks into the preflight's own child processes.
 */
export function loadNextBuildEnv({adminDir, nextEnv, processEnv = process.env}) {
  const snapshot = {...processEnv};
  try {
    const result = nextEnv.loadEnvConfig(
        adminDir,
        false,
        {info() {}, warn() {}, error() {}},
        true,
    );
    return {
      env: {...result.combinedEnv},
      files: (result.loadedEnvFiles || []).map((file) => file.path),
    };
  } finally {
    for (const key of Object.keys(processEnv)) {
      if (!(key in snapshot)) delete processEnv[key];
    }
    Object.assign(processEnv, snapshot);
  }
}

const DEBUG_TOKEN_KEY = "NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN";

/**
 * Every App Check debug token the operator has anywhere it could reach a
 * bundle: the build env, plus admin_web's development env files (a dev build
 * copied into out/ carries those).
 */
export function debugTokenValues({env = {}, envFileTexts = []}) {
  const values = new Set();
  const add = (value) => {
    const token = String(value || "").trim().replace(/^(['"])(.*)\1$/, "$2");
    // "true" asks the SDK to mint a token; it is not a secret to search for.
    if (token && token !== "true" && token.length >= 8) values.add(token);
  };
  add(env[DEBUG_TOKEN_KEY]);
  for (const text of envFileTexts) {
    for (const line of String(text).split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN\s*=\s*(.*?)\s*(?:#.*)?$/.exec(line);
      if (match) add(match[1]);
    }
  }
  return [...values];
}

/** Dev-only Firebase settings in the build env. */
export function devFirebaseBuildSettings(env = {}) {
  const problems = [];
  if (String(env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS || "").trim() === "true") {
    problems.push("NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true");
  }
  if (String(env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST || "").trim()) {
    problems.push("NEXT_PUBLIC_FIREBASE_EMULATOR_HOST is set");
  }
  if (String(env[DEBUG_TOKEN_KEY] || "").trim()) {
    problems.push(`${DEBUG_TOKEN_KEY} is set`);
  }
  return {ok: problems.length === 0, problems};
}

const EMULATOR_ADDRESS =
  /\b(?:127\.0\.0\.1|localhost|0\.0\.0\.0):(?:8080|9099|5001|9199|4000|8085)\b/;
const DEBUG_TOKEN_ASSIGNMENT = /FIREBASE_APPCHECK_DEBUG_TOKEN\s*=(?!=)/;

/**
 * Findings for built files ({path, content}). A production bundle reads the
 * emulator switch at runtime (`env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS`) and
 * only ever reads FIREBASE_APPCHECK_DEBUG_TOKEN; a bundle built with the
 * emulators on has the switch compiled away and connects unconditionally.
 */
export function scanStaticBuild(files, {debugTokens = []} = {}) {
  const findings = [];
  for (const {path: file, content} of files) {
    for (const token of debugTokens) {
      if (content.includes(token)) findings.push(`${file}: contains an App Check debug token`);
    }
    if (DEBUG_TOKEN_ASSIGNMENT.test(content)) {
      findings.push(`${file}: sets FIREBASE_APPCHECK_DEBUG_TOKEN (debug provider)`);
    }
    const address = EMULATOR_ADDRESS.exec(content);
    if (address) findings.push(`${file}: contains emulator address ${address[0]}`);
    if (content.includes("__laawolEmulatorsConnected") &&
        !content.includes("NEXT_PUBLIC_USE_FIREBASE_EMULATORS")) {
      findings.push(`${file}: Firebase emulators are compiled in`);
    }
  }
  return findings;
}

const SCANNED_EXTENSIONS = new Set([".js", ".mjs", ".html", ".json", ".txt", ".map"]);

/** Text files under a build output directory, for scanStaticBuild. */
export function readBuildFiles(outDir) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
        files.push({path: path.relative(outDir, full), content: fs.readFileSync(full, "utf8")});
      }
    }
  };
  walk(outDir);
  return files;
}
