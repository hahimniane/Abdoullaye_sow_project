// The one place the deploy tooling learns which Firebase/GCP project it
// targets. Values live in project-config.json (also read by store/gate.py);
// nothing else under deploy/ may hardcode a project id, project number, or a
// <region>-<project>.cloudfunctions.net host (guarded by
// test/project-migration-guard.test.mjs).
//
// Resolution order for the project a single run targets:
//   1. `--project <id>` / `--project=<id>` on the command line
//   2. FIREBASE_PROJECT in the environment (an id, or "current" / "new")
//   3. the `active` entry of project-config.json  (the production project)
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_CONFIG_PATH = path.join(here, "project-config.json");

export function loadProjectConfig(file = PROJECT_CONFIG_PATH) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const projects = parsed.projects || {};
  if (!projects[parsed.active]) {
    throw new Error(
        `project-config.json: active "${parsed.active}" is not one of ` +
        `${Object.keys(projects).join(", ")}`,
    );
  }
  for (const [key, entry] of Object.entries(projects)) {
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(entry.projectId || "")) {
      throw new Error(`project-config.json: ${key}.projectId is not valid`);
    }
  }
  return parsed;
}

const config = loadProjectConfig();

/** The project this checkout treats as PRODUCTION. */
export const ACTIVE_PROJECT = config.projects[config.active];
export const DEFAULT_PROJECT_ID = ACTIVE_PROJECT.projectId;
export const DEFAULT_REGION = ACTIVE_PROJECT.region;
export const PROJECTS = config.projects;

function projectFlag(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project") return argv[i + 1] || "";
    if (arg.startsWith("--project=")) return arg.slice("--project=".length);
  }
  return "";
}

/** Resolve the project id one run targets (see the order at the top). */
export function resolveProjectId({
  env = process.env,
  argv = process.argv.slice(2),
  projects = PROJECTS,
  fallback = DEFAULT_PROJECT_ID,
} = {}) {
  const requested = String(projectFlag(argv) || env.FIREBASE_PROJECT || "")
      .trim();
  if (!requested) return fallback;
  return projects[requested] ? projects[requested].projectId : requested;
}

/** The functions region for a project id (falls back to the active region). */
export function resolveRegion({
  env = process.env,
  projectId = resolveProjectId({env}),
  projects = PROJECTS,
  envName = "FUNCTIONS_REGION",
} = {}) {
  if (env[envName]) return env[envName];
  const known = Object.values(projects).find((p) => p.projectId === projectId);
  return known ? known.region : DEFAULT_REGION;
}
