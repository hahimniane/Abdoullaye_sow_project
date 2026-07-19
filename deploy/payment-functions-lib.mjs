import {createRequire} from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

function secretKey(secret) {
  return String(secret?.key || secret || "").trim();
}

export function stripeBoundFunctionNames(functionExports) {
  return Object.entries(functionExports || {})
      .filter(([, handler]) => {
        const secrets = handler?.__endpoint?.secretEnvironmentVariables || [];
        return secrets.some((secret) => secretKey(secret).startsWith("STRIPE_"));
      })
      .map(([name]) => name)
      .sort();
}

export function discoverStripeBoundFunctionNames({
  functionsEntry,
  loadModule = require,
}) {
  const entry = path.resolve(functionsEntry);
  const previousProject = process.env.GCLOUD_PROJECT;
  const previousSimulation = process.env.SIMULATE_PAYMENTS;
  process.env.GCLOUD_PROJECT ||= "payment-manifest-audit";
  process.env.SIMULATE_PAYMENTS ||= "false";
  try {
    return stripeBoundFunctionNames(loadModule(entry));
  } finally {
    if (previousProject === undefined) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = previousProject;
    if (previousSimulation === undefined) delete process.env.SIMULATE_PAYMENTS;
    else process.env.SIMULATE_PAYMENTS = previousSimulation;
  }
}

function deployedFunctionId(row) {
  if (typeof row === "string") return row;
  return String(row?.id || row?.name || "").split("/").at(-1);
}

export function assessPaymentFunctionDeployment({
  requiredFunctionNames,
  deployedFunctions,
}) {
  const deployed = new Map((deployedFunctions || []).map((row) => [
    deployedFunctionId(row),
    row,
  ]).filter(([id]) => id));
  const required = [...new Set(requiredFunctionNames || [])].sort();
  const missing = required.filter((name) => !deployed.has(name));
  const inactive = required.filter((name) => {
    const row = deployed.get(name);
    return row && typeof row !== "string" && row.state !== "ACTIVE";
  });
  const ok = required.length > 0 && missing.length === 0 && inactive.length === 0;
  const problems = [];
  if (required.length === 0) problems.push("no Stripe-bound source exports found");
  if (missing.length > 0) problems.push(`missing: ${missing.join(", ")}`);
  if (inactive.length > 0) problems.push(`inactive: ${inactive.join(", ")}`);
  return {
    ok,
    required,
    missing,
    inactive,
    detail: ok ?
      `${required.length}/${required.length} Stripe-bound functions deployed and ACTIVE` :
      problems.join("; "),
  };
}
