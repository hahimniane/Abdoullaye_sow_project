"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, X } from "lucide-react";

import { AssistantPanel } from "@/components/business/assistant-panel";

// Floating launcher for the business assistant, mirroring the customer widget
// on the public site: a fixed bottom-right bubble that opens a small panel
// above itself. The panel is mounted once for the whole console, so the
// conversation survives switching tabs, and it stays mounted while closed so
// closing the bubble never throws away the transcript.
//
// This is a non-modal helper: it never traps focus and never covers the page
// with an overlay, so the console behind it stays usable while it is open.

export function AssistantWidget({
  businessId,
  previewMode = false,
}: {
  businessId: string;
  previewMode?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      launcherRef.current?.focus();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Opening should put the caret in the composer, the way the public-site
    // widget focuses its input. A disabled composer (preview mode) ignores it.
    panelRef.current?.querySelector("textarea")?.focus();
  }, [open]);

  return (
    <div className="assistant-widget">
      <div
        aria-hidden={!open}
        aria-label="Assistant"
        className={`assistant-widget-panel ${open ? "open" : ""}`}
        inert={!open}
        ref={panelRef}
        role="dialog"
      >
        <div className="assistant-widget-head">
          <div>
            <b>Assistant</b>
            <small>Chat help for daily operations</small>
          </div>
          <button
            aria-label="Close the assistant"
            className="assistant-widget-close"
            onClick={() => {
              setOpen(false);
              launcherRef.current?.focus();
            }}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <div className="assistant-widget-body">
          <AssistantPanel businessId={businessId} previewMode={previewMode} />
        </div>
      </div>
      <button
        aria-expanded={open}
        aria-label={open ? "Close the assistant" : "Open the assistant"}
        className={`assistant-widget-launcher ${open ? "open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        ref={launcherRef}
        type="button"
      >
        {open ? <X size={24} /> : <Bot size={26} />}
      </button>
    </div>
  );
}
