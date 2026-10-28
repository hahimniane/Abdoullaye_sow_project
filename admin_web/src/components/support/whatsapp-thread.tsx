"use client";

// A WhatsApp conversation in Support (docs/WHATSAPP_CONVERSATIONS.md): the
// customer's packages, the thread with delivery ticks, private notes and
// files, and a composer that writes, attaches, records voice notes and adds
// notes - plus Done / Reopen and Hand over. The Support panel
// (support-cases-panel.tsx) reads the messages and passes them in; the
// decisions about what each message is live in lib/whatsapp-conversations.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ImagePlus,
  Lock,
  MessageCircle,
  Mic,
  Package,
  Paperclip,
  Pencil,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  StickyNote,
  Trash2,
} from "lucide-react";

import { AttachmentPreview } from "@/components/support/attachment-preview";
import { UserText } from "@/components/user-text";
import { asDate, currentLanguage, currentLocale } from "@/lib/format";
import type { ActionConfirmationOptions } from "@/lib/action-confirmation";
import type { SupportAttachmentPayload } from "@/lib/support-attachments";
import {
  CHAT_DISPLAY_NAME_MAX,
  INBOX_MODES,
  inboxModeOf,
  type InboxMode,
  MAX_VOICE_NOTE_MS,
  WHATSAPP_STATE_LABELS,
  WHATSAPP_STATE_TONES,
  chooseRecorderMime,
  conversationPackages,
  deliveryResultText,
  deliveryTick,
  durationText,
  messageMedia,
  packageContainerStatusText,
  recordingFile,
  whatsappMessageKind,
  whatsappStateOf,
  handoffOptionsFrom,
  type ConversationPackage,
  type HandoffTarget,
} from "@/lib/whatsapp-conversations";
import type { FirestoreRow } from "@/types/admin";

export type WhatsAppOnCall = (
  label: string,
  name: string,
  payload: Record<string, unknown>,
  options?: ActionConfirmationOptions,
  onResult?: (data: unknown) => void,
) => Promise<boolean>;

/** A read that is not a click (the packages header): resolves with the callable's data. */
export type WhatsAppRequest = (name: string, payload: Record<string, unknown>) => Promise<unknown>;

const HANDOFF_TIMEOUT_MS = 20_000;

/**
 * Where this conversation can go, asked of the server when Hand over is
 * opened (and again on Retry). Every path settles: the list, the server's
 * refusal, or the safety timeout.
 */
function useHandoffOptions(caseId: string, request: WhatsAppRequest, wanted: boolean) {
  const [state, setState] = useState<{ loading: boolean; error: string; options: HandoffTarget[]; loaded: boolean }>(
    { loading: false, error: "", options: [], loaded: false },
  );
  // Retry asks again after a refusal or a timeout; a loaded list is kept.
  const [attempt, setAttempt] = useState(0);
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!wanted || loadedRef.current) return undefined;
    let active = true;
    setState({ loading: true, error: "", options: [], loaded: false });
    const timer = window.setTimeout(() => {
      if (!active) return;
      active = false;
      setState({ loading: false, error: "The list could not be loaded. Try again.", options: [], loaded: false });
    }, HANDOFF_TIMEOUT_MS);
    request("whatsappConversation", { action: "handoffOptions", caseId })
      .then((data) => {
        if (!active) return;
        loadedRef.current = true;
        setState({ loading: false, error: "", options: handoffOptionsFrom(data), loaded: true });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error && error.message ? error.message : "The list could not be loaded. Try again.";
        setState({ loading: false, error: message, options: [], loaded: false });
      })
      .finally(() => {
        active = false;
        window.clearTimeout(timer);
      });
    return () => {
      active = false;
      window.clearTimeout(timer);
      // Closed before the answer: ask again next time it opens.
      setState((current) => (current.loading ? { ...current, loading: false } : current));
    };
  }, [caseId, request, wanted, attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}

function formatDateTime(value: unknown): string {
  const date = asDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(currentLocale(), {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function WhatsAppBadge() {
  return (
    <span className="wa-badge">
      <MessageCircle size={11} aria-hidden="true" /> WhatsApp
    </span>
  );
}

export function WhatsAppStatePill({ row }: { row: FirestoreRow }) {
  const state = whatsappStateOf(row);
  return (
    <span className={`status-pill compact ${WHATSAPP_STATE_TONES[state]}`}>{WHATSAPP_STATE_LABELS[state]}</span>
  );
}

export function StoppedUpdatesTag() {
  return (
    <span className="status-pill compact danger" title="The customer sent STOP. Package updates are paused until they send START.">
      Stopped updates
    </span>
  );
}

// ---------------------------------------------------------------------------
// The customer's packages.
// ---------------------------------------------------------------------------

const PACKAGES_TIMEOUT_MS = 20_000;

function usePackages(caseId: string, request: WhatsAppRequest) {
  const [state, setState] = useState<{ caseId: string; loading: boolean; error: string; rows: ConversationPackage[] }>(
    { caseId: "", loading: false, error: "", rows: [] },
  );
  useEffect(() => {
    let active = true;
    setState({ caseId, loading: true, error: "", rows: [] });
    // Every path settles: the answer, a failure, or the safety timeout.
    const timer = window.setTimeout(() => {
      if (active) setState({ caseId, loading: false, error: "The packages could not be loaded.", rows: [] });
      active = false;
    }, PACKAGES_TIMEOUT_MS);
    request("whatsappConversation", { action: "packages", caseId })
      .then((data) => {
        if (!active) return;
        setState({ caseId, loading: false, error: "", rows: conversationPackages(data) });
      })
      .catch(() => {
        if (!active) return;
        setState({ caseId, loading: false, error: "The packages could not be loaded.", rows: [] });
      })
      .finally(() => {
        active = false;
        window.clearTimeout(timer);
      });
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [caseId, request]);
  return state.caseId === caseId ? state : { caseId, loading: true, error: "", rows: [] as ConversationPackage[] };
}

function ConversationPackages({ caseId, request }: { caseId: string; request: WhatsAppRequest }) {
  const { loading, error, rows } = usePackages(caseId, request);
  const [open, setOpen] = useState(true);
  return (
    <div className="sup-order">
      <button className="sup-order-toggle" type="button" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Package size={14} /> Customer's packages
        <span className="sup-order-label">{loading ? "…" : rows.length}</span>
      </button>
      {open && (
        <div className="sup-order-body">
          {loading && <span className="sup-order-empty"><RefreshCw className="spin" size={12} /> Loading packages…</span>}
          {!loading && error && <span className="sup-order-empty">{error}</span>}
          {!loading && !error && rows.length === 0 && (
            <span className="sup-order-empty">No package of this business has this number.</span>
          )}
          {rows.length > 0 && (
            <ul className="wa-packages">
              {rows.map((row) => (
                <li key={row.id}>
                  <code className="ctn-code" data-no-translate>{row.trackingCode || "—"}</code>
                  <span className="wa-package-what" data-no-translate>{row.description || row.kind}</span>
                  <span className="wa-package-status">{packageContainerStatusText(row.containerStatus)}</span>
                  <span className="wa-package-role">{row.role === "receiver" ? "Receiver" : "Sender"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Messages.
// ---------------------------------------------------------------------------

/** The server's fixed reasons a customer's file is missing; anything else is shown as written. */
const MEDIA_ERRORS = new Set(["File not available", "File too large", "The file could not be downloaded"]);

function MessageFile({ message }: { message: FirestoreRow }) {
  const media = messageMedia(message);
  if (!media) return null;
  if (media.deleted) return <span className="wa-media-gone">File deleted after 12 months</span>;
  if (media.error) {
    return MEDIA_ERRORS.has(media.error)
      ? <span className="wa-media-gone">{media.error}</span>
      : <span className="wa-media-gone" data-no-translate>{media.error}</span>;
  }
  if (!media.url) return null;
  switch (media.kind) {
    case "image":
      return <AttachmentPreview fileName={media.fileName || "Photo"} fileUrl={media.url} isImage />;
    case "audio":
      return <audio className="wa-audio" controls preload="none" src={media.url} />;
    case "video":
      return <video className="wa-video" controls preload="metadata" src={media.url} />;
    default:
      return (
        <span data-no-translate={media.fileName ? true : undefined}>
          <AttachmentPreview fileName={media.fileName || "Attachment"} fileUrl={media.url} isImage={false} />
        </span>
      );
  }
}

function Ticks({ message }: { message: FirestoreRow }) {
  const tick = deliveryTick(message);
  if (tick.status === "none") return null;
  return (
    <>
      <span key={tick.status} className={`wa-tick ${tick.status}`} title={tick.status === "waiting" ? undefined : tick.label}>
        {tick.ticks && <span aria-hidden="true" data-no-translate>{tick.ticks}</span>}
        {tick.status === "read" || tick.status === "delivered" || tick.status === "sent"
          ? <span className="wa-sr">{tick.label}</span>
          : tick.status === "failed" ? <span>{tick.label}</span> : null}
      </span>
      {tick.status === "failed" && tick.error && <span className="wa-tick-error" data-no-translate>{tick.error}</span>}
      {tick.status === "waiting" && <span className="wa-tick-waiting">{tick.label}</span>}
    </>
  );
}

export function WhatsAppMessageBubble({ message }: { message: FirestoreRow }) {
  const kind = whatsappMessageKind(message);
  const content = str(message.content);
  const media = messageMedia(message);
  const meta = (message.metadata && typeof message.metadata === "object" ? message.metadata : {}) as Record<string, unknown>;
  const time = formatDateTime(message.createdAt);

  if (kind === "system") {
    // The server writes these lines in English with names inside (handed
    // over, the customer chose...): shown as written.
    return <div className="bubble-system" data-no-translate>{content}</div>;
  }
  if (kind === "note") {
    return (
      <div className="wa-note">
        <div className="bubble-meta">
          <StickyNote size={12} aria-hidden="true" />
          <span>Private note</span>
          <span>·</span>
          <UserText value={message.senderName} fallback="Team" />
        </div>
        <span className="bubble-text" data-no-translate>{content}</span>
        <span className="bubble-time"><Lock size={10} aria-hidden="true" /> Only your team sees this · <span data-no-translate>{time}</span></span>
      </div>
    );
  }
  const outgoing = kind !== "customer";
  // A file's message content is its caption, or its name, or its type; the
  // file shows itself, so only a caption is repeated under it.
  const textShown = media ? media.caption : content;
  return (
    <div className={`bubble wa-bubble ${outgoing ? "mine wa-out" : "wa-in"} ${kind === "auto" ? "wa-auto" : ""}`}>
      <div className="bubble-meta">
        {kind === "auto" ? (
          <span>Automatic reply</span>
        ) : kind === "customer" ? (
          <UserText value={message.senderName} fallback="Customer" />
        ) : (
          <UserText value={meta.whatsappLabel ?? message.senderName} fallback="Team" />
        )}
      </div>
      <MessageFile message={message} />
      {textShown && <span className="bubble-text" data-no-translate>{textShown}</span>}
      <span className="bubble-time wa-time">
        <span data-no-translate>{time}</span>
        {outgoing && <Ticks message={message} />}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voice notes.
// ---------------------------------------------------------------------------

type RecorderState = "idle" | "starting" | "recording" | "ready";

function VoiceNoteRecorder({
  disabled,
  sending,
  onSend,
}: {
  disabled: boolean;
  sending: boolean;
  onSend: (file: File) => Promise<boolean>;
}) {
  const supported = typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);
  const choice = useMemo(
    () => (supported ? chooseRecorderMime((mime) => window.MediaRecorder.isTypeSupported(mime)) : { recorderMime: "", playsOnWhatsApp: false }),
    [supported],
  );
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState<{ file: File; url: string; playsOnWhatsApp: boolean } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const discardRef = useRef(false);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Leaving the thread mid-recording stops the microphone and forgets it.
  useEffect(() => () => {
    discardRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    stopTracks();
  }, [stopTracks]);
  useEffect(() => () => {
    if (recording) URL.revokeObjectURL(recording.url);
  }, [recording]);

  async function start() {
    if (!supported || state !== "idle" || disabled) return;
    setError("");
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = choice.recorderMime
        ? new MediaRecorder(stream, { mimeType: choice.recorderMime })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      discardRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stopTracks();
        if (discardRef.current) {
          setState("idle");
          return;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || choice.recorderMime });
        const file = recordingFile(blob.type, choice.recorderMime, Date.now());
        setRecording({
          file: new File([blob], file.fileName, { type: file.mimeType }),
          url: URL.createObjectURL(blob),
          playsOnWhatsApp: file.playsOnWhatsApp,
        });
        setState("ready");
      };
      recorder.start();
      startedAtRef.current = Date.now();
      setElapsed(0);
      setState("recording");
      timerRef.current = window.setInterval(() => {
        const ms = Date.now() - startedAtRef.current;
        setElapsed(ms);
        if (ms >= MAX_VOICE_NOTE_MS && recorder.state === "recording") recorder.stop();
      }, 250);
    } catch {
      stopTracks();
      setState("idle");
      setError("The microphone is not available. Allow it in your browser and try again.");
    }
  }

  function stop() {
    if (recorderRef.current && recorderRef.current.state === "recording") recorderRef.current.stop();
  }

  function cancelRecording() {
    discardRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    else setState("idle");
  }

  function discard() {
    setRecording(null);
    setState("idle");
  }

  async function send() {
    if (!recording || sending) return;
    const sent = await onSend(recording.file);
    if (sent) discard();
  }

  if (!supported) return null;
  if (state === "recording") {
    return (
      <div className="wa-recorder recording" role="status">
        <span className="wa-rec-dot" aria-hidden="true" />
        <span>Recording…</span>
        <span data-no-translate>{durationText(elapsed)}</span>
        <button className="lst-btn" type="button" onClick={stop}><Square size={13} /> Stop recording</button>
        <button className="lst-btn ghost" type="button" onClick={cancelRecording}><Trash2 size={13} /> Cancel</button>
      </div>
    );
  }
  if (state === "ready" && recording) {
    return (
      <div className="wa-recorder">
        <audio className="wa-audio" controls src={recording.url} />
        <button className="lst-add" type="button" disabled={sending || disabled} onClick={() => void send()}>
          {sending ? <RefreshCw className="spin" size={14} /> : <Send size={14} />}
          {sending ? "Sending…" : "Send voice note"}
        </button>
        <button className="lst-btn ghost" type="button" disabled={sending} onClick={discard}><Trash2 size={13} /> Discard recording</button>
        {!recording.playsOnWhatsApp && (
          <span className="wa-hint">This browser records in a format WhatsApp cannot play as a voice note. It will arrive as a file.</span>
        )}
      </div>
    );
  }
  return (
    <>
      <button
        className="lst-btn ghost"
        type="button"
        disabled={disabled || state === "starting"}
        onClick={() => void start()}
      >
        {state === "starting" ? <RefreshCw className="spin" size={14} /> : <Mic size={14} />}
        {state === "starting" ? "Starting…" : "Record voice note"}
      </button>
      {error && <span className="wa-hint error">{error}</span>}
    </>
  );
}

// ---------------------------------------------------------------------------
// The name customers see.
// ---------------------------------------------------------------------------

function signatureOf(name: string, org: string): string {
  if (!name) return org;
  if (!org || name === org) return name;
  return `${name} (${org})`;
}

function DisplayNameSetting({
  name,
  org,
  busy,
  onSave,
}: {
  name: string;
  org: string;
  busy: boolean;
  onSave: (name: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      if (await onSave(draft.trim())) setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="wa-signature">
        <span>Customers see</span>
        <strong data-no-translate>{signatureOf(name, org)}</strong>
        <button className="lst-btn ghost wa-mini" type="button" disabled={busy} onClick={() => setEditing(true)}>
          <Pencil size={12} /> Change
        </button>
      </div>
    );
  }
  return (
    <div className="wa-signature editing">
      <label className="wa-signature-field">
        <span>Name customers see on WhatsApp</span>
        <input
          maxLength={CHAT_DISPLAY_NAME_MAX}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Your first name"
        />
      </label>
      <button className="lst-btn" type="button" disabled={saving || busy} onClick={() => void save()}>
        {saving ? <RefreshCw className="spin" size={13} /> : <CheckCircle2 size={13} />}
        {saving ? "Saving…" : "Save"}
      </button>
      <button className="lst-btn ghost" type="button" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
      <span className="wa-hint">Empty uses your first name. Your messages are signed with this name and the business name.</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The thread.
// ---------------------------------------------------------------------------

const LABEL_REPLY = "WhatsApp reply sent";
const LABEL_NOTE = "Private note added";
const LABEL_FILE = "WhatsApp file sent";
const LABEL_VOICE = "Voice note sent";
const LABEL_DONE = "Conversation marked done";
const LABEL_REOPEN = "Conversation reopened";
const LABEL_HANDOFF = "Conversation handed over";
const LABEL_NAME = "Display name saved";

export function WhatsAppThread({
  scope,
  supportCase,
  messages,
  loading,
  error,
  canAnswer,
  onCall,
  request,
  busyAction,
  chatName,
  uploadFile,
  onHandedOver,
}: {
  scope: "business" | "admin";
  supportCase: FirestoreRow;
  messages: FirestoreRow[];
  loading: boolean;
  error: string;
  canAnswer: boolean;
  onCall: WhatsAppOnCall;
  request: WhatsAppRequest;
  busyAction: string;
  /** The signed-in person's name on WhatsApp (chatDisplayName, else first name). */
  chatName: string;
  uploadFile: (file: File) => Promise<SupportAttachmentPayload>;
  onHandedOver: (caseId: string) => void;
}) {
  const caseId = supportCase.id;
  const state = whatsappStateOf(supportCase);
  const isDone = state === "done";
  const handedTo = str(supportCase.handedTo);
  const org = scope === "admin" ? "Laawol" : str(supportCase.businessName);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [draft, setDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [result, setResult] = useState<ReturnType<typeof deliveryResultText>>(null);
  const [showHandoff, setShowHandoff] = useState(false);
  const handoff = useHandoffOptions(caseId, request, showHandoff);
  const handoffOptions = handoff.options;
  const [handoffTo, setHandoffTo] = useState("");
  const [handoffNote, setHandoffNote] = useState("");
  const [savedName, setSavedName] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const busy = Boolean(busyAction) || uploading;

  useEffect(() => {
    if (!handoffOptions.some((option) => option.id === handoffTo)) setHandoffTo(handoffOptions[0]?.id ?? "");
  }, [handoffOptions, handoffTo]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, caseId]);

  const captureDelivery = (data: unknown) => {
    const delivery = data && typeof data === "object" ? (data as Record<string, unknown>).delivery : undefined;
    setResult(deliveryResultText(delivery));
  };

  async function send() {
    const content = draft.trim();
    if (!content || busy) return;
    setResult(null);
    const done = mode === "note"
      ? await onCall(LABEL_NOTE, "whatsappConversation", { action: "note", caseId, text: content })
      : await onCall(LABEL_REPLY, "sendSupportMessage", { caseId, content, messageType: "text" }, undefined, captureDelivery);
    if (done) setDraft("");
  }

  async function sendFile(rawFile: File | null | undefined, label: string): Promise<boolean> {
    if (!rawFile || busy) return false;
    setUploadError("");
    setResult(null);
    setUploading(true);
    let payload: SupportAttachmentPayload;
    try {
      payload = await uploadFile(rawFile);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
      setUploading(false);
      return false;
    }
    setUploading(false);
    const caption = mode === "reply" && label === LABEL_FILE ? draft.trim() : "";
    const done = await onCall(label, "uploadSupportAttachmentMetadata", {
      ...payload,
      ...(caption ? { caption } : {}),
    }, undefined, captureDelivery);
    if (done && caption) setDraft("");
    return done;
  }

  async function setDone(next: boolean) {
    await onCall(next ? LABEL_DONE : LABEL_REOPEN, "whatsappConversation", { action: next ? "done" : "reopen", caseId });
  }

  async function handOver() {
    if (!handoffTo || busy) return;
    const target = handoffOptions.find((option) => option.id === handoffTo);
    const note = handoffNote.trim();
    let nextId = "";
    const done = await onCall(
      LABEL_HANDOFF,
      "whatsappConversation",
      { action: "handoff", caseId, to: handoffTo, ...(note ? { note } : {}) },
      {
        confirm: `Hand this conversation over to ${target?.name ?? handoffTo}? It is marked done here.`,
        confirmFr: `Transférer cette conversation à ${target?.name ?? handoffTo} ? Elle est marquée terminée ici.`,
      },
      (data) => {
        const id = data && typeof data === "object" ? (data as Record<string, unknown>).caseId : "";
        nextId = typeof id === "string" ? id : "";
      },
    );
    if (!done) return;
    setShowHandoff(false);
    setHandoffNote("");
    if (nextId) onHandedOver(nextId);
  }

  async function saveName(name: string): Promise<boolean> {
    let saved = name;
    const done = await onCall(LABEL_NAME, "whatsappConversation", { action: "setDisplayName", name }, undefined, (data) => {
      const value = data && typeof data === "object" ? (data as Record<string, unknown>).name : undefined;
      if (typeof value === "string") saved = value;
    });
    if (done) setSavedName(saved);
    return done;
  }

  const shownName = savedName ?? chatName;

  return (
    <div className="sup-thread wa-thread">
      <header className="sup-thread-head">
        <div>
          <strong><UserText value={supportCase.customerName} fallback="Customer" /></strong>
          <span className="sup-thread-meta">
            <span data-no-translate>{str(supportCase.whatsappPhone)}</span>
            {scope === "admin" && (
              <>
                {" · "}
                {str(supportCase.businessId)
                  ? <UserText value={supportCase.businessName} fallback="Business" />
                  : <>Laawol</>}
                {!str(supportCase.businessId) && str(supportCase.suggestedBusinessName) && (
                  <> · <span>Belongs to</span> <UserText value={supportCase.suggestedBusinessName} /></>
                )}
              </>
            )}
          </span>
        </div>
        <div className="sup-thread-tags">
          <WhatsAppBadge />
          <WhatsAppStatePill row={supportCase} />
          {supportCase.updatesStopped === true && <StoppedUpdatesTag />}
        </div>
      </header>

      {error && <div className="error-box">{error}</div>}
      {handedTo && (
        <div className="info-band">This conversation was handed over. New messages from the customer go to the new inbox.</div>
      )}

      <ConversationPackages caseId={caseId} request={request} />

      <div className="sup-messages" ref={scrollRef}>
        {loading && <div className="empty-state">Loading conversation…</div>}
        {!loading && messages.length === 0 && <div className="empty-state">No messages yet.</div>}
        {messages.map((message) => <WhatsAppMessageBubble key={message.id} message={message} />)}
      </div>

      {canAnswer ? (
        <div className={`sup-composer wa-composer ${mode === "note" ? "note-mode" : ""}`}>
          <div className="wa-mode" role="tablist" aria-label="Write a reply or a note">
            <button type="button" role="tab" aria-selected={mode === "reply"} className={mode === "reply" ? "active" : ""} onClick={() => setMode("reply")}>
              <MessageCircle size={13} /> Reply on WhatsApp
            </button>
            <button type="button" role="tab" aria-selected={mode === "note"} className={mode === "note" ? "active" : ""} onClick={() => setMode("note")}>
              <StickyNote size={13} /> Private note
            </button>
          </div>
          <textarea
            key={mode}
            rows={3}
            // The French pass never enters a <textarea> (french-dom.ts
            // SKIPPED_TAGS), so its placeholder is picked here.
            placeholder={currentLanguage() === "fr"
              ? mode === "note" ? "Écrivez une note visible uniquement par votre équipe…" : "Rédigez une réponse au client…"
              : mode === "note" ? "Write a note only your team sees…" : "Write a reply to the customer…"}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              if (result) setResult(null);
            }}
          />
          {mode === "reply" && <DisplayNameSetting name={shownName} org={org} busy={busy} onSave={saveName} />}
          {uploadError && <div className="error-box">{uploadError}</div>}
          {result && <div className={`wa-result ${result.tone}`} role="status"><CheckCheck size={13} aria-hidden="true" /> {result.text}</div>}
          <div className="sup-composer-actions">
            {mode === "note" ? (
              <button className="lst-add" type="button" disabled={busy || !draft.trim()} onClick={() => void send()}>
                {busyAction === LABEL_NOTE ? <RefreshCw className="spin" size={15} /> : <StickyNote size={15} />}
                {busyAction === LABEL_NOTE ? "Adding…" : "Add note"}
              </button>
            ) : (
              <>
                <button className="lst-add" type="button" disabled={busy || !draft.trim()} onClick={() => void send()}>
                  {busyAction === LABEL_REPLY ? <RefreshCw className="spin" size={15} /> : <Send size={15} />}
                  {busyAction === LABEL_REPLY ? "Sending…" : "Send"}
                </button>
                <label className={`lst-btn ghost sup-attach ${busy ? "is-busy" : ""}`}>
                  {uploading || busyAction === LABEL_FILE ? <RefreshCw className="spin" size={14} /> : <ImagePlus size={14} />}
                  {uploading || busyAction === LABEL_FILE ? "Sending…" : "Photo or video"}
                  <input
                    type="file"
                    accept="image/*,.heic,.heif,video/*"
                    hidden
                    disabled={busy}
                    onChange={(event) => {
                      void sendFile(event.target.files?.[0], LABEL_FILE);
                      event.target.value = "";
                    }}
                  />
                </label>
                <label className={`lst-btn ghost sup-attach ${busy ? "is-busy" : ""}`}>
                  <Paperclip size={14} /> File
                  <input
                    type="file"
                    accept="image/*,.heic,.heif,video/*,audio/*,application/pdf,text/plain,.doc,.docx"
                    hidden
                    disabled={busy}
                    onChange={(event) => {
                      void sendFile(event.target.files?.[0], LABEL_FILE);
                      event.target.value = "";
                    }}
                  />
                </label>
                <VoiceNoteRecorder
                  disabled={busy}
                  sending={uploading || busyAction === LABEL_VOICE}
                  onSend={(file) => sendFile(file, LABEL_VOICE)}
                />
              </>
            )}
          </div>
          <div className="sup-composer-actions wa-thread-actions">
            {isDone ? (
              <button className="lst-btn ghost" type="button" disabled={busy || Boolean(handedTo)} onClick={() => void setDone(false)}>
                {busyAction === LABEL_REOPEN ? <RefreshCw className="spin" size={14} /> : <RotateCcw size={14} />}
                {busyAction === LABEL_REOPEN ? "Reopening…" : "Reopen"}
              </button>
            ) : (
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => void setDone(true)}>
                {busyAction === LABEL_DONE ? <RefreshCw className="spin" size={14} /> : <CheckCircle2 size={14} />}
                {busyAction === LABEL_DONE ? "Saving…" : "Mark done"}
              </button>
            )}
            {!handedTo && (
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => setShowHandoff((value) => !value)}>
                <ArrowRightLeft size={14} /> Hand over
              </button>
            )}
          </div>
          {showHandoff && (
            <div className="sup-escalate wa-handoff">
              {handoff.loading && <span className="sup-order-empty"><RefreshCw className="spin" size={12} /> Loading…</span>}
              {handoff.error && (
                <span className="wa-hint error">
                  {handoff.error === "The list could not be loaded. Try again."
                    ? <span>{handoff.error}</span>
                    : <span data-no-translate>{handoff.error}</span>}{" "}
                  <button className="lst-btn ghost wa-mini" type="button" onClick={handoff.retry}>Retry</button>
                </span>
              )}
              {handoff.loaded && handoffOptions.length === 0 && (
                <span className="wa-hint">No other inbox can take this conversation.</span>
              )}
              {handoffOptions.length > 0 && (
              <label className="bar-field">
                <span>Hand over to</span>
                <select value={handoffTo} onChange={(event) => setHandoffTo(event.target.value)}>
                  {handoffOptions.map((option) => (
                    <option key={option.id} value={option.id} data-no-translate={option.id === "laawol" ? undefined : true}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
              )}
              <label className="bar-field wa-handoff-note">
                <span>Note for them (optional)</span>
                <input value={handoffNote} maxLength={300} onChange={(event) => setHandoffNote(event.target.value)} />
              </label>
              <button className="lst-btn" type="button" disabled={busy || !handoffTo || handoff.loading} onClick={() => void handOver()}>
                {busyAction === LABEL_HANDOFF ? <RefreshCw className="spin" size={14} /> : <ArrowRightLeft size={14} />}
                {busyAction === LABEL_HANDOFF ? "Handing over…" : "Confirm hand over"}
              </button>
              {scope === "business" && (
                <span className="wa-hint">You can hand it to Laawol, or to another business that has a package for this customer.</span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="info-band">You have read-only access to support cases.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Laawol's inbox mode (admin, WhatsApp view).
// ---------------------------------------------------------------------------

const LABEL_MODE = "WhatsApp inbox mode changed";
const MODE_TIMEOUT_MS = 20_000;

export function InboxModeSwitch({
  request,
  onCall,
  busyAction,
  canChange,
}: {
  request: WhatsAppRequest;
  onCall: WhatsAppOnCall;
  busyAction: string;
  canChange: boolean;
}) {
  const [mode, setMode] = useState<InboxMode | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      active = false;
      setLoading(false);
      setError("The inbox mode could not be loaded.");
    }, MODE_TIMEOUT_MS);
    request("whatsappConversation", { action: "mode" })
      .then((data) => {
        if (!active) return;
        setMode(inboxModeOf(data));
        setError("");
      })
      .catch(() => {
        if (active) setError("The inbox mode could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
        active = false;
        window.clearTimeout(timer);
      });
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [request]);

  async function switchTo(next: InboxMode) {
    const spec = INBOX_MODES.find((item) => item.id === next);
    if (!spec || busyAction) return;
    await onCall(LABEL_MODE, "whatsappConversation", { action: "setMode", mode: next }, {
      confirm: spec.confirm,
      confirmFr: spec.confirmFr,
    }, (data) => {
      const saved = inboxModeOf(data);
      if (saved) setMode(saved);
    });
  }

  return (
    <section className="wa-inbox-mode" aria-label="WhatsApp inbox mode">
      <div className="wa-inbox-mode-head">
        <strong>Who answers new WhatsApp conversations</strong>
        {loading && <span className="sup-order-empty"><RefreshCw className="spin" size={12} /> Loading…</span>}
        {error && <span className="wa-hint error">{error}</span>}
      </div>
      <div className="wa-inbox-mode-options" role="radiogroup" aria-label="WhatsApp inbox mode">
        {INBOX_MODES.map((option) => {
          const current = mode === option.id;
          return (
            <div key={option.id} className={`wa-inbox-mode-option ${current ? "current" : ""}`} role="radio" aria-checked={current}>
              <div className="wa-inbox-mode-title">
                <strong>{option.label}</strong>
                {current && <span className="status-pill compact ok">Current mode</span>}
              </div>
              <p>{option.explanation}</p>
              {!current && canChange && !loading && (
                <button className="lst-btn ghost" type="button" disabled={Boolean(busyAction)} onClick={() => void switchTo(option.id)}>
                  {busyAction === LABEL_MODE ? <RefreshCw className="spin" size={13} /> : <ArrowRightLeft size={13} />}
                  {busyAction === LABEL_MODE ? "Switching…" : `Switch to ${option.label}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
