"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
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
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  LifeBuoy,
  Lock,
  MessageCircle,
  RotateCcw,
  Send,
  ShieldQuestion,
  UserCheck,
} from "lucide-react";

import { db, functions } from "@/lib/firebase";
import { asDate, text } from "@/lib/format";
import type { FirestoreRow } from "@/types/admin";

type ActionRunner = (label: string, action: () => Promise<unknown>) => Promise<void> | void;

export type SupportCasesPanelProps = {
  scope: "business" | "admin";
  businessId?: string;
  currentUid: string;
  currentName?: string;
  canReply: boolean;
  runAction?: ActionRunner;
};

// Business owners/staff escalate to the platform when they cannot resolve a
// case themselves. The reasons mirror the backend's urgent-escalation list so
// the platform queue is prioritized correctly.
const escalationReasons: Array<{ id: string; label: string }> = [
  { id: "no_response", label: "Customer unresponsive" },
  { id: "payment_no_service", label: "Payment dispute" },
  { id: "business_unreachable", label: "Need platform decision" },
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
  if (role === "admin") return "Platform";
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
  const [localError, setLocalError] = useState("");

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

  async function call(label: string, name: string, payload: Record<string, unknown>) {
    const action = async () => {
      await httpsCallable(functions, name)(payload);
    };
    setLocalError("");
    if (runAction) {
      await runAction(label, action);
      return;
    }
    try {
      await action();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="lst">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>{scope === "admin" ? "Escalated support" : "Customer support"}</h2>
          <p>
            {scope === "admin"
              ? "Cases customers or businesses escalated to the platform team."
              : "Conversations with customers about their orders. You are first-line support."}
          </p>
        </div>
        <div className="lst-head-actions">
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
                  : "When a customer opens a case for one of your orders, it shows up here."}
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
                    {text(row.customerName ?? row.customerEmail, "Customer")}
                    {scope === "admin" ? ` · ${text(row.businessName, "Business")}` : ""}
                  </span>
                  <span className="sup-inbox-preview">{text(row.lastMessage, "No messages yet")}</span>
                  <span className="sup-inbox-time">{formatDateTime(row.lastMessageAt ?? row.updatedAt)}</span>
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
            />
          ) : (
            <div className="sup-thread-empty">
              <MessageCircle size={30} />
              <p>Select a case to read the conversation and reply.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SupportThread({
  scope,
  supportCase,
  currentUid,
  currentName,
  canReply,
  onCall,
}: {
  scope: "business" | "admin";
  supportCase: FirestoreRow;
  currentUid: string;
  currentName: string;
  canReply: boolean;
  onCall: (label: string, name: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  const caseId = supportCase.id;
  const { rows: messages, loading, error } = useSupportMessages(caseId, currentUid);
  const internalNotes = useSupportInternalNotes(caseId, scope === "admin");
  const [reply, setReply] = useState("");
  const [escalateReason, setEscalateReason] = useState(escalationReasons[0].id);
  const [showEscalate, setShowEscalate] = useState(false);
  const [internalNote, setInternalNote] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const status = text(supportCase.status, "open").toLowerCase();
  const isResolved = RESOLVED_STATUSES.has(status);
  const isEscalated = text(supportCase.escalationStatus, "") === "escalated";

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
    await onCall("More information requested", "requestSupportEvidence", {
      caseId,
      ...(note ? { note } : {}),
    });
    setReply("");
  }

  async function resolve() {
    const note = reply.trim();
    await onCall("Case resolved", "resolveSupportCase", {
      caseId,
      outcome: "resolved",
      ...(note ? { note } : {}),
    });
    setReply("");
  }

  async function reopen() {
    await onCall("Case reopened", "reopenSupportCase", { caseId });
  }

  async function escalate() {
    const note = reply.trim();
    await onCall("Escalated to platform", "escalateSupportCase", {
      caseId,
      reason: escalateReason,
      ...(note ? { note } : {}),
    });
    setReply("");
    setShowEscalate(false);
  }

  async function claim() {
    await onCall("Case claimed", "assignSupportCase", { caseId });
  }

  async function addNote() {
    const note = internalNote.trim();
    if (!note) return;
    await onCall("Internal note added", "addSupportInternalNote", { caseId, note });
    setInternalNote("");
  }

  return (
    <div className="sup-thread">
      <header className="sup-thread-head">
        <div>
          <strong>{text(supportCase.subject ?? supportCase.relatedLabel, "Support case")}</strong>
          <span className="sup-thread-meta">
            {text(supportCase.customerName ?? supportCase.customerEmail, "Customer")}
            {" · "}
            {text(supportCase.relatedLabel, text(supportCase.caseType, "Order"))}
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
        </div>
      </header>

      {error && <div className="error-box">{error}</div>}

      <div className="sup-messages" ref={scrollRef}>
        {loading && <div className="empty-state">Loading conversation…</div>}
        {!loading && messages.length === 0 && (
          <div className="empty-state">No messages in this case yet.</div>
        )}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} currentUid={currentUid} />
        ))}
      </div>

      {scope === "admin" && (
        <div className="sup-notes">
          <div className="sup-notes-head">
            <Lock size={13} /> Internal notes (platform only)
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
                placeholder="Add a private note for the platform team…"
                value={internalNote}
                onChange={(event) => setInternalNote(event.target.value)}
              />
              <button className="lst-btn" type="button" disabled={!internalNote.trim()} onClick={addNote}>
                <FileText size={14} /> Add note
              </button>
            </div>
          )}
        </div>
      )}

      {canReply ? (
        <div className="sup-composer">
          <textarea
            rows={3}
            placeholder="Write a reply to the customer…"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
          />
          <div className="sup-composer-actions">
            <button className="lst-add" type="button" disabled={!reply.trim()} onClick={send}>
              <Send size={15} /> Send reply
            </button>
            <button className="lst-btn ghost" type="button" onClick={requestInfo}>
              <ShieldQuestion size={14} /> Request more info
            </button>
            {!isResolved ? (
              <button className="lst-btn ghost" type="button" onClick={resolve}>
                <CheckCircle2 size={14} /> Mark resolved
              </button>
            ) : (
              <button className="lst-btn ghost" type="button" onClick={reopen}>
                <RotateCcw size={14} /> Reopen
              </button>
            )}
            {scope === "admin" ? (
              <button className="lst-btn ghost" type="button" onClick={claim}>
                <UserCheck size={14} /> Claim case
              </button>
            ) : (
              !isEscalated && (
                <button
                  className="lst-btn ghost"
                  type="button"
                  onClick={() => setShowEscalate((value) => !value)}
                >
                  <AlertTriangle size={14} /> Escalate to platform
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
              <button className="lst-btn" type="button" onClick={escalate}>
                <AlertTriangle size={14} /> Confirm escalation
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

function MessageBubble({
  message,
  currentUid,
}: {
  message: FirestoreRow;
  currentUid: string;
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

  if (type === "system") {
    return <div className="bubble-system">{text(message.content, "")}</div>;
  }

  return (
    <div className={`bubble ${mine ? "mine" : ""}`}>
      <div className="bubble-meta">
        <span>{text(message.senderName, "User")}</span>
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
