import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {Readable} from "node:stream";
import {test} from "node:test";

import {
  pinnedLookup,
  pinnedRequestOptions,
  remoteStaticSmokeScript,
  requestPinned,
} from "../smoke-lib.mjs";

test("pinned static smoke preserves hostname and bypasses local DNS", () => {
  const options = pinnedRequestOptions(
      "https://admin.laawoldigital.com/_next/runtime.js?x=1",
      "46.202.183.189",
  );
  assert.equal(options.hostname, "admin.laawoldigital.com");
  assert.equal(options.servername, "admin.laawoldigital.com");
  assert.equal(options.headers.host, "admin.laawoldigital.com");
  assert.equal(options.path, "/_next/runtime.js?x=1");

  options.lookup("admin.laawoldigital.com", {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, "46.202.183.189");
    assert.equal(family, 4);
  });
  options.lookup("admin.laawoldigital.com", {all: true}, (error, addresses) => {
    assert.equal(error, null);
    assert.deepEqual(addresses, [{address: "46.202.183.189", family: 4}]);
  });
});

test("pinned lookup rejects invalid release addresses", () => {
  assert.throws(() => pinnedLookup("18.204.152.241.example"), /IPv4 is invalid/);
});

test("pinned smoke follows only allowlisted redirects", async () => {
  const seen = [];
  const fakeRequest = (options, onResponse) => {
    seen.push(options);
    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = (error) => request.emit("error", error);
    request.end = () => {
      const response = Readable.from(seen.length === 1 ? [""] : ["ready"]);
      response.statusCode = seen.length === 1 ? 302 : 200;
      response.headers = seen.length === 1 ? {location: "/ready"} : {};
      onResponse(response);
    };
    return request;
  };

  const response = await requestPinned({
    url: "https://laawoldigital.com/",
    ipv4: "46.202.183.189",
    allowedHostnames: ["laawoldigital.com"],
    requestHttps: fakeRequest,
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ready");
  assert.deepEqual(seen.map((options) => options.path), ["/", "/ready"]);
  assert.equal(seen.every((options) => options.lookup instanceof Function), true);

  await assert.rejects(requestPinned({
    url: "https://evil.example/",
    ipv4: "46.202.183.189",
    allowedHostnames: ["laawoldigital.com"],
    requestHttps: fakeRequest,
  }), /redirect host is not allowlisted/);
});

test("remote static smoke verifies HTTPS pages and console runtime assets", () => {
  const script = remoteStaticSmokeScript({
    marketingHost: "laawoldigital.com",
    consoleHosts: ["admin.laawoldigital.com", "business.laawoldigital.com"],
  });
  assert.match(script, /--resolve "laawoldigital\.com:443:127\.0\.0\.1"/);
  assert.match(script, /--resolve "admin\.laawoldigital\.com:443:127\.0\.0\.1"/);
  assert.match(script, /\/_next\//);
  assert.match(script, /https:\/\/business\.laawoldigital\.com\$asset/);
  assert.throws(() => remoteStaticSmokeScript({
    marketingHost: "laawoldigital.com; rm -rf /",
    consoleHosts: [],
  }), /host is invalid/);
});
