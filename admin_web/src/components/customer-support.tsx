"use client";

import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  ArrowLeft,
  Headphones,
  MessageCircle,
  Send,
  ShieldCheck,
} from "lucide-react";

import { db, functions } from "@/lib/firebase";
import { formatDate, text } from "@/lib/format";
import {
  buildOpenSupportCasePayload,
  buildSupportCaseIdPayload,
  buildSupportMessagePayload,
  buildSupportTypingPayload,
  type CustomerSupportReference,
  type SupportPriority,
} from "@/lib/phase5-customer-actions";
import type { FirestoreRow } from "@/types/admin";

const LOADING_TIMEOUT_MS = 15_000;
const ACTION_TIMEOUT_MS = 30_000;

function safeAction<T>(request: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("timeout")),
      ACTION_TIMEOUT_MS,
    );
    request.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function CustomerSupport({
  uid,
  references = [],
}: {
  uid: string;
  references?: CustomerSupportReference[];
}) {
  const [cases, setCases] = useState<FirestoreRow[]>([]);
  const [casesLoading, setCasesLoading] = useState(true);
  const [casesError, setCasesError] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [creating, setCreating] = useState(false);
  const [showComposer, setShowComposer] = useState(false);

  useEffect(() => {
    setCasesLoading(true);
    setCasesError("");
    const safetyTimer = window.setTimeout(() => {
      setCasesLoading(false);
      setCasesError("Support is taking longer to load. Try again.");
    }, LOADING_TIMEOUT_MS);
    const request = query(
      collection(db, "supportCases"),
      where("customerUid", "==", uid),
      limit(100),
    );
    const unsubscribe = onSnapshot(
      request,
      (snapshot) => {
        window.clearTimeout(safetyTimer);
        const rows = snapshot.docs
          .map<FirestoreRow>((item) => ({ id: item.id, ...item.data() }))
          .sort(
            (a, b) =>
              dateValue(b.lastMessageAt ?? b.updatedAt ?? b.createdAt) -
              dateValue(a.lastMessageAt ?? a.updatedAt ?? a.createdAt),
          );
        setCases(rows);
        setCasesLoading(false);
        setCasesError("");
      },
      () => {
        window.clearTimeout(safetyTimer);
        setCases([]);
        setCasesLoading(false);
        setCasesError("Your support conversations could not be loaded.");
      },
    );
    return () => {
      window.clearTimeout(safetyTimer);
      unsubscribe();
    };
  }, [uid]);

  if (selectedCaseId) {
    const selectedCase = cases.find((item) => item.id === selectedCaseId);
    return (
      <SupportThread
        onBack={() => setSelectedCaseId("")}
        supportCase={selectedCase ?? { id: selectedCaseId }}
        uid={uid}
      />
    );
  }

  return (
    <section className="panel phase5-support-panel">
      <div className="phase5-support-hero">
        <div className="phase5-support-icon" aria-hidden="true">
          <Headphones size={24} />
        </div>
        <div>
          <span className="section-kicker">Customer support</span>
          <h2>Real people, one secure conversation.</h2>
          <p>
            Ask about one of your Laawol orders and see replies here in real
            time. Text messages are available on web.
          </p>
        </div>
        {references.length > 0 && (
          <button
            className="primary-button"
            onClick={() => setShowComposer(true)}
            type="button"
          >
            Start a support request
          </button>
        )}
      </div>

      {casesError && <div className="error-box">{casesError}</div>}
      {showComposer && (
        <NewSupportCase
          busy={creating}
          onCancel={() => setShowComposer(false)}
          onCreate={async (values) => {
            if (creating) return;
            setCreating(true);
            setCasesError("");
            try {
              const callable = httpsCallable<
                ReturnType<typeof buildOpenSupportCasePayload>,
                { caseId?: string }
              >(functions, "createOrOpenSupportCase");
              const result = await safeAction(
                callable(buildOpenSupportCasePayload(values)),
              );
              const caseId = String(result.data.caseId ?? "").trim();
              if (!caseId) throw new Error("missing-case");
              setShowComposer(false);
              setSelectedCaseId(caseId);
            } catch {
              setCasesError("The support request could not be opened. Try again.");
            } finally {
              setCreating(false);
            }
          }}
          references={references}
        />
      )}

      <div className="phase5-support-list">
        {casesLoading && <div className="empty-state">Loading support conversations...</div>}
        {!casesLoading && cases.length === 0 && (
          <div className="phase5-support-empty">
            <MessageCircle size={26} />
            <strong>No support conversations yet.</strong>
            <span>Open an order and choose support when you need help.</span>
          </div>
        )}
        {cases.map((supportCase) => (
          <button
            className="phase5-support-case"
            key={supportCase.id}
            onClick={() => setSelectedCaseId(supportCase.id)}
            type="button"
          >
            <div>
              <strong>{text(supportCase.subject, "Support request")}</strong>
              <span>{text(supportCase.relatedLabel, "Laawol order")}</span>
              <small>{text(supportCase.lastMessage, "Open conversation")}</small>
            </div>
            <div>
              <span className="status-pill compact">
                {text(supportCase.status, "Open")}
              </span>
              <small>
                {formatDate(
                  supportCase.lastMessageAt ??
                    supportCase.updatedAt ??
                    supportCase.createdAt,
                )}
              </small>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function NewSupportCase({
  references,
  busy,
  onCreate,
  onCancel,
}: {
  references: CustomerSupportReference[];
  busy: boolean;
  onCreate: (values: {
    reference: CustomerSupportReference;
    subject: string;
    message: string;
    priority: SupportPriority;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [referenceId, setReferenceId] = useState(references[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<SupportPriority>("normal");
  const selectedReference =
    references.find((reference) => reference.id === referenceId) ?? references[0];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedReference || !subject.trim() || !message.trim() || busy) return;
    void onCreate({
      reference: selectedReference,
      subject,
      message,
      priority,
    });
  }

  return (
    <form className="phase5-support-composer" onSubmit={submit}>
      <div className="phase5-support-composer-heading">
        <ShieldCheck size={19} />
        <div>
          <strong>Get help with an order</strong>
          <span>The selected provider and Laawol support can reply here.</span>
        </div>
      </div>
      <div className="customer-form-grid">
        <label>
          Related order
          <select
            disabled={busy}
            onChange={(event) => setReferenceId(event.target.value)}
            value={referenceId}
          >
            {references.map((reference) => (
              <option key={`${reference.collection}:${reference.id}`} value={reference.id}>
                {reference.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            disabled={busy}
            onChange={(event) => setPriority(event.target.value as SupportPriority)}
            value={priority}
          >
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
            <option value="blocked">Service blocked</option>
          </select>
        </label>
      </div>
      <label>
        Subject
        <input
          disabled={busy}
          maxLength={160}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="What do you need help with?"
          value={subject}
        />
      </label>
      <label>
        Message
        <textarea
          disabled={busy}
          maxLength={4000}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Share the details that will help us answer."
          rows={4}
          value={message}
        />
      </label>
      <div className="phase5-action-row">
        <button
          className="primary-button"
          data-loading={busy}
          disabled={busy || !selectedReference || !subject.trim() || !message.trim()}
          type="submit"
        >
          {busy ? "Opening conversation..." : "Open support conversation"}
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function SupportThread({
  uid,
  supportCase,
  onBack,
}: {
  uid: string;
  supportCase: FirestoreRow;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<FirestoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const markedSignature = useRef("");
  const typingTimer = useRef<number | null>(null);
  const typingActive = useRef(false);
  const messagesEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLoading(true);
    const safetyTimer = window.setTimeout(() => {
      setLoading(false);
      setError("This conversation is taking longer to load. Try again.");
    }, LOADING_TIMEOUT_MS);
    const request = query(
      collection(db, "supportCases", supportCase.id, "messages"),
      orderBy("createdAt", "desc"),
      limit(120),
    );
    const unsubscribe = onSnapshot(
      request,
      (snapshot) => {
        window.clearTimeout(safetyTimer);
        const rows = snapshot.docs
          .map<FirestoreRow>((item) => ({ id: item.id, ...item.data() }))
          .filter((message) => {
            const deleted = message.deletedForUsers;
            return !(
              deleted &&
              typeof deleted === "object" &&
              (deleted as Record<string, unknown>)[uid] === true
            );
          })
          .reverse();
        setMessages(rows);
        setLoading(false);
        setError("");
      },
      () => {
        window.clearTimeout(safetyTimer);
        setLoading(false);
        setError("This support conversation could not be loaded.");
      },
    );
    return () => {
      window.clearTimeout(safetyTimer);
      unsubscribe();
    };
  }, [supportCase.id, uid]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ block: "end" });
    const signature = messages.map((message) => message.id).join(":");
    if (!signature || signature === markedSignature.current) return;
    markedSignature.current = signature;
    const callable = httpsCallable(functions, "markSupportCaseRead");
    void safeAction(callable(buildSupportCaseIdPayload(supportCase.id))).catch(
      () => {},
    );
  }, [messages, supportCase.id]);

  useEffect(
    () => () => {
      if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
      typingActive.current = false;
      const callable = httpsCallable(functions, "setSupportTyping");
      void safeAction(
        callable(buildSupportTypingPayload(supportCase.id, false)),
      ).catch(() => {});
    },
    [supportCase.id],
  );

  function updateTyping(value: string) {
    setContent(value);
    if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
    const callable = httpsCallable(functions, "setSupportTyping");
    if (value.trim() && !typingActive.current) {
      typingActive.current = true;
      void safeAction(
        callable(buildSupportTypingPayload(supportCase.id, true)),
      ).catch(() => {});
    }
    typingTimer.current = window.setTimeout(() => {
      typingActive.current = false;
      void safeAction(
        callable(buildSupportTypingPayload(supportCase.id, false)),
      ).catch(() => {});
    }, 2_000);
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!content.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const callable = httpsCallable(functions, "sendSupportMessage");
      await safeAction(
        callable(buildSupportMessagePayload(supportCase.id, content)),
      );
      setContent("");
      typingActive.current = false;
      await safeAction(
        httpsCallable(functions, "setSupportTyping")(
          buildSupportTypingPayload(supportCase.id, false),
        ),
      );
    } catch {
      setError("Your message could not be sent. Try again.");
    } finally {
      setSending(false);
    }
  }

  const title = useMemo(
    () => text(supportCase.subject, "Support conversation"),
    [supportCase.subject],
  );

  return (
    <section className="panel phase5-thread">
      <div className="phase5-thread-header">
        <button
          aria-label="Back to support conversations"
          className="icon-button"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <span className="section-kicker">Secure support</span>
          <h2>{title}</h2>
          <p>{text(supportCase.relatedLabel, "Laawol order")}</p>
        </div>
        <span className="status-pill compact">
          {text(supportCase.status, "Open")}
        </span>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div
        aria-busy={loading}
        aria-live="polite"
        className="phase5-message-list"
      >
        {loading && <div className="empty-state">Loading conversation...</div>}
        {!loading && messages.length === 0 && (
          <div className="empty-state">Send a message to start this conversation.</div>
        )}
        {messages.map((message) => {
          const mine = text(message.senderId, "") === uid;
          return (
            <article
              className={`phase5-message ${mine ? "mine" : ""}`}
              key={message.id}
            >
              <div>
                <strong>
                  {mine ? "You" : text(message.senderName, "Laawol support")}
                </strong>
                <span>{formatDate(message.createdAt)}</span>
              </div>
              <p>{text(message.content, "Message")}</p>
            </article>
          );
        })}
        <div ref={messagesEnd} />
      </div>
      <form className="phase5-message-form" onSubmit={sendMessage}>
        <label>
          <span className="sr-only">Message</span>
          <textarea
            disabled={sending}
            maxLength={4000}
            onChange={(event) => updateTyping(event.target.value)}
            placeholder="Write a message..."
            rows={2}
            value={content}
          />
        </label>
        <button
          aria-label="Send message"
          className="primary-button"
          data-loading={sending}
          disabled={sending || !content.trim()}
          type="submit"
        >
          <Send size={17} />
          {sending ? "Sending message..." : "Send"}
        </button>
      </form>
      <small className="phase5-text-only-note">
        Text chat is available on web. For files or photos, use the mobile app.
      </small>
    </section>
  );
}

function dateValue(value: unknown) {
  if (value && typeof value === "object" && "toMillis" in value) {
    const toMillis = (value as { toMillis?: unknown }).toMillis;
    if (typeof toMillis === "function") return Number(toMillis.call(value));
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value) || 0;
  return 0;
}
