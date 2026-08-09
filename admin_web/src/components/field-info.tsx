"use client";

import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * An "i" a reader can press to get the explanation, and press again to put it
 * away.
 *
 * The console used to explain fields in permanent amber banners. Every reader
 * paid for them on every visit, including the hundredth, and because the space
 * was free the wording drifted into describing the implementation - inherited
 * rates, blanket rates, fallbacks - rather than what to type. Detail on demand
 * keeps the screen quiet and lets the explanation be as long as it needs to
 * be, because nobody reads it unless they asked.
 *
 * Rules for using it, so the pattern stays predictable:
 *
 * - The label says what to do; the "i" says why, what happens, and edge cases.
 * - Never hide something the reader must know to avoid a mistake. A warning
 *   about money moving belongs on the screen, not behind a press.
 * - Write the explanation in the reader's terms. "0% takes nothing" beats "0%
 *   is a real rate rather than an inherited null".
 */
export function FieldInfo({
  label,
  children,
}: {
  /** What this explains, for screen readers: "what per-service rates do". */
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    // Escape closes it, and so does clicking away: a reader who has moved on
    // should not have to come back and press the "i" again to tidy up.
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onClick(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <span className="field-info" ref={wrapRef}>
      {/* Deliberately not a <button>. Read-only screens wrap their form in a
          disabled <fieldset>, which disables every descendant form control -
          so the "i" became unpressable for exactly the people most likely to
          need it: staff who can look but not edit. A span with the button role
          is not a form control, so it stays available, and the key handlers
          below keep it operable from the keyboard. */}
      <span
        aria-controls={id}
        aria-expanded={open}
        aria-label={open ? `Hide explanation: ${label}` : `Explain ${label}`}
        className={`field-info-button ${open ? "active" : ""}`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          setOpen((value) => !value);
        }}
        role="button"
        tabIndex={0}
      >
        <Info size={14} />
      </span>
      {open && (
        <span className="field-info-bubble" id={id} role="note">
          {children}
        </span>
      )}
    </span>
  );
}
