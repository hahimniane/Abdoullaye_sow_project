"use client";

// "Message customer" on a package (docs/WHATSAPP_CONVERSATIONS.md decision
// 5): opens - or starts - the WhatsApp conversation with the package's sender
// or receiver and shows it in Support. The business console provides where
// to go (MessageCustomerProvider); the Shipping lists only place the button.

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { MessageCircle, RefreshCw } from "lucide-react";
import { httpsCallable } from "firebase/functions";

import { functions } from "@/lib/firebase";
import { packageMessageContacts, type MessageContact } from "@/lib/whatsapp-conversations";
import { previewWhatsAppCall } from "@/lib/whatsapp-preview";

type MessageCustomerTarget = {
  /** Show the conversation (the console switches to Support on it). */
  openConversation: (caseId: string) => void;
  previewMode: boolean;
};

const MessageCustomerContext = createContext<MessageCustomerTarget | null>(null);

export const MessageCustomerProvider = MessageCustomerContext.Provider;

const OPEN_TIMEOUT_MS = 30_000;

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message || "The conversation could not be opened. Try again.";
}

/**
 * The button for one package. Nothing shows without a console to open the
 * conversation in, or without a number WhatsApp can reach (with its country
 * code). With both a sender and a receiver, it asks which.
 */
export function MessageCustomerButton({ row }: { row: unknown }) {
  const target = useContext(MessageCustomerContext);
  const contacts = packageMessageContacts(row);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);

  if (!target || contacts.length === 0) return null;

  async function open(contact: MessageContact) {
    if (!target || busy) return;
    setBusy(true);
    setError("");
    setChoosing(false);
    let timer: number | undefined;
    try {
      const payload = { action: "open", phone: contact.phone, name: contact.name };
      const call = target.previewMode
        ? previewWhatsAppCall("whatsappConversation", payload)
        : httpsCallable(functions, "whatsappConversation")(payload).then((result) => result.data);
      // The button never stays spinning: a slow server reads as a failure.
      const data = await Promise.race([
        call,
        new Promise((_, reject) => {
          timer = window.setTimeout(() => reject(new Error("The conversation could not be opened. Try again.")), OPEN_TIMEOUT_MS);
        }),
      ]);
      const caseId = data && typeof data === "object" ? (data as Record<string, unknown>).caseId : "";
      if (typeof caseId !== "string" || !caseId) throw new Error("The conversation could not be opened. Try again.");
      target.openConversation(caseId);
    } catch (err) {
      if (mounted.current) setError(errorText(err));
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <span className="wa-message-customer">
      <button
        className="lst-btn ghost wa-mini"
        type="button"
        disabled={busy}
        aria-expanded={contacts.length > 1 ? choosing : undefined}
        onClick={() => {
          if (contacts.length === 1) void open(contacts[0]);
          else setChoosing((value) => !value);
        }}
      >
        {busy ? <RefreshCw className="spin" size={12} /> : <MessageCircle size={12} />}
        {busy ? "Opening…" : "Message customer"}
      </button>
      {choosing && (
        <span className="wa-message-choices" role="menu">
          {contacts.map((contact) => (
            <button key={contact.phone} className="lst-btn ghost wa-mini" type="button" role="menuitem" disabled={busy} onClick={() => void open(contact)}>
              <span>{contact.role === "sender" ? "Sender" : "Receiver"}</span>
              <span data-no-translate>{contact.name ? `${contact.name} · ${contact.phone}` : contact.phone}</span>
            </button>
          ))}
        </span>
      )}
      {error && <small className="ctn-wa-fail" role="alert">{error}</small>}
    </span>
  );
}
