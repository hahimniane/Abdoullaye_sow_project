"use strict";

/**
 * Who is calling, for abuse limits - kept pure so it can be unit-tested
 * without an emulator.
 *
 * Client address behind Google's front end
 * ----------------------------------------
 * Cloud Functions v2 runs on Cloud Run. Every request reaches the container
 * through the Google Front End (GFE), which *appends* the address it accepted
 * the connection from to whatever X-Forwarded-For the caller sent:
 *
 *     X-Forwarded-For: <anything the caller wrote>, <real client address>
 *
 * The left-most entries are therefore attacker-controlled: a script can send
 * `X-Forwarded-For: 1.2.3.4` and, when we read entry [0], get a fresh rate
 * limit bucket on every request. Google's header reference only says the
 * first entry is "generally" the client - true for honest browsers, useless
 * against abuse. The only entry a caller cannot forge is the one Google
 * added, i.e. the right-most one when the function is invoked directly
 * (`*.cloudfunctions.net` / `*.run.app`, which is how every Laawol client
 * calls it).
 *
 * If a Google proxy is ever put in front - an external Application Load
 * Balancer, or a Firebase Hosting rewrite - that proxy appends its own
 * address as well (`<client>, <load-balancer>`), and the client becomes the
 * second entry from the right. Set TRUSTED_PROXY_HOPS to the number of
 * Google-added entries (default 1) rather than going back to entry [0].
 *
 * `request.ip` is not used for the decision: with Express "trust proxy"
 * enabled it is the left-most (spoofable) entry, and without it, it is the
 * Cloud Run sidecar's link-local address that every caller shares. It is
 * only a last-resort fallback when no usable header is present (local runs).
 */

const net = require("node:net");

const DEFAULT_TRUSTED_PROXY_HOPS = 1;

function trustedProxyHops(env = process.env) {
  const parsed = Number.parseInt(String(env.TRUSTED_PROXY_HOPS || ""), 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ?
    parsed :
    DEFAULT_TRUSTED_PROXY_HOPS;
}

function headerValue(headers, name) {
  if (!headers) return "";
  const raw = typeof headers.get === "function" ?
    headers.get(name) :
    headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw.join(",");
  return typeof raw === "string" ? raw : "";
}

function normalizeAddress(value) {
  let address = String(value || "").trim();
  if (!address) return "";
  // "[2001:db8::1]:443" or "203.0.113.9:443" - strip a port if present.
  const bracketed = address.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) address = bracketed[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(address)) {
    address = address.slice(0, address.lastIndexOf(":"));
  }
  if (address.startsWith("::ffff:") && net.isIPv4(address.slice(7))) {
    address = address.slice(7);
  }
  return net.isIP(address) ? address.toLowerCase() : "";
}

/**
 * The caller's address as seen by Google's front end.
 *
 * @param {object} rawRequest an Express/Node request (callable rawRequest or
 *     an onRequest req)
 * @param {object} [options] `trustedHops`: Google-added XFF entries
 *     (defaults to TRUSTED_PROXY_HOPS, else 1)
 * @return {string} an IP address, or "unknown"
 */
function clientAddressFromRequest(rawRequest, options = {}) {
  const hops = Number.isInteger(options.trustedHops) &&
    options.trustedHops >= 1 ?
    options.trustedHops :
    trustedProxyHops();
  const entries = headerValue(rawRequest?.headers, "x-forwarded-for")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  if (entries.length >= hops) {
    const address = normalizeAddress(entries[entries.length - hops]);
    if (address) return address;
  }
  const fallback = normalizeAddress(
      rawRequest?.socket?.remoteAddress || rawRequest?.ip,
  );
  return fallback || "unknown";
}

/**
 * The rate-limit bucket for a caller.
 *
 * A signed-in account is limited per uid. An anonymous (guest) session is
 * limited per address instead: anyone can mint a fresh anonymous uid per
 * request, so a per-uid bucket would cap nobody. Unauthenticated callers are
 * limited per address too - deliberately the same bucket as an anonymous
 * session from that address.
 *
 * @param {object|null|undefined} auth the callable request's auth
 * @param {boolean} anonymous whether that auth is an anonymous session
 * @param {string} address the caller's address
 * @return {string}
 */
function rateLimitIdentity(auth, anonymous, address) {
  if (auth?.uid && !anonymous) return auth.uid;
  return address || "unknown";
}

/**
 * The App Check token a plain HTTPS (onRequest) caller sent. The Firebase
 * SDKs send it as `X-Firebase-AppCheck`; callables get this for free, raw
 * endpoints must read and verify it themselves.
 *
 * @param {object} headers request headers
 * @return {string}
 */
function appCheckTokenFromHeaders(headers) {
  const token = headerValue(headers, "x-firebase-appcheck").trim();
  // A JWT; anything absurdly long is not one and is not worth verifying.
  return token.length > 0 && token.length <= 4096 ? token : "";
}

module.exports = {
  DEFAULT_TRUSTED_PROXY_HOPS,
  appCheckTokenFromHeaders,
  clientAddressFromRequest,
  normalizeAddress,
  rateLimitIdentity,
  trustedProxyHops,
};
