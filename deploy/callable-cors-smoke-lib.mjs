export const MARKETPLACE_PEOPLE_CALLABLES = Object.freeze([
  "listMarketplacePeople",
  "getMarketplacePerson",
  "setMarketplaceUserStatus",
  "revokeUserSessions",
  "sendUserRecoveryEmail",
  "invitePlatformAdmin",
  "inviteBusinessMember",
  "resendAccessInvitation",
  "cancelAccessInvitation",
  "acceptAccessInvitation",
  "transferBusinessOwnership",
  "reviewAccountDeletion",
  "finalizeAccountDeletion",
  "listPlatformUsers",
  "createMissingUserProfile",
  "updateBusinessMembership",
  "updateUserRole",
  "setPlatformAdminRole",
  "deleteUser",
]);

const FIREBASE_ID = /^[a-z][a-z0-9-]{4,62}$/;
const REGION = /^[a-z]+-[a-z]+\d$/;
const FUNCTION_NAME = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;

export function callableServiceUrl({projectId, region, functionName}) {
  if (!FIREBASE_ID.test(projectId || "")) {
    throw new Error("Callable smoke project ID is invalid");
  }
  if (!REGION.test(region || "")) {
    throw new Error("Callable smoke region is invalid");
  }
  if (!FUNCTION_NAME.test(functionName || "")) {
    throw new Error("Callable smoke function name is invalid");
  }
  return `https://${region}-${projectId}.cloudfunctions.net/${functionName}`;
}

export function browserCallablePreflightOptions(origin) {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.protocol !== "https:" || parsedOrigin.pathname !== "/") {
    throw new Error("Callable smoke origin must be an HTTPS origin");
  }
  return {
    method: "OPTIONS",
    redirect: "manual",
    headers: {
      origin: parsedOrigin.origin,
      "access-control-request-method": "POST",
      "access-control-request-headers":
        "authorization,content-type,x-firebase-appcheck",
      "user-agent": "Laawol-Release-Smoke/1.0",
    },
  };
}

export function assessCallablePreflight(functionName, result) {
  const status = Number(result?.status || 0);
  const ok = status >= 200 && status < 300;
  return {
    functionName,
    status,
    ok,
    detail: ok ?
      `HTTP ${status}` :
      `browser CORS preflight returned HTTP ${status || "no response"}`,
  };
}

export async function smokeMarketplacePeopleCallableCors({
  projectId,
  region = "us-central1",
  origin = "https://admin.laawoldigital.com",
  functionNames = MARKETPLACE_PEOPLE_CALLABLES,
  request = fetch,
}) {
  const options = browserCallablePreflightOptions(origin);
  const checks = [];
  for (const functionName of functionNames) {
    const url = callableServiceUrl({projectId, region, functionName});
    try {
      const response = await request(url, options);
      checks.push(assessCallablePreflight(functionName, response));
    } catch (error) {
      checks.push({
        functionName,
        status: 0,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const failed = checks.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    checks,
    failed,
    detail: failed.length === 0 ?
      `${checks.length}/${checks.length} callable CORS preflights passed` :
      `${failed.length}/${checks.length} callable CORS preflights failed: ` +
        failed.map((check) =>
          `${check.functionName} (${check.detail})`).join(", "),
  };
}
