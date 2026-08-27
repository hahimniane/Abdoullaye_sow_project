"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

import {
  confirmationMessage,
  resolveActionConfirmation,
  subscribeToActionConfirmations,
  type PendingActionConfirmation,
} from "@/lib/action-confirmation";
import { currentWebLanguage, type SupportedLanguage } from "@/lib/language";

const DIALOG_COPY: Record<
  SupportedLanguage,
  {title: string; confirm: string; cancel: string}
> = {
  en: {
    title: "Please confirm",
    confirm: "Confirm",
    cancel: "Cancel",
  },
  fr: {
    title: "Confirmation requise",
    confirm: "Confirmer",
    cancel: "Annuler",
  },
};

/**
 * Single in-page replacement for window.confirm, mounted once for the whole
 * app. Callers reach it through confirmImportantAction(); this component only
 * renders whatever request is at the head of the queue and answers it.
 */
export function ActionConfirmationHost() {
  const [pending, setPending] = useState<PendingActionConfirmation | null>(null);
  const confirmButton = useRef<HTMLButtonElement | null>(null);
  const cancelButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => subscribeToActionConfirmations(setPending), []);

  const settle = useCallback(
    (confirmed: boolean) => {
      if (!pending) return;
      resolveActionConfirmation(pending.id, confirmed);
    },
    [pending],
  );

  // Move focus into the dialog while it is open and hand it back to whatever
  // opened it afterwards, so a keyboard user is not dropped at the top of the
  // page after answering.
  useEffect(() => {
    if (!pending) return undefined;
    const opener = document.activeElement;
    const restoreTo = opener instanceof HTMLElement ? opener : null;
    confirmButton.current?.focus();
    return () => {
      if (restoreTo?.isConnected) restoreTo.focus();
    };
  }, [pending]);

  // Escape cancels; Tab stays inside the dialog. The dialog owns only two
  // controls, so the trap is just a swap between them.
  useEffect(() => {
    if (!pending) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        settle(false);
        return;
      }
      if (event.key !== "Tab") return;
      const confirm = confirmButton.current;
      const cancel = cancelButton.current;
      if (!confirm || !cancel) return;
      event.preventDefault();
      (document.activeElement === cancel ? confirm : cancel).focus();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [pending, settle]);

  if (!pending) return null;

  const language = currentWebLanguage();
  const copy = DIALOG_COPY[language];
  const message = confirmationMessage(pending.english, pending.french, language);

  return (
    <div
      className="action-confirm-overlay"
      data-action-confirm-overlay=""
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) settle(false);
      }}
    >
      <div
        aria-describedby="action-confirm-message"
        aria-labelledby="action-confirm-title"
        aria-modal="true"
        className="action-confirm"
        role="alertdialog"
      >
        <div className="action-confirm-mark" aria-hidden="true">
          <AlertTriangle size={20} />
        </div>
        <div className="action-confirm-copy">
          <h2 id="action-confirm-title">{copy.title}</h2>
          <p id="action-confirm-message">{message}</p>
        </div>
        <div className="action-confirm-actions">
          <button
            className="secondary-button"
            data-action-confirm="cancel"
            onClick={() => settle(false)}
            ref={cancelButton}
            type="button"
          >
            {copy.cancel}
          </button>
          <button
            className="primary-button"
            data-action-confirm="confirm"
            onClick={() => settle(true)}
            ref={confirmButton}
            type="button"
          >
            {copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
