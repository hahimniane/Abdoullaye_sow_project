// Every piece of WhatsApp copy the consoles show has its French
// (guardrails §5): the labels built in whatsapp-conversations.ts, and the
// static copy of the thread, the panel and "Message customer".

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { TEXT_TRANSLATIONS } from "./french-dom.ts";
import { packageUpdateTick } from "./package-staff.ts";
import {
  INBOX_MODES,
  WHATSAPP_FILTERS,
  WHATSAPP_STATE_LABELS,
  deliveryResultText,
  deliveryTick,
  whatsappMessagesHint,
} from "./whatsapp-conversations.ts";

test("every WhatsApp label has a French translation", () => {
  const labels = [
    ...Object.values(WHATSAPP_STATE_LABELS),
    ...WHATSAPP_FILTERS.map((f) => f.label),
    ...INBOX_MODES.flatMap((m) => [m.label, m.explanation, `Switch to ${m.label}`]),
    ...["sent", "delivered", "read", "failed", "waiting_for_reply"].map((status) => deliveryTick({ metadata: { whatsapp: { status } } }).label),
    deliveryTick({ metadata: { whatsapp: { status: "waiting_for_reply", stopped: true } } }).label,
    ...["sent", "waiting", "stopped", "failed"].map((d) => deliveryResultText(d)?.text ?? ""),
    whatsappMessagesHint("staff"),
    whatsappMessagesHint("businessOwner"),
    ...(["delivered", "read"] as const).flatMap((d) => {
      const tick = packageUpdateTick("receiver", d);
      return tick ? [tick.label, tick.who] : ["missing tick"];
    }),
    packageUpdateTick("sender", "read")?.who ?? "missing who",
  ];
  const missing = labels.filter((label) => !TEXT_TRANSLATIONS[label]);
  assert.deepEqual(missing, []);
});

test("the WhatsApp components' static copy is translated", () => {
  const files = [
    "src/components/support/whatsapp-thread.tsx",
    "src/components/support/message-customer.tsx",
  ];
  const missing: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    // JSX text between tags that is a sentence or label (letters, spaces, punctuation).
    for (const match of source.matchAll(/(?<!=)>\s*([A-Z][A-Za-z' ,.…()—-]{2,})\s*</g)) {
      const value = match[1].trim();
      if (value === "WhatsApp" || value === "Laawol") continue;
      if (!TEXT_TRANSLATIONS[value]) missing.push(`${file}: ${value}`);
    }
    for (const match of source.matchAll(/(?:placeholder|aria-label|title)="([^"]+)"/g)) {
      if (!TEXT_TRANSLATIONS[match[1]]) missing.push(`${file}: ${match[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});
