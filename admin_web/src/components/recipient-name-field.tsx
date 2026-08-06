"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { UserRound } from "lucide-react";

import { auth, db } from "@/lib/firebase";
import {
  SAVED_RECIPIENT_LIMIT,
  matchingSavedRecipients,
  savedRecipientFromData,
  savedRecipientIsUsable,
  savedRecipientsPath,
  type SavedRecipient,
} from "@/lib/saved-recipients";

/**
 * Subscribes to the signed-in customer's remembered recipients.
 *
 * Every failure path - signed out, rules rejection, offline - resolves to an
 * empty list. Suggestions are a convenience and must never break a checkout
 * the customer could otherwise complete by typing.
 */
export function useSavedRecipients(): SavedRecipient[] {
  const [uid, setUid] = useState("");
  const [recipients, setRecipients] = useState<SavedRecipient[]>([]);

  useEffect(
    () =>
      onAuthStateChanged(
        auth,
        (user) => setUid(user?.uid ?? ""),
        () => setUid(""),
      ),
    [],
  );

  useEffect(() => {
    if (!uid) {
      setRecipients([]);
      return;
    }
    return onSnapshot(
      query(
        collection(db, ...savedRecipientsPath(uid)),
        orderBy("lastUsedAt", "desc"),
        limit(SAVED_RECIPIENT_LIMIT),
      ),
      (snapshot) =>
        setRecipients(
          snapshot.docs
            .map((item) => savedRecipientFromData(item.id, item.data()))
            .filter(savedRecipientIsUsable),
        ),
      () => setRecipients([]),
    );
  }, [uid]);

  return recipients;
}

/**
 * Receiver-name input that offers people this customer has shipped to before
 * (docs/PLAN-2026-08-backlog.md #7). Web half of the mobile
 * `RecipientNameField` widget - keep the two in step.
 *
 * Typing a few letters of a past recipient's name (or the start of their
 * number) offers their saved profile; picking one fills in the rest. It stays
 * an ordinary text input otherwise: a first-time recipient is typed normally
 * and nothing is forced on the customer.
 */
export function RecipientNameField({
  id,
  label = "Receiver name",
  onChange,
  onSelect,
  recipients: recipientsOverride,
  required = true,
  value,
}: {
  id: string;
  label?: string;
  onChange: (value: string) => void;
  onSelect: (recipient: SavedRecipient) => void;
  /** Injected list, for tests and previews. Live data is read by default. */
  recipients?: readonly SavedRecipient[];
  required?: boolean;
  value: string;
}) {
  const subscribed = useSavedRecipients();
  const recipients = recipientsOverride ?? subscribed;
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = `${id}-recipients`;
  const matches =
    focused && !dismissed ? matchingSavedRecipients(recipients, value) : [];

  function choose(recipient: SavedRecipient) {
    setDismissed(true);
    setActiveIndex(-1);
    onChange(recipient.name);
    onSelect(recipient);
  }

  return (
    <div className="customer-recipient-field">
      <label htmlFor={id}>{label}</label>
      <input
        aria-activedescendant={
          activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={matches.length > 0}
        autoComplete="off"
        id={id}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          setDismissed(false);
          setActiveIndex(-1);
          onChange(event.target.value);
        }}
        onFocus={() => setFocused(true)}
        onKeyDown={(event) => {
          if (matches.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) =>
              Math.min(current + 1, matches.length - 1),
            );
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) =>
              current <= 0 ? matches.length - 1 : current - 1,
            );
          } else if (event.key === "Enter" && matches[activeIndex]) {
            event.preventDefault();
            choose(matches[activeIndex]);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDismissed(true);
            setActiveIndex(-1);
          }
        }}
        required={required}
        role="combobox"
        value={value}
      />
      {matches.length > 0 && (
        <div
          aria-label="Saved recipients"
          className="customer-address-suggestions"
          id={listboxId}
          role="listbox"
        >
          {matches.map((recipient, index) => (
            <button
              aria-selected={activeIndex === index}
              className={activeIndex === index ? "active" : ""}
              id={`${listboxId}-option-${index}`}
              key={recipient.id}
              onClick={() => choose(recipient)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              type="button"
            >
              <UserRound size={15} />
              <span>
                <strong>{recipient.name}</strong>
                <small>
                  {[recipient.phone, recipient.countryName]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
