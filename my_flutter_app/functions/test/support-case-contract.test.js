const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const SUPPORT_CALABLES = [
  "createOrOpenSupportCase",
  "createBusinessPlatformSupportCase",
  "sendSupportMessage",
  "uploadSupportAttachmentMetadata",
  "markSupportCaseRead",
  "setSupportTyping",
  "escalateSupportCase",
  "assignSupportCase",
  "requestSupportEvidence",
  "resolveSupportCase",
  "reopenSupportCase",
  "addSupportInternalNote",
];

describe("support case callable contract", () => {
  it("exports every marketplace support callable", () => {
    const script = `
      process.env.GCLOUD_PROJECT = "demo-test";
      const functions = require("./index");
      const names = ${JSON.stringify(SUPPORT_CALABLES)};
      process.stdout.write(JSON.stringify(
        Object.fromEntries(names.map((name) => [
          name,
          Boolean(functions[name] && functions[name].__endpoint),
        ])),
      ));
    `;
    const output = execFileSync(process.execPath, ["-e", script], {
      cwd: __dirname + "/..",
      env: {
        ...process.env,
        GCLOUD_PROJECT: "demo-test",
      },
      encoding: "utf8",
    });
    const exported = JSON.parse(output);
    for (const name of SUPPORT_CALABLES) {
      assert.equal(exported[name], true, name);
    }
  });

  it("keeps support escalation and notification preference hooks", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    const notificationSource = fs.readFileSync(
        path.join(__dirname, "..", "notification_settings.js"),
        "utf8",
    );
    assert.match(source, /SUPPORT_URGENT_ESCALATION_REASONS/);
    assert.match(source, /addBusinessDays\(nowDate, 3\)/);
    assert.match(source, /escalationAvailableAt/);
    assert.match(notificationSource, /supportMessages/);
    assert.match(notificationSource, /supportEscalations/);
    assert.match(notificationSource, /supportCaseUpdates/);
  });

  it("keeps wallet refund support cases platform-owned when no business exists",
      () => {
        const source = fs.readFileSync(
            path.join(__dirname, "..", "index.js"),
            "utf8",
        );
        assert.match(
            source,
            /walletRefundRequests:\s*{[\s\S]*platformOwned: true/,
        );
        assert.match(source, /businessId = "__platform_support"/);
        assert.match(source, /"Laawol support"/);
      });
});
