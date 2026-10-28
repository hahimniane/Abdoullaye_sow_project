"use client";

import { X } from "lucide-react";
import { useEffect } from "react";

import { overlayDismiss } from "@/lib/overlay-dismiss";

/** "The menu has a new layout": what moved where, once per person and browser. */
export function MenuMovedDialog({
  lines,
  canOpenShipping,
  onClose,
  onOpenShipping,
}: {
  lines: readonly string[];
  canOpenShipping: boolean;
  onClose: () => void;
  onOpenShipping: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div aria-labelledby="menu-moved-title" aria-modal="true" className="lst-modal-overlay" role="dialog" {...overlayDismiss(onClose)}>
      <div className="lst-modal menu-moved" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 520 }}>
        <header className="lst-modal-head">
          <div>
            <h3 id="menu-moved-title">The menu has a new layout</h3>
            <p>Everything is still here, grouped by the work you do.</p>
          </div>
          <button aria-label="Close" className="lst-icon-btn" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <div className="lst-modal-body">
          <ul className="menu-moved-list">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="menu-moved-tip">Can&apos;t find something? Type its old name in the search box above the menu.</p>
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" onClick={onClose} type="button">Got it</button>
          {canOpenShipping && (
            <button className="lst-btn" onClick={onOpenShipping} type="button">Show me Shipping</button>
          )}
        </footer>
      </div>
    </div>
  );
}
