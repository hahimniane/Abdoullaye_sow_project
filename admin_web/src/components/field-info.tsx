"use client";

import { Info } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  const bubbleRef = useRef<HTMLSpanElement>(null);
  // Fixed-position coordinates for the bubble. The bubble used to be
  // absolutely positioned inside the label, which put it UNDER whatever
  // ancestor had overflow clipping - readers got half an explanation sliced
  // mid-sentence, laid over the very input it described. A portal to <body>
  // with fixed positioning escapes every clipping ancestor.
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }
    function place() {
      const anchor = wrapRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(320, window.innerWidth * 0.78);
      const left = Math.min(
        Math.max(8, anchor.left),
        window.innerWidth - width - 8,
      );
      const bubbleHeight = bubbleRef.current?.offsetHeight ?? 0;
      const below = anchor.bottom + 6;
      // Flip above the icon when the explanation would run off the bottom.
      const top =
        bubbleHeight > 0 && below + bubbleHeight > window.innerHeight - 8
          ? Math.max(8, anchor.top - bubbleHeight - 6)
          : below;
      setPosition({top, left});
    }
    place();
    // Re-measure once the bubble has a size (first pass has no ref yet).
    const raf = requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    // Escape closes it, and so does clicking away: a reader who has moved on
    // should not have to come back and press the "i" again to tidy up.
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onClick(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !wrapRef.current?.contains(target) &&
        !bubbleRef.current?.contains(target)
      ) {
        setOpen(false);
      }
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
      {open &&
        createPortal(
          <span
            className="field-info-bubble"
            id={id}
            ref={bubbleRef}
            role="note"
            style={{
              position: "fixed",
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              visibility: position ? "visible" : "hidden",
            }}
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
