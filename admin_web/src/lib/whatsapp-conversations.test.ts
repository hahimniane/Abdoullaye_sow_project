import assert from "node:assert/strict";
import { test } from "node:test";

import {
  businessSupportAccess,
  chatDisplayName,
  chooseRecorderMime,
  conversationPackages,
  deliveryResultText,
  deliveryTick,
  durationText,
  handoffOptionsFrom,
  inboxModeOf,
  INBOX_MODES,
  isWhatsAppCase,
  messageMedia,
  messageMediaKind,
  packageContainerStatusText,
  packageMessageContacts,
  recordingFile,
  whatsappFilterCounts,
  whatsappFilterMatches,
  whatsappInboxLabel,
  whatsappMessageKind,
  whatsappMessagesHint,
  whatsappMessagesOn,
  whatsappPhone,
  whatsappStateOf,
} from "./whatsapp-conversations.ts";

const thread = (whatsappState: string, extra: Record<string, unknown> = {}) => ({ caseType: "whatsapp", whatsappState, ...extra });

test("a conversation is a Support case with caseType whatsapp", () => {
  assert.equal(isWhatsAppCase(thread("needs_reply")), true);
  assert.equal(isWhatsAppCase({ caseType: "business_platform" }), false);
  assert.equal(isWhatsAppCase(null), false);
});

test("the state comes from whatsappState, else the mirrored Support status", () => {
  assert.equal(whatsappStateOf(thread("choosing")), "choosing");
  assert.equal(whatsappStateOf(thread("done")), "done");
  assert.equal(whatsappStateOf({ caseType: "whatsapp", status: "resolved" }), "done");
  assert.equal(whatsappStateOf({ caseType: "whatsapp", status: "waiting_for_customer" }), "waiting_customer");
  assert.equal(whatsappStateOf({ caseType: "whatsapp", status: "waiting_for_business" }), "needs_reply");
  assert.equal(whatsappStateOf({ caseType: "whatsapp", whatsappState: "weird" }), "needs_reply");
});

test("the state filter: asking which business waits on the customer", () => {
  assert.equal(whatsappFilterMatches(thread("needs_reply"), "needs_reply"), true);
  assert.equal(whatsappFilterMatches(thread("choosing"), "waiting_customer"), true);
  assert.equal(whatsappFilterMatches(thread("choosing"), "needs_reply"), false);
  assert.equal(whatsappFilterMatches(thread("done"), "done"), true);
  assert.equal(whatsappFilterMatches(thread("done"), "all"), true);
  const counts = whatsappFilterCounts([
    thread("needs_reply"), thread("needs_reply"), thread("choosing"), thread("waiting_customer"), thread("done"),
    { caseType: "car_purchase", status: "open" },
  ]);
  assert.deepEqual(counts, { needs_reply: 2, waiting_customer: 2, done: 1, all: 5 });
});

test("Laawol's list names who answers: the business, or Laawol with its suggestion", () => {
  assert.deepEqual(whatsappInboxLabel({ businessId: "b1", businessName: "Nensona" }), { owner: "Nensona", isLaawol: false, suggested: "" });
  assert.deepEqual(
    whatsappInboxLabel({ businessId: "", businessName: "Laawol", suggestedBusinessName: "Keren" }),
    { owner: "Laawol", isLaawol: true, suggested: "Keren" },
  );
});

test("message kinds: customer, staff, automatic reply, private note, system line", () => {
  assert.equal(whatsappMessageKind({ senderRole: "customer", metadata: { whatsapp: { direction: "in" } } }), "customer");
  assert.equal(whatsappMessageKind({ senderRole: "business", metadata: { whatsappLabel: "Mamadou (Nensona)" } }), "staff");
  assert.equal(whatsappMessageKind({ senderRole: "admin" }), "staff");
  assert.equal(whatsappMessageKind({ senderRole: "system", messageType: "system", metadata: { auto: true } }), "auto");
  assert.equal(whatsappMessageKind({ senderRole: "business", metadata: { note: true } }), "note");
  assert.equal(whatsappMessageKind({ senderRole: "system", messageType: "system", metadata: { note: true, handoff: true } }), "system");
});

test("delivery ticks: sent ✓, delivered ✓✓, read ✓✓, failed with WhatsApp's reason, held for a reply", () => {
  const tick = (status: string, extra: Record<string, unknown> = {}) => deliveryTick({ metadata: { whatsapp: { status, ...extra } } });
  assert.deepEqual([tick("sent").ticks, tick("sent").label], ["✓", "Sent"]);
  assert.deepEqual([tick("delivered").ticks, tick("delivered").label], ["✓✓", "Delivered"]);
  assert.deepEqual([tick("read").ticks, tick("read").label, tick("read").status], ["✓✓", "Read by the customer", "read"]);
  const failed = tick("failed", { error: "Message undeliverable" });
  assert.deepEqual([failed.status, failed.label, failed.error], ["failed", "Not delivered", "Message undeliverable"]);
  assert.equal(
    tick("waiting_for_reply").label,
    "Waits for the customer to write — we sent them a WhatsApp asking them to reply",
  );
  assert.equal(tick("waiting_for_reply", { stopped: true }).stopped, true);
  assert.equal(deliveryTick({ metadata: {} }).status, "none");
  assert.equal(deliveryTick(null).label, "");
});

test("what the send result says to the sender", () => {
  assert.deepEqual(deliveryResultText("sent"), { text: "Sent", tone: "ok" });
  assert.deepEqual(deliveryResultText("waiting"), { text: "Will be delivered when the customer writes", tone: "info" });
  assert.deepEqual(deliveryResultText("stopped"), { text: "The customer stopped updates", tone: "warn" });
  assert.deepEqual(deliveryResultText("failed"), { text: "Not delivered", tone: "error" });
  assert.equal(deliveryResultText("skipped"), null);
  assert.equal(deliveryResultText(undefined), null);
});

test("files: the player follows the message type, then the mime type", () => {
  assert.equal(messageMediaKind("voice", "audio/ogg"), "audio");
  assert.equal(messageMediaKind("file", "audio/webm"), "audio");
  assert.equal(messageMediaKind("video", ""), "video");
  assert.equal(messageMediaKind("image", ""), "image");
  assert.equal(messageMediaKind("file", "application/pdf"), "file");
  const voice = messageMedia({ messageType: "voice", metadata: { fileUrl: "https://x/v.ogg", mimeType: "audio/ogg; codecs=opus" } });
  assert.equal(voice?.kind, "audio");
  assert.equal(messageMedia({ messageType: "text", content: "hi" }), null);
  const deleted = messageMedia({ messageType: "image", metadata: { fileUrl: "", mediaDeleted: true } });
  assert.deepEqual([deleted?.deleted, deleted?.url], [true, ""]);
  assert.equal(messageMedia({ messageType: "image", metadata: { mediaError: "File too large" } })?.error, "File too large");
});

test("voice notes record ogg/opus first, then mp4, and say when WhatsApp will get a file", () => {
  assert.deepEqual(chooseRecorderMime(() => true), { recorderMime: "audio/ogg;codecs=opus", playsOnWhatsApp: true });
  // Safari: mp4 only.
  assert.deepEqual(chooseRecorderMime((m) => m.startsWith("audio/mp4")), { recorderMime: "audio/mp4;codecs=mp4a.40.2", playsOnWhatsApp: true });
  // Chrome: webm only - still recorded, sent as a document.
  assert.deepEqual(chooseRecorderMime((m) => m.startsWith("audio/webm")), { recorderMime: "audio/webm;codecs=opus", playsOnWhatsApp: false });
  assert.deepEqual(chooseRecorderMime(() => false), { recorderMime: "", playsOnWhatsApp: false });
  assert.deepEqual(chooseRecorderMime(() => { throw new Error("no"); }), { recorderMime: "", playsOnWhatsApp: false });
});

test("a recording uploads with its plain type and a matching name", () => {
  assert.deepEqual(recordingFile("audio/ogg;codecs=opus", "", 1000), { mimeType: "audio/ogg", fileName: "voice-note-1000.ogg", playsOnWhatsApp: true });
  assert.deepEqual(recordingFile("", "audio/mp4;codecs=mp4a.40.2", 5), { mimeType: "audio/mp4", fileName: "voice-note-5.m4a", playsOnWhatsApp: true });
  assert.deepEqual(recordingFile("audio/webm;codecs=opus", "", 7), { mimeType: "audio/webm", fileName: "voice-note-7.webm", playsOnWhatsApp: false });
  assert.equal(durationText(42_000), "0:42");
  assert.equal(durationText(125_900), "2:05");
  assert.equal(durationText(-5), "0:00");
});

test("everyone answers WhatsApp; only the Support permission opens every case", () => {
  assert.deepEqual(businessSupportAccess(true), { whatsappOnly: false, canReplyToCases: true });
  assert.deepEqual(businessSupportAccess(false), { whatsappOnly: true, canReplyToCases: false });
});

test("only a number with its country code can be messaged", () => {
  assert.equal(whatsappPhone("+224 621 00 00 01"), "+224621000001");
  assert.equal(whatsappPhone("(347) 559-6214"), "");
  assert.equal(whatsappPhone("+0123456789"), "");
  assert.equal(whatsappPhone(undefined), "");
});

test("a package's people to message: sender then receiver, each once", () => {
  assert.deepEqual(
    packageMessageContacts({ ownerKind: "customer", customerName: "Awa", customerPhone: "+13475550101", receiverName: "Ibrahima", receiverPhone: "+224621000001" }),
    [
      { role: "sender", name: "Awa", phone: "+13475550101" },
      { role: "receiver", name: "Ibrahima", phone: "+224621000001" },
    ],
  );
  // Stock: no customer, the receiver only.
  assert.deepEqual(
    packageMessageContacts({ ownerKind: "stock", customerPhone: "+13475550101", receiverName: "R", receiverPhone: "+224621000001" }).map((c) => c.role),
    ["receiver"],
  );
  // A local number is skipped; the same number twice is one person.
  assert.deepEqual(packageMessageContacts({ customerPhone: "6210000", receiverPhone: "+224621000001" }).map((c) => c.role), ["receiver"]);
  assert.deepEqual(packageMessageContacts({ customerPhone: "+224621000001", receiverPhone: "+224621000001" }).map((c) => c.role), ["sender"]);
  // A package request names sender/receiver objects.
  assert.deepEqual(
    packageMessageContacts({ sender: { name: "Awa", phoneE164: "+13475550101" }, receiver: { name: "", phoneE164: "" } }),
    [{ role: "sender", name: "Awa", phone: "+13475550101" }],
  );
});

test("WhatsApp messages: owners on unless off, staff off until on", () => {
  assert.equal(whatsappMessagesOn("businessOwner", {}), true);
  assert.equal(whatsappMessagesOn("businessOwner", { whatsappMessages: false }), false);
  assert.equal(whatsappMessagesOn("staff", {}), false);
  assert.equal(whatsappMessagesOn("staff", undefined), false);
  assert.equal(whatsappMessagesOn("staff", { whatsappMessages: true }), true);
  assert.equal(whatsappMessagesOn("admin", null), true);
  assert.match(whatsappMessagesHint("staff"), /Off until you turn it on/);
  assert.match(whatsappMessagesHint("businessOwner"), /On unless you turn it off/);
});

test("the name customers see defaults to the first name", () => {
  assert.equal(chatDisplayName({ fullName: "Mamadou Diallo" }), "Mamadou");
  assert.equal(chatDisplayName({ fullName: "Mamadou Diallo", chatDisplayName: "Mams" }), "Mams");
  assert.equal(chatDisplayName({}), "");
});

test("inbox modes: two, each explained and confirmed in both languages", () => {
  assert.deepEqual(INBOX_MODES.map((m) => m.id), ["laawol_only", "businesses"]);
  for (const mode of INBOX_MODES) {
    assert.ok(mode.explanation && mode.confirm && mode.confirmFr, mode.id);
  }
  assert.equal(inboxModeOf({ success: true, mode: "businesses" }), "businesses");
  assert.equal(inboxModeOf("laawol_only"), "laawol_only");
  assert.equal(inboxModeOf({ mode: "other" }), "");
});

test("the packages header reads the callable's list", () => {
  assert.deepEqual(conversationPackages({ packages: [
    { id: "l1", trackingCode: "NEN-1", kind: "barrel", description: "2 barrels", containerId: "c1", containerStatus: "shipped", destination: "Guinea", role: "receiver" },
    { id: "" },
    "junk",
  ] }), [
    { id: "l1", trackingCode: "NEN-1", description: "2 barrels", kind: "barrel", containerStatus: "shipped", destination: "Guinea", role: "receiver" },
  ]);
  assert.deepEqual(conversationPackages(null), []);
  assert.equal(packageContainerStatusText("arrived"), "Ready for pickup");
  assert.equal(packageContainerStatusText(""), "Waiting list");
});

test("the hand-over list is the server's, Laawol first, each inbox once", () => {
  assert.deepEqual(handoffOptionsFrom({ success: true, options: [
    { businessId: "laawol", businessName: "Laawol" },
    { businessId: "keren", businessName: "Keren Cargo" },
    { businessId: "keren", businessName: "Keren again" },
    { businessId: "nameless" },
    { businessId: "" },
    "junk",
  ] }), [
    { id: "laawol", name: "Laawol" },
    { id: "keren", name: "Keren Cargo" },
    { id: "nameless", name: "nameless" },
  ]);
  assert.deepEqual(handoffOptionsFrom(null), []);
  assert.deepEqual(handoffOptionsFrom({ options: "x" }), []);
});
