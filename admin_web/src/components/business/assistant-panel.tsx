"use client";

import { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";

import { functions } from "@/lib/firebase";

// Chat body for the business assistant. It is rendered inside the floating
// `AssistantWidget`, which supplies the surrounding panel chrome and header.
//
// Client for the deployed `businessAssistantChat` callable. The response's
// `transcript` is the canonical conversation state: to continue the chat we
// append a user turn and call the function again. Proposed actions are never
// executed automatically - each one renders a confirmation card and only an
// explicit Confirm click runs the named callable.

type AssistantBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: true };

type TranscriptMessage = {
  role: "user" | "assistant";
  content: string | AssistantBlock[];
};

type ProposedAction = {
  toolUseId: string;
  tool: string;
  callable: string;
  section: string;
  title: string;
  params: Record<string, unknown>;
};

type AssistantChatResponse = {
  reply?: string;
  transcript?: TranscriptMessage[];
  proposedAction?: ProposedAction | null;
};

type ActionStatus = "pending" | "working" | "confirmed" | "declined" | "failed";

type ChatItem =
  | { kind: "user"; id: number; text: string }
  | { kind: "assistant"; id: number; text: string }
  | { kind: "error"; id: number; text: string }
  | { kind: "action"; id: number; action: ProposedAction; status: ActionStatus };

const actionStatusLabels: Record<ActionStatus, string> = {
  pending: "",
  working: "Working...",
  confirmed: "Confirmed",
  declined: "Declined",
  failed: "Failed",
};

function paramLabel(key: string) {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function paramValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function AssistantPanel({
  businessId,
  previewMode = false,
}: {
  businessId: string;
  previewMode?: boolean;
}) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const nextIdRef = useRef(1);
  const listRef = useRef<HTMLDivElement | null>(null);
  const disabled = busy || previewMode || !businessId;

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [items, busy]);

  function nextId() {
    return nextIdRef.current++;
  }

  function pushItems(...added: ChatItem[]) {
    setItems((current) => [...current, ...added]);
  }

  function setActionStatus(id: number, status: ActionStatus) {
    setItems((current) =>
      current.map((entry) =>
        entry.kind === "action" && entry.id === id ? { ...entry, status } : entry,
      ),
    );
  }

  async function requestAssistant(messages: TranscriptMessage[]) {
    const response = await httpsCallable(functions, "businessAssistantChat")({
      businessId,
      messages,
    });
    return (response.data ?? {}) as AssistantChatResponse;
  }

  function adoptResponse(
    data: AssistantChatResponse,
    fallback: TranscriptMessage[],
  ) {
    setTranscript(Array.isArray(data.transcript) ? data.transcript : fallback);
    const added: ChatItem[] = [];
    const reply = typeof data.reply === "string" ? data.reply.trim() : "";
    if (reply) added.push({ kind: "assistant", id: nextId(), text: reply });
    const action = data.proposedAction;
    if (action && action.toolUseId && action.callable) {
      added.push({ kind: "action", id: nextId(), action, status: "pending" });
    }
    if (added.length > 0) pushItems(...added);
  }

  function chatError(error: unknown): ChatItem {
    return {
      kind: "error",
      id: nextId(),
      text:
        error instanceof Error && error.message
          ? error.message
          : "The assistant could not reply. Try again.",
    };
  }

  async function send() {
    const message = input.trim();
    if (!message || disabled) return;
    setInput("");
    pushItems({ kind: "user", id: nextId(), text: message });
    const next: TranscriptMessage[] = [
      ...transcript,
      { role: "user", content: message },
    ];
    setBusy(true);
    try {
      adoptResponse(await requestAssistant(next), next);
    } catch (error) {
      // The failed turn is not kept in the transcript, so retrying the
      // message starts from the last good state.
      pushItems(chatError(error));
    } finally {
      setBusy(false);
    }
  }

  async function resolveAction(
    item: Extract<ChatItem, { kind: "action" }>,
    confirmed: boolean,
  ) {
    if (busy || item.status !== "pending") return;
    const { action } = item;
    setBusy(true);
    setActionStatus(item.id, "working");
    let content = "Declined by the staff member.";
    let isError = true;
    let status: ActionStatus = "declined";
    if (confirmed) {
      try {
        const result = await httpsCallable(functions, action.callable)(
          action.params,
        );
        content = JSON.stringify(result.data ?? { success: true });
        isError = false;
        status = "confirmed";
      } catch (error) {
        content = String(error instanceof Error ? error.message : error);
        status = "failed";
      }
    }
    setActionStatus(item.id, status);
    const toolResult: AssistantBlock = {
      type: "tool_result",
      tool_use_id: action.toolUseId,
      content,
      ...(isError ? { is_error: true as const } : {}),
    };
    const next: TranscriptMessage[] = [
      ...transcript,
      { role: "user", content: [toolResult] },
    ];
    try {
      adoptResponse(await requestAssistant(next), next);
    } catch (error) {
      // The action outcome already happened, so keep its tool result in the
      // canonical transcript even though the narration call failed.
      setTranscript(next);
      pushItems(chatError(error));
    } finally {
      setBusy(false);
    }
  }

  function handleComposerKey(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <div className="assistant-panel">
      {previewMode && (
        <div className="info-band">
          The assistant is unavailable in preview mode.
        </div>
      )}
      <div className="assistant-chat" ref={listRef}>
        {items.length === 0 && (
          <div className="assistant-hint">
            <strong>What the assistant can do</strong>
            <ul>
              <li>Check which cars are parked and their payment status.</li>
              <li>Record a walk-up parking entry for a customer.</li>
              <li>Mark a parking as paid or re-check a payment link.</li>
              <li>Add tracking updates to a shipment.</li>
            </ul>
            <small>
              Every change is shown here for your confirmation before it runs.
            </small>
          </div>
        )}
        {items.map((item) => {
          if (item.kind === "action") {
            return (
              <AssistantActionCard
                key={item.id}
                item={item}
                busy={busy}
                onResolve={(confirmed) => void resolveAction(item, confirmed)}
              />
            );
          }
          if (item.kind === "error") {
            return (
              <div className="error-box assistant-error" key={item.id}>
                {item.text}
              </div>
            );
          }
          return (
            <div
              className={`bubble ${item.kind === "user" ? "mine" : ""}`}
              key={item.id}
            >
              <span className="bubble-text">{item.text}</span>
            </div>
          );
        })}
        {busy && (
          <div className="bubble assistant-typing">
            <span className="bubble-text">The assistant is typing...</span>
          </div>
        )}
      </div>
      <div className="sup-composer assistant-composer">
        <textarea
          aria-label="Message the assistant"
          disabled={disabled}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleComposerKey}
          placeholder="Message the assistant..."
          value={input}
        />
        <div className="sup-composer-actions">
          <button
            className="primary-button"
            disabled={disabled || !input.trim()}
            onClick={() => void send()}
            type="button"
          >
            {busy ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssistantActionCard({
  item,
  busy,
  onResolve,
}: {
  item: Extract<ChatItem, { kind: "action" }>;
  busy: boolean;
  onResolve: (confirmed: boolean) => void;
}) {
  const { action, status } = item;
  const params = Object.entries(action.params ?? {}).filter(
    ([key]) => key !== "businessId",
  );
  return (
    <div className="assistant-action-card" data-status={status}>
      <strong>{action.title}</strong>
      {params.length > 0 && (
        <dl className="assistant-action-params">
          {params.map(([key, value]) => (
            <div key={key}>
              <dt>{paramLabel(key)}</dt>
              <dd>{paramValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {status === "pending" ? (
        <div className="assistant-action-buttons">
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => onResolve(true)}
            type="button"
          >
            Confirm
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => onResolve(false)}
            type="button"
          >
            Cancel
          </button>
        </div>
      ) : (
        <span
          className={`status-pill compact ${status === "confirmed" ? "" : "warning"}`}
        >
          {actionStatusLabels[status]}
        </span>
      )}
    </div>
  );
}
