"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Mail, MessageCircle } from "lucide-react";

import {
  INVITE_METHOD_LABELS,
  INVITE_METHODS,
  STAFF_INVITE_COPY,
  type InviteMethod,
} from "@/lib/staff-phone-invite";

/**
 * The pieces every staff invite form shares (docs/STAFF_PHONE_INVITES.md):
 * the Phone (WhatsApp) / Email switch and the "not sent yet - share this
 * link" box. The business People panel and the admin console's invite
 * forms all use these, so the two flows read the same everywhere.
 */
export function InviteMethodSwitch({
  method,
  onChange,
  disabled = false,
}: {
  method: InviteMethod;
  onChange: (method: InviteMethod) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="customer-segmented invite-method-switch">
      <legend>Send the invitation by</legend>
      {INVITE_METHODS.map((option) => (
        <button
          aria-pressed={method === option}
          className={method === option ? "active" : ""}
          disabled={disabled}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {option === "phone" ? <MessageCircle aria-hidden="true" size={16} /> : <Mail aria-hidden="true" size={16} />}
          {INVITE_METHOD_LABELS[option]}
        </button>
      ))}
    </fieldset>
  );
}

/** One tap to copy, with a visible "Copied" for a moment after. */
export function CopyLinkButton({ link, className = "secondary-button" }: { link: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(link);
          setFailed(false);
          setCopied(true);
        } catch {
          // Clipboard blocked (an insecure page, a denied permission): the
          // read-only field next to it can still be selected by hand.
          setFailed(true);
        }
      }}
      type="button"
    >
      {copied ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
      {copied ? STAFF_INVITE_COPY.copied : failed ? "Select the link to copy it" : STAFF_INVITE_COPY.copyLink}
    </button>
  );
}

/**
 * "WhatsApp message not sent yet - share this link": the invitation exists
 * and is pending; the owner sends the link themselves (until Meta approves
 * the template, every phone invitation lands here). Not an error.
 */
export function InviteLinkShare({ link, id, compact = false }: { link: string; id: string; compact?: boolean }) {
  return (
    <div className={`invite-link-share${compact ? " compact" : ""}`} role="status">
      <strong>{STAFF_INVITE_COPY.notSentShareLink}</strong>
      {!compact && <p>{STAFF_INVITE_COPY.shareLinkHint}</p>}
      <label className="sr-only" htmlFor={id}>{STAFF_INVITE_COPY.linkLabel}</label>
      <div className="invite-link-row">
        <input
          data-no-translate
          id={id}
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          value={link}
        />
        <CopyLinkButton link={link} />
      </div>
    </div>
  );
}
