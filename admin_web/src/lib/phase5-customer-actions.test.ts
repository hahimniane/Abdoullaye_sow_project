import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  MAERSK_TRACKING_URL,
  buildOpenSupportCasePayload,
  buildSupportCaseIdPayload,
  buildSupportMessagePayload,
  buildSupportTypingPayload,
  safeCustomerTrackingUrl,
  trackingCodeFor,
} from "./phase5-customer-actions.ts";

test("phase 5 support builders preserve the mobile callable contracts", () => {
  const reference = {
    collection: "barrelShipments",
    id: "shipment-1",
    label: "LW-100",
  };
  assert.deepEqual(
    buildOpenSupportCasePayload({
      reference,
      subject: "Pickup question",
      message: "When is pickup?",
      priority: "urgent",
    }),
    {
      relatedCollection: "barrelShipments",
      relatedId: "shipment-1",
      subject: "Pickup question",
      message: "When is pickup?",
      priority: "urgent",
    },
  );
  assert.deepEqual(buildSupportMessagePayload("case-1", "Thank you"), {
    caseId: "case-1",
    content: "Thank you",
    messageType: "text",
  });
  assert.deepEqual(buildSupportCaseIdPayload("case-1"), { caseId: "case-1" });
  assert.deepEqual(buildSupportTypingPayload("case-1", true), {
    caseId: "case-1",
    typing: true,
  });
});

test("tracking follows the mobile Maersk handoff and rejects unsafe URLs", () => {
  assert.equal(MAERSK_TRACKING_URL, "https://www.maersk.com/tracking");
  assert.equal(safeCustomerTrackingUrl("javascript:alert(1)"), MAERSK_TRACKING_URL);
  assert.equal(
    safeCustomerTrackingUrl("https://www.maersk.com/tracking/ABC"),
    "https://www.maersk.com/tracking/ABC",
  );
  assert.equal(
    safeCustomerTrackingUrl("https://carrier.example/track/ABC"),
    MAERSK_TRACKING_URL,
  );
  assert.equal(
    trackingCodeFor({ containerNumber: "  MSKU1234567 " }),
    "MSKU1234567",
  );
});

test("phase 5 components use exact callables and ownership-scoped support reads", () => {
  const support = readFileSync("src/components/customer-support.tsx", "utf8");
  assert.match(support, /where\("customerUid", "==", uid\)/);
  assert.match(support, /"createOrOpenSupportCase"/);
  assert.match(support, /"sendSupportMessage"/);
  assert.match(support, /"markSupportCaseRead"/);
  assert.match(support, /"setSupportTyping"/);
  assert.match(support, /"uploadSupportAttachmentMetadata"/);
});

test("the shared public-site script adds a clear customer login without duplicates", () => {
  const source = readFileSync("../public_site/assets/script.js", "utf8");
  assert.match(source, /https:\/\/customer\.laawoldigital\.com/);
  assert.match(source, /data-customer-login/);
  assert.ok(source.includes(`[data-customer-login="true"]`));
  assert.match(source, /a\[href="https:\/\/customer\.laawoldigital\.com"\]/);
  assert.match(source, /\? "Log in"\s*: "Se connecter"/);
  assert.doesNotMatch(source, /Customer workspace|Espace client/);
});

test("every public HTML page loads the shared customer CTA mechanism", () => {
  const pages = readdirSync("../public_site").filter((file) =>
    file.endsWith(".html"),
  );
  assert.ok(pages.length >= 10);
  for (const page of pages) {
    const html = readFileSync(`../public_site/${page}`, "utf8");
    assert.match(html, /assets\/script\.js\?v=13/, page);
  }
});

test("public service cards expose a visible action and keyboard focus state", () => {
  const styles = readFileSync("../public_site/assets/styles.css", "utf8");
  const services = readFileSync("../public_site/services.html", "utf8");
  assert.match(styles, /a\.service-card\{[\s\S]*display:flex/);
  assert.match(styles, /a\.service-card \.link-arrow\{[\s\S]*min-height:44px/);
  assert.match(styles, /\.service-card:focus-visible/);
  assert.equal((services.match(/class="service-card"/g) ?? []).length, 6);
  assert.equal((services.match(/class="link-arrow"/g) ?? []).length, 6);
});
