import http from "node:http";
import https from "node:https";
import net from "node:net";

export function pinnedLookup(ipv4) {
  if (net.isIP(ipv4) !== 4) {
    throw new Error(`Pinned smoke-test IPv4 is invalid: ${ipv4 || "empty"}`);
  }
  return (_hostname, options, callback) => {
    if (options?.all) {
      callback(null, [{address: ipv4, family: 4}]);
      return;
    }
    callback(null, ipv4, 4);
  };
}

export function pinnedRequestOptions(url, ipv4) {
  const target = url instanceof URL ? url : new URL(url);
  return {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    path: `${target.pathname}${target.search}`,
    method: "GET",
    servername: target.hostname,
    headers: {
      accept: "text/html,application/xhtml+xml,application/javascript,*/*;q=0.8",
      host: target.host,
      "user-agent": "Laawol-Release-Smoke/1.0",
    },
    lookup: pinnedLookup(ipv4),
  };
}

export async function requestPinned({
  url,
  ipv4,
  timeoutMs = 15_000,
  allowedHostnames,
  redirectsRemaining = 5,
  requestHttp = http.request,
  requestHttps = https.request,
}) {
  const target = url instanceof URL ? url : new URL(url);
  const allowed = new Set(allowedHostnames || [target.hostname]);
  if (!allowed.has(target.hostname)) {
    throw new Error(`Smoke-test redirect host is not allowlisted: ${target.hostname}`);
  }
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error(`Unsupported smoke-test protocol: ${target.protocol}`);
  }

  const response = await new Promise((resolve, reject) => {
    const requestImpl = target.protocol === "https:" ? requestHttps : requestHttp;
    const request = requestImpl(pinnedRequestOptions(target, ipv4), (incoming) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      incoming.on("end", () => resolve({
        status: incoming.statusCode || 0,
        headers: incoming.headers || {},
        body: Buffer.concat(chunks).toString("utf8"),
      }));
      incoming.on("error", reject);
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
    request.on("error", reject);
    request.end();
  });

  if ([301, 302, 303, 307, 308].includes(response.status) &&
      response.headers.location) {
    if (redirectsRemaining <= 0) {
      throw new Error("Smoke-test redirect limit exceeded");
    }
    return requestPinned({
      url: new URL(response.headers.location, target),
      ipv4,
      timeoutMs,
      allowedHostnames: allowed,
      redirectsRemaining: redirectsRemaining - 1,
      requestHttp,
      requestHttps,
    });
  }

  return {
    status: response.status,
    text: async () => response.body,
  };
}

/**
 * Every /_next/ script and stylesheet a console's index.html names - script
 * tags, preloads, and the chunk lists inside the inline RSC payload (which
 * escapes its quotes). A deploy that uploads index.html but drops one chunk
 * leaves a page that loads and then fails to hydrate; checking only the first
 * asset missed exactly that.
 */
export function nextAssetPaths(html) {
  const found = new Set();
  const pattern = /\/_next\/static\/[A-Za-z0-9_.~\/-]+?\.(?:js|css)(?![A-Za-z0-9_])/g;
  for (const match of String(html || "").matchAll(pattern)) found.add(match[0]);
  return [...found].sort();
}

export function remoteStaticSmokeScript({marketingHost, consoleHosts}) {
  const hosts = [marketingHost, ...(consoleHosts || [])];
  if (hosts.some((hostname) =>
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(hostname)
  )) {
    throw new Error("Remote smoke host is invalid");
  }
  const consoleChecks = consoleHosts.map((hostname) => `
html=$(curl -fsSL --connect-timeout 5 --max-time 20 \\
  --resolve "${hostname}:443:127.0.0.1" "https://${hostname}/")
assets=$(printf '%s' "$html" | grep -oE '/_next/static/[A-Za-z0-9_./~-]+\\.(js|css)' | sort -u)
test -n "$assets"
count=0
for asset in $assets; do
  curl -fsSL --connect-timeout 5 --max-time 20 \\
    --resolve "${hostname}:443:127.0.0.1" \\
    -o /dev/null "https://${hostname}$asset"
  count=$((count + 1))
done
printf 'OK ${hostname} and all %s /_next assets - HTTP 200\\n' "$count"
`).join("");

  return `set -eu
curl -fsSL --connect-timeout 5 --max-time 20 \\
  --resolve "${marketingHost}:443:127.0.0.1" \\
  -o /dev/null "https://${marketingHost}/"
printf 'OK ${marketingHost} - HTTP 200\\n'
curl -fsSL --connect-timeout 5 --max-time 20 \\
  --resolve "${marketingHost}:443:127.0.0.1" \\
  -o /dev/null "https://${marketingHost}/get-app.html"
printf 'OK ${marketingHost}/get-app.html - HTTP 200\\n'
${consoleChecks}`;
}
