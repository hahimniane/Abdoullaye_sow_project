"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  History,
  ImagePlus,
  LifeBuoy,
  Lock,
  MessageCircle,
  Package,
  Paperclip,
  RotateCcw,
  RefreshCw,
  Send,
  ShieldQuestion,
  UserCheck,
} from "lucide-react";

import { db, functions, storage } from "@/lib/firebase";
import { asDate, formatDate, formatMoney, text } from "@/lib/format";
import type {
  ActionConfirmationOptions,
  ActionRunner,
} from "@/lib/action-confirmation";
import { executeSupportAction } from "@/lib/support-action";
import type { FirestoreRow } from "@/types/admin";

export type SupportCasesPanelProps = {
  scope: "business" | "admin";
  businessId?: string;
  currentUid: string;
  currentName?: string;
  canReply: boolean;
  runAction?: ActionRunner;
};

// Business owners/staff escalate to admins when they cannot resolve a
// case themselves. The reasons mirror the backend's urgent-escalation list so
// the admin queue is prioritized correctly.
const escalationReasons: Array<{ id: string; label: string }> = [
  { id: "no_response", label: "Customer unresponsive" },
  { id: "payment_no_service", label: "Payment dispute" },
  { id: "business_unreachable", label: "Need admin decision" },
  { id: "fraud", label: "Suspected fraud" },
  { id: "safety", label: "Safety concern" },
  { id: "unresolved", label: "Other / cannot resolve" },
];

const RESOLVED_STATUSES = new Set(["resolved", "closed"]);

function formatDateTime(value: unknown): string {
  const date = asDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function activityMs(row: FirestoreRow): number {
  const date =
    asDate(row.lastMessageAt) ?? asDate(row.updatedAt) ?? asDate(row.createdAt);
  return date ? date.getTime() : 0;
}

function statusLabel(value: unknown): string {
  return text(value, "open")
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function roleLabel(role: string): string {
  if (role === "admin") return "Admin";
  if (role === "business") return "Business";
  if (role === "customer") return "Customer";
  return role || "System";
}

function rowFromSnapshot(item: QueryDocumentSnapshot<DocumentData>): FirestoreRow {
  return { id: item.id, _path: item.ref.path, ...item.data() };
}

function useSupportCases(
  scope: "business" | "admin",
  businessId: string,
  enabled: boolean,
): { rows: FirestoreRow[]; loading: boolean; error: string } {
  const [rows, setRows] = useState<FirestoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled || (scope === "business" && !businessId)) {
      setRows([]);
      setLoading(false);
      setError("");
      return;
    }
    const constraints: QueryConstraint[] =
      scope === "business"
        ? [where("businessId", "==", businessId), limit(300)]
        : [where("escalationStatus", "==", "escalated"), limit(300)];
    setLoading(true);
    const unsubscribe = onSnapshot(
      query(collection(db, "supportCases"), ...constraints),
      (snapshot) => {
        const next = snapshot.docs
          .map(rowFromSnapshot)
          .sort((a, b) => activityMs(b) - activityMs(a));
        setRows(next);
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        setRows([]);
        setError(snapshotError.message);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [scope, businessId, enabled]);

  return { rows, loading, error };
}

function useSupportMessages(
  caseId: string,
  uid: string,
): { rows: FirestoreRow[]; loading: boolean; error: string } {
  const [rows, setRows] = useState<FirestoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!caseId) {
      setRows([]);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    const unsubscribe = onSnapshot(
      query(
        collection(db, "supportCases", caseId, "messages"),
        orderBy("createdAt", "asc"),
        limit(200),
      ),
      (snapshot) => {
        const next = snapshot.docs.map(rowFromSnapshot).filter((row) => {
          const deleted = row.deletedForUsers;
          if (deleted && typeof deleted === "object") {
            return (deleted as Record<string, unknown>)[uid] !== true;
          }
          return true;
        });
        setRows(next);
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        setRows([]);
        setError(snapshotError.message);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [caseId, uid]);

  return { rows, loading, error };
}

function useSupportInternalNotes(caseId: string, enabled: boolean): FirestoreRow[] {
  const [rows, setRows] = useState<FirestoreRow[]>([]);
  useEffect(() => {
    if (!caseId || !enabled) {
      setRows([]);
      return;
    }
    const unsubscribe = onSnapshot(
      query(
        collection(db, "supportCases", caseId, "internalNotes"),
        orderBy("createdAt", "desc"),
        limit(80),
      ),
      (snapshot) => setRows(snapshot.docs.map(rowFromSnapshot)),
      () => setRows([]),
    );
    return unsubscribe;
  }, [caseId, enabled]);
  return rows;
}

function useSupportTimeline(caseId: string): FirestoreRow[] {
  const [rows, setRows] = useState<FirestoreRow[]>([]);
  useEffect(() => {
    if (!caseId) {
      setRows([]);
      return;
    }
    const unsubscribe = onSnapshot(
      query(
        collection(db, "supportCases", caseId, "timeline"),
        orderBy("createdAt", "desc"),
        limit(60),
      ),
      (snapshot) => setRows(snapshot.docs.map(rowFromSnapshot)),
      () => setRows([]),
    );
    return unsubscribe;
  }, [caseId]);
  return rows;
}

// One-shot fetch of the linked transaction so an admin can see the order context
// behind an escalated case. Read access is already granted to the responsible
// business and admins by the per-collection Firestore rules.
function useRelatedRecord(collectionName: string, relatedId: string): {
  record: FirestoreRow | null;
  loading: boolean;
  error: string;
} {
  const [record, setRecord] = useState<FirestoreRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!collectionName || !relatedId) {
      setRecord(null);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    getDoc(doc(db, collectionName, relatedId))
      .then((snap) => {
        if (cancelled) return;
        setRecord(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        setError(snap.exists() ? "" : "Linked order not found.");
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [collectionName, relatedId]);
  return { record, loading, error };
}

// Display name for a message/event actor, respecting who's viewing. Customers
// are handled in the Flutter app; here a business must not see an individual
// admin's name (they see "Laawol support"), while admins see real names for
// accountability.
function actorDisplayName(
  role: string,
  name: string,
  scope: "business" | "admin",
): string {
  if (role === "admin" && scope === "business") return "Laawol support";
  return text(name, role === "admin" ? "Laawol support" : "User");
}

// Curated fields shown in the order-context panel across the supported
// transaction types. Only those present on the record are rendered.
const CONTEXT_FIELDS: Array<{ key: string; label: string; money?: boolean; date?: boolean; status?: boolean }> = [
  { key: "trackingCode", label: "Tracking" },
  { key: "status", label: "Status", status: true },
  { key: "paymentStatus", label: "Payment", status: true },
  { key: "price", label: "Amount", money: true },
  { key: "amount", label: "Amount", money: true },
  { key: "depositAmount", label: "Deposit", money: true },
  { key: "quantity", label: "Quantity" },
  { key: "senderName", label: "Sender" },
  { key: "receiverName", label: "Receiver" },
  { key: "buyerName", label: "Buyer" },
  { key: "destinationCountryName", label: "Destination" },
  { key: "pickupAddress", label: "Pickup" },
  { key: "createdAt", label: "Created", date: true },
];

// Human-readable verb phrase for a timeline event, written to read after the
// actor's name ("Alice replied"). Add a matching french-dom entry for each.
function eventLabel(type: string): string {
  switch (type) {
    case "created": return "opened the case";
    case "reopened": return "reopened the case";
    case "message_sent": return "replied";
    case "attachment_uploaded": return "shared an attachment";
    case "assigned": return "claimed the case";
    case "escalated": return "escalated to admin";
    case "evidence_requested": return "requested more info";
    case "resolved": return "resolved the case";
    case "internal_note_added": return "added an internal note";
    default: return type.replace(/_/g, " ");
  }
}

export function SupportCasesPanel({
  scope,
  businessId = "",
  currentUid,
  currentName,
  canReply,
  runAction,
}: SupportCasesPanelProps) {
  const enabled = scope === "admin" ? true : Boolean(businessId);
  const { rows, loading, error } = useSupportCases(scope, businessId, enabled);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [showPlatformRequest, setShowPlatformRequest] = useState(false);
  const [platformDraft, setPlatformDraft] = useState({
    priority: "normal",
    subject: "",
    message: "",
  });
  const [busyAction, setBusyAction] = useState("");
  const [localError, setLocalError] = useState("");
  const platformErrorRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      const status = text(row.status, "open").toLowerCase();
      if (!showResolved && RESOLVED_STATUSES.has(status)) return false;
      if (!term) return true;
      const haystack = [
        row.subject,
        row.relatedLabel,
        row.customerName,
        row.customerEmail,
        row.businessName,
        row.lastMessage,
      ]
        .map((value) => text(value, "").toLowerCase())
        .join(" ");
      return haystack.includes(term);
    });
  }, [rows, search, showResolved]);

  useEffect(() => {
    if (selectedId && !rows.some((row) => row.id === selectedId)) {
      setSelectedId("");
    }
  }, [rows, selectedId]);

  const selectedCase = rows.find((row) => row.id === selectedId) ?? null;

  useEffect(() => {
    if (showPlatformRequest && localError) {
      platformErrorRef.current?.focus();
    }
  }, [localError, showPlatformRequest]);

  async function call(
    label: string,
    name: string,
    payload: Record<string, unknown>,
    options?: ActionConfirmationOptions,
  ): Promise<boolean> {
    if (busyAction) return false;
    const action = async () => {
      await httpsCallable(functions, name)(payload);
    };
    setLocalError("");
    setBusyAction(label);
    try {
      const result = options
        ? await executeSupportAction(
            label,
            action,
            async (actionLabel, trackedAction) => {
              if (runAction) {
                await runAction(actionLabel, trackedAction, options);
              } else {
                await trackedAction();
              }
            },
          )
        : await executeSupportAction(label, action, runAction);
      if (!result.completed && result.error) {
        setLocalError(result.error);
      }
      return result.completed;
    } finally {
      setBusyAction("");
    }
  }

  async function createPlatformRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const subject = platformDraft.subject.trim();
    const message = platformDraft.message.trim();
    if (!subject || !message || !businessId) return;
    const completed = await call("Admin support case opened", "createBusinessPlatformSupportCase", {
      businessId,
      subject,
      message,
      priority: platformDraft.priority,
    });
    if (!completed) return;
    setPlatformDraft({ priority: "normal", subject: "", message: "" });
    setShowPlatformRequest(false);
  }

  function closePlatformRequest() {
    if (busyAction === "Admin support case opened") return;
    setShowPlatformRequest(false);
    setLocalError("");
  }

  return (
    <section className="lst">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>{scope === "admin" ? "Escalated support" : "Support"}</h2>
          <p>
            {scope === "admin"
              ? "Cases customers or businesses escalated to the admin team."
              : "Manage customer order conversations and reach the admin team from one support inbox."}
          </p>
        </div>
        <div className="lst-head-actions">
          {scope === "business" && canReply && (
            <button className="lst-add" type="button" disabled={Boolean(busyAction)} onClick={() => {
              setLocalError("");
              setShowPlatformRequest(true);
            }}>
              <Send size={15} /> New admin request
            </button>
          )}
          <label className="sup-toggle">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(event) => setShowResolved(event.target.checked)}
            />
            Show resolved
          </label>
        </div>
      </header>

      {(error || localError) && <div className="error-box">{error || localError}</div>}

      <div className="sup-layout">
        <aside className="sup-inbox">
          <input
            className="sup-search"
            placeholder="Search cases…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {loading && <div className="empty-state">Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div className="lst-empty">
              <div className="lst-empty-icon"><LifeBuoy size={26} /></div>
              <h3>No support cases</h3>
              <p>
                {scope === "admin"
                  ? "Escalated cases will appear here."
                  : "Customer order cases and admin help requests will appear here."}
              </p>
            </div>
          )}
          <div className="sup-inbox-list">
            {filtered.map((row) => {
              const status = text(row.status, "open").toLowerCase();
              const unresolved = !RESOLVED_STATUSES.has(status);
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`sup-inbox-item ${row.id === selectedId ? "active" : ""}`}
                  onClick={() => setSelectedId(row.id)}
                >
                  <div className="sup-inbox-top">
                    <strong>{text(row.subject ?? row.relatedLabel, "Support case")}</strong>
                    <span className={`status-pill compact ${unresolved ? "warning" : ""}`}>
                      {statusLabel(row.status)}
                    </span>
                  </div>
                  <span className="sup-inbox-sub">
                    {caseAudienceLabel(row)}
                    {scope === "admin" ? ` · ${text(row.businessName, "Business")}` : ""}
                  </span>
                  <span className="sup-inbox-preview">{text(row.lastMessage, "No messages yet")}</span>
                  <span className="sup-inbox-foot">
                    <span className="sup-inbox-time">{formatDateTime(row.lastMessageAt ?? row.updatedAt)}</span>
                    {scope === "admin" && text(row.assignedAdminUid, "") && (
                      <span className="sup-inbox-claim">
                        <UserCheck size={11} />
                        {text(row.assignedAdminUid, "") === currentUid ? "You" : "Claimed"}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="sup-thread-wrap">
          {selectedCase ? (
            <SupportThread
              key={selectedCase.id}
              scope={scope}
              supportCase={selectedCase}
              currentUid={currentUid}
              currentName={text(currentName, "Support")}
              canReply={canReply}
              onCall={call}
              busyAction={busyAction}
            />
          ) : (
            <div className="sup-thread-empty">
              <MessageCircle size={30} />
              <p>Select a case to read the conversation and reply.</p>
            </div>
          )}
        </div>
      </div>
      {showPlatformRequest && scope === "business" && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="new-admin-request-title" onClick={closePlatformRequest}>
          <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <h3 id="new-admin-request-title">New admin request</h3>
              <button className="lst-icon-btn" type="button" disabled={busyAction === "Admin support case opened"} onClick={closePlatformRequest} aria-label="Close">x</button>
            </header>
            <form onSubmit={createPlatformRequest}>
              <div className="lst-modal-body">
                {localError && (
                  <div
                    ref={platformErrorRef}
                    className="error-box"
                    role="alert"
                    tabIndex={-1}
                  >
                    {localError}
                  </div>
                )}
                <div className="lst-form-grid">
                  <label className="lst-field">
                    <span>Priority</span>
                    <select
                      value={platformDraft.priority}
                      onChange={(event) => setPlatformDraft((current) => ({ ...current, priority: event.target.value }))}
                    >
                      <option value="normal">Normal</option>
                      <option value="urgent">Urgent</option>
                      <option value="blocked">Blocked</option>
                    </select>
                  </label>
                  <label className="lst-field wide">
                    <span>Subject</span>
                    <input
                      required
                      value={platformDraft.subject}
                      onChange={(event) => setPlatformDraft((current) => ({ ...current, subject: event.target.value }))}
                      placeholder="What do you need from the admin team?"
                    />
                  </label>
                  <label className="lst-field wide">
                    <span>Message</span>
                    <textarea
                      required
                      rows={4}
                      value={platformDraft.message}
                      onChange={(event) => setPlatformDraft((current) => ({ ...current, message: event.target.value }))}
                      placeholder="Add the details, order reference, payout issue, or policy question."
                    />
                  </label>
                </div>
              </div>
              <footer className="lst-modal-foot">
                <button className="lst-btn ghost" type="button" disabled={busyAction === "Admin support case opened"} onClick={closePlatformRequest}>Cancel</button>
                <button className="lst-add" type="submit" disabled={Boolean(busyAction) || !businessId || !platformDraft.subject.trim() || !platformDraft.message.trim()}>
                  {busyAction === "Admin support case opened" ? <RefreshCw className="spin" size={15} /> : <Send size={15} />}
                  {busyAction === "Admin support case opened" ? "Sending..." : "Send request"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

function isBusinessPlatformCase(row: FirestoreRow): boolean {
  return text(row.caseType, "") === "business_platform";
}

function caseAudienceLabel(row: FirestoreRow): string {
  if (isBusinessPlatformCase(row)) return "Admin help";
  return text(row.customerName ?? row.customerEmail, "Customer");
}

function SupportThread({
  scope,
  supportCase,
  currentUid,
  currentName,
  canReply,
  onCall,
  busyAction,
}: {
  scope: "business" | "admin";
  supportCase: FirestoreRow;
  currentUid: string;
  currentName: string;
  canReply: boolean;
  onCall: (
    label: string,
    name: string,
    payload: Record<string, unknown>,
    options?: ActionConfirmationOptions,
  ) => Promise<boolean>;
  busyAction: string;
}) {
  const caseId = supportCase.id;
  const { rows: messages, loading, error } = useSupportMessages(caseId, currentUid);
  const internalNotes = useSupportInternalNotes(caseId, scope === "admin");
  const timeline = useSupportTimeline(caseId);
  const [reply, setReply] = useState("");
  const [escalateReason, setEscalateReason] = useState(escalationReasons[0].id);
  const [showEscalate, setShowEscalate] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [internalNote, setInternalNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const status = text(supportCase.status, "open").toLowerCase();
  const isResolved = RESOLVED_STATUSES.has(status);
  const isEscalated = text(supportCase.escalationStatus, "") === "escalated";

  // Soft ownership: the case records who claimed it (assignedAdminUid). We make
  // that visible to every admin and warn (not block) before a different admin
  // replies. The claimer's name comes from the most recent "assigned" timeline
  // event — written whenever someone claims/takes over — so this stays
  // frontend-only with no backend change.
  const assignedUid = text(supportCase.assignedAdminUid, "");
  const claimedByMe = Boolean(assignedUid) && assignedUid === currentUid;
  const claimedByOther = Boolean(assignedUid) && !claimedByMe;
  const claimerName = (() => {
    const ev = timeline.find(
      (row) => text(row.type, "") === "assigned" &&
        (text(row.actorUid, "") === assignedUid || !assignedUid),
    );
    return text(ev?.actorName, "another admin");
  })();

  // Mark the case read for this participant whenever a new message arrives.
  useEffect(() => {
    if (!caseId || messages.length === 0) return;
    httpsCallable(functions, "markSupportCaseRead")({ caseId }).catch(() => {});
  }, [caseId, messages.length]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, caseId]);

  async function send() {
    const content = reply.trim();
    if (!content) return;
    await onCall("Reply sent", "sendSupportMessage", { caseId, content, messageType: "text" });
    setReply("");
  }

  async function requestInfo() {
    const note = reply.trim();
    await onCall(
      "More information requested",
      "requestSupportEvidence",
      {
        caseId,
        ...(note ? { note } : {}),
      },
      {
        confirm:
          "Request more information on this support case?",
        confirmFr:
          "Demander plus d’informations sur ce dossier de support ?",
      },
    );
    setReply("");
  }

  async function resolve() {
    const note = reply.trim();
    await onCall(
      "Case resolved",
      "resolveSupportCase",
      {
        caseId,
        outcome: "resolved",
        ...(note ? { note } : {}),
      },
      {
        confirm:
          "Resolve this support case?",
        confirmFr:
          "Résoudre ce dossier de support ?",
      },
    );
    setReply("");
  }

  async function reopen() {
    await onCall(
      "Case reopened",
      "reopenSupportCase",
      { caseId },
      {
        confirm:
          "Reopen this support case?",
        confirmFr:
          "Rouvrir ce dossier de support ?",
      },
    );
  }

  async function escalate() {
    const note = reply.trim();
    await onCall(
      "Escalated to admin",
      "escalateSupportCase",
      {
        caseId,
        reason: escalateReason,
        ...(note ? { note } : {}),
      },
      {
        confirm:
          "Escalate this case to the admin team?",
        confirmFr:
          "Transférer ce dossier à l’équipe admin ?",
      },
    );
    setReply("");
    setShowEscalate(false);
  }

  async function claim() {
    await onCall(
      "Case claimed",
      "assignSupportCase",
      { caseId },
      {
        confirm:
          claimedByOther
            ? `Take over this case from ${claimerName}?`
            : "Claim this support case?",
        confirmFr:
          claimedByOther
            ? `Reprendre ce dossier à ${claimerName} ?`
            : "Prendre en charge ce dossier de support ?",
      },
    );
  }

  async function addNote() {
    const note = internalNote.trim();
    if (!note) return;
    await onCall("Internal note added", "addSupportInternalNote", { caseId, note });
    setInternalNote("");
  }

  // Upload an attachment to the case's own storage path, then register it as a
  // message via the callable (which re-validates path/type/size). Mirrors the
  // Flutter app's flow and the wouri attachment design.
  async function uploadAttachment(file: File | null | undefined) {
    if (!file || uploading) return;
    setUploadError("");
    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-");
    const path = `support_cases/${caseId}/${currentUid}/${Date.now()}-${safeName}`;
    const mimeType = file.type || "application/octet-stream";
    const messageType = mimeType.startsWith("image/")
      ? "image"
      : mimeType.startsWith("video/")
        ? "video"
        : mimeType.startsWith("audio/")
          ? "voice"
          : "file";
    setUploading(true);
    try {
      const target = storageRef(storage, path);
      await uploadBytes(target, file, { contentType: mimeType });
      const url = await getDownloadURL(target);
      await onCall("Attachment sent", "uploadSupportAttachmentMetadata", {
        caseId,
        fileUrl: url,
        filePath: path,
        fileName: file.name,
        mimeType,
        fileSize: file.size,
        messageType,
        ...(reply.trim() ? { caption: reply.trim() } : {}),
      });
      setReply("");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="sup-thread">
      <header className="sup-thread-head">
        <div>
          <strong>{text(supportCase.subject ?? supportCase.relatedLabel, "Support case")}</strong>
          <span className="sup-thread-meta">
            {caseAudienceLabel(supportCase)}
            {" · "}
            {isBusinessPlatformCase(supportCase)
              ? "Admin help"
              : text(supportCase.relatedLabel, text(supportCase.caseType, "Order"))}
            {scope === "admin" ? ` · ${text(supportCase.businessName, "Business")}` : ""}
          </span>
        </div>
        <div className="sup-thread-tags">
          <span className={`status-pill compact ${isResolved ? "" : "warning"}`}>
            {statusLabel(supportCase.status)}
          </span>
          {isEscalated && (
            <span className="status-pill compact warning">
              <AlertTriangle size={12} /> Escalated
            </span>
          )}
          {scope === "admin" && assignedUid && (
            <span className={`status-pill compact ${claimedByMe ? "claimed-me" : "claimed-other"}`}>
              <UserCheck size={12} /> {claimedByMe ? "Claimed by you" : `Claimed by ${claimerName}`}
            </span>
          )}
        </div>
      </header>

      {error && <div className="error-box">{error}</div>}

      <OrderContext supportCase={supportCase} scope={scope} />

      <div className="sup-messages" ref={scrollRef}>
        {loading && <div className="empty-state">Loading conversation…</div>}
        {!loading && messages.length === 0 && (
          <div className="empty-state">No messages in this case yet.</div>
        )}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} currentUid={currentUid} scope={scope} />
        ))}
      </div>

      <div className="sup-activity">
        <button
          className="sup-activity-toggle"
          type="button"
          onClick={() => setShowActivity((value) => !value)}
        >
          {showActivity ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <History size={14} /> Activity
          <span className="sup-activity-count">{timeline.length}</span>
        </button>
        {showActivity && (
          <ul className="sup-activity-list">
            {timeline.length === 0 && (
              <li className="sup-activity-empty">No recorded activity yet.</li>
            )}
            {timeline.map((event) => (
              <li className="sup-activity-row" key={event.id}>
                <span className="sup-activity-dot" />
                <span className="sup-activity-text">
                  <strong>
                    {scope === "business" && text(event.actorRole, "") === "admin"
                      ? "Laawol support"
                      : text(event.actorName, "Someone")}
                  </strong>{" "}
                  <span className="sup-activity-verb">{eventLabel(text(event.type, ""))}</span>
                  {text(event.reason, "") && (
                    <span className="sup-activity-reason"> · {statusLabel(event.reason)}</span>
                  )}
                </span>
                <span className="sup-activity-time">{formatDateTime(event.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {claimedByOther && (
        <div className="sup-claim-banner">
          <span className="sup-claim-banner-text">
            <UserCheck size={14} />
            <span>{`Claimed by ${claimerName}`}</span>
            <span className="sup-claim-banner-note">You can still reply.</span>
          </span>
          <button className="lst-btn ghost" type="button" onClick={claim}>
            <UserCheck size={14} /> Take over
          </button>
        </div>
      )}

      {scope === "admin" && (
        <div className="sup-notes">
          <div className="sup-notes-head">
            <Lock size={13} /> Internal notes (admin only)
          </div>
          {internalNotes.length === 0 && (
            <span className="sup-notes-empty">No internal notes yet.</span>
          )}
          {internalNotes.map((note) => (
            <div className="sup-note" key={note.id}>
              <span>{text(note.note, "")}</span>
              <small>{text(note.actorName, "Admin")} · {formatDateTime(note.createdAt)}</small>
            </div>
          ))}
          {canReply && (
            <div className="sup-note-form">
              <textarea
                rows={2}
                placeholder="Add a private note for the admin team..."
                value={internalNote}
                onChange={(event) => setInternalNote(event.target.value)}
              />
              <button className="lst-btn" type="button" disabled={Boolean(busyAction) || !internalNote.trim()} onClick={addNote}>
                {busyAction === "Internal note added" ? <RefreshCw className="spin" size={14} /> : <FileText size={14} />}
                {busyAction === "Internal note added" ? "Adding..." : "Add note"}
              </button>
            </div>
          )}
        </div>
      )}

      {canReply ? (
        <div className="sup-composer">
          <textarea
            rows={3}
            placeholder={isBusinessPlatformCase(supportCase) ? "Write a reply…" : "Write a reply to the customer..."}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
          />
          {uploadError && <div className="error-box">{uploadError}</div>}
          <div className="sup-composer-actions">
            <button className="lst-add" type="button" disabled={Boolean(busyAction) || !reply.trim() || uploading} onClick={send}>
              {busyAction === "Reply sent" ? <RefreshCw className="spin" size={15} /> : <Send size={15} />}
              {busyAction === "Reply sent" ? "Sending..." : "Send reply"}
            </button>
            <label className={`lst-btn ghost sup-attach ${uploading ? "is-busy" : ""}`}>
              <ImagePlus size={14} /> {uploading ? "Sending…" : "Photo"}
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={uploading}
                onChange={(event) => {
                  void uploadAttachment(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            <label className={`lst-btn ghost sup-attach ${uploading ? "is-busy" : ""}`}>
              <Paperclip size={14} /> File
              <input
                type="file"
                accept="image/*,video/*,audio/*,application/pdf,text/plain,.doc,.docx"
                hidden
                disabled={uploading}
                onChange={(event) => {
                  void uploadAttachment(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            <button className="lst-btn ghost" type="button" disabled={Boolean(busyAction)} onClick={requestInfo}>
              {busyAction === "More information requested" ? <RefreshCw className="spin" size={14} /> : <ShieldQuestion size={14} />}
              {busyAction === "More information requested" ? "Requesting..." : "Request more info"}
            </button>
            {!isResolved ? (
              <button className="lst-btn ghost" type="button" disabled={Boolean(busyAction)} onClick={resolve}>
                {busyAction === "Case resolved" ? <RefreshCw className="spin" size={14} /> : <CheckCircle2 size={14} />}
                {busyAction === "Case resolved" ? "Resolving..." : "Mark resolved"}
              </button>
            ) : (
              <button className="lst-btn ghost" type="button" disabled={Boolean(busyAction)} onClick={reopen}>
                {busyAction === "Case reopened" ? <RefreshCw className="spin" size={14} /> : <RotateCcw size={14} />}
                {busyAction === "Case reopened" ? "Reopening..." : "Reopen"}
              </button>
            )}
            {scope === "admin" ? (
              !assignedUid && (
                <button className="lst-btn ghost" type="button" disabled={Boolean(busyAction)} onClick={claim}>
                  {busyAction === "Case claimed" ? <RefreshCw className="spin" size={14} /> : <UserCheck size={14} />}
                  {busyAction === "Case claimed" ? "Claiming..." : "Claim case"}
                </button>
              )
            ) : (
              !isEscalated && (
                <button
                  className="lst-btn ghost"
                  type="button"
                  onClick={() => setShowEscalate((value) => !value)}
                >
                  <AlertTriangle size={14} /> Escalate to admin
                </button>
              )
            )}
          </div>
          {showEscalate && scope === "business" && (
            <div className="sup-escalate">
              <label className="bar-field">
                <span>Reason</span>
                <select value={escalateReason} onChange={(event) => setEscalateReason(event.target.value)}>
                  {escalationReasons.map((reason) => (
                    <option key={reason.id} value={reason.id}>{reason.label}</option>
                  ))}
                </select>
              </label>
              <button className="lst-btn" type="button" disabled={Boolean(busyAction)} onClick={escalate}>
                {busyAction === "Escalated to admin" ? <RefreshCw className="spin" size={14} /> : <AlertTriangle size={14} />}
                {busyAction === "Escalated to admin" ? "Escalating..." : "Confirm escalation"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="info-band">You have read-only access to support cases.</div>
      )}
    </div>
  );
}

function OrderContext({
  supportCase,
  scope,
}: {
  supportCase: FirestoreRow;
  scope: "business" | "admin";
}) {
  if (isBusinessPlatformCase(supportCase)) {
    return (
      <div className="sup-order">
        <button className="sup-order-toggle" type="button">
          <Package size={14} /> Business context
          <span className="sup-order-label">
            {text(supportCase.businessName ?? supportCase.relatedLabel, "Business")}
          </span>
        </button>
        <div className="sup-order-body">
          <div className="sup-order-grid">
            <div className="sup-order-field">
              <span>Case type</span>
              <strong>Admin help</strong>
            </div>
            <div className="sup-order-field">
              <span>Business</span>
              <strong>{text(supportCase.businessName, "Business")}</strong>
            </div>
          </div>
          <span className="sup-order-ref">business admin support</span>
        </div>
      </div>
    );
  }
  const collectionName = text(supportCase.relatedCollection, "");
  const relatedId = text(supportCase.relatedId, "");
  const { record, loading, error } = useRelatedRecord(collectionName, relatedId);
  const [open, setOpen] = useState(scope === "admin");

  const vehicle = record
    ? [record.vehicleYear, record.vehicleMake, record.vehicleModel]
        .map((v) => text(v, ""))
        .filter(Boolean)
        .join(" ")
    : "";
  const carTitle = text(record?.carTitle ?? record?.vehicleTitle, "");
  const fields = record
    ? CONTEXT_FIELDS.filter((f) => {
        const v = record[f.key];
        return v !== undefined && v !== null && String(v).trim() !== "";
      })
    : [];

  return (
    <div className="sup-order">
      <button className="sup-order-toggle" type="button" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Package size={14} /> Order context
        <span className="sup-order-label">
          {text(supportCase.relatedLabel, text(supportCase.caseType, "Order"))}
        </span>
      </button>
      {open && (
        <div className="sup-order-body">
          {loading && <span className="sup-order-empty">Loading order…</span>}
          {error && <span className="sup-order-empty">{error}</span>}
          {record && (
            <>
              <div className="sup-order-grid">
                {(carTitle || vehicle) && (
                  <div className="sup-order-field">
                    <span>Vehicle</span>
                    <strong>{carTitle || vehicle}</strong>
                  </div>
                )}
                {fields.map((f) => (
                  <div className="sup-order-field" key={f.key}>
                    <span>{f.label}</span>
                    <strong>
                      {f.money
                        ? formatMoney(record[f.key])
                        : f.date
                          ? formatDate(record[f.key])
                          : f.status
                            ? statusLabel(record[f.key])
                            : text(record[f.key], "—")}
                    </strong>
                  </div>
                ))}
              </div>
              <span className="sup-order-ref">
                {text(supportCase.caseType, "order").replace(/_/g, " ")} · {relatedId}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  currentUid,
  scope,
}: {
  message: FirestoreRow;
  currentUid: string;
  scope: "business" | "admin";
}) {
  const mine = text(message.senderId, "") === currentUid;
  const role = text(message.senderRole, "");
  const type = text(message.messageType, "text");
  const metadata = (message.metadata && typeof message.metadata === "object"
    ? message.metadata
    : {}) as Record<string, unknown>;
  const fileUrl = text(metadata.fileUrl, "");
  const fileName = text(metadata.fileName, "Attachment");
  const caption = text(metadata.caption, "");
  const isImage = type === "image" && Boolean(fileUrl);
  const senderDisplay = actorDisplayName(role, text(message.senderName, ""), scope);

  if (type === "system") {
    // Attribute system events (e.g. "more info requested") to the actor.
    return (
      <div className="bubble-system">
        <strong>{senderDisplay}</strong> · {text(message.content, "")}
      </div>
    );
  }

  return (
    <div className={`bubble ${mine ? "mine" : ""}`}>
      <div className="bubble-meta">
        <span>{senderDisplay}</span>
        <span className={`role-tag role-${role}`}>{roleLabel(role)}</span>
      </div>
      {isImage ? (
        <a href={fileUrl} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="bubble-image" src={fileUrl} alt={fileName} />
        </a>
      ) : fileUrl ? (
        <a className="bubble-file" href={fileUrl} target="_blank" rel="noreferrer">
          <FileText size={14} /> {fileName}
        </a>
      ) : null}
      {Boolean(text(message.content, "")) && type !== "image" && (
        <span className="bubble-text">{text(message.content, "")}</span>
      )}
      {isImage && Boolean(caption) && <span className="bubble-text">{caption}</span>}
      <span className="bubble-time">
        {formatDateTime(message.createdAt)}
        {message.editedAt ? " · edited" : ""}
      </span>
    </div>
  );
}
