"use client";

import { useEffect, useRef } from "react";
import { Copy } from "lucide-react";

import type { useLabelPrinter } from "@/components/business/use-label-printer";

type Printer = ReturnType<typeof useLabelPrinter>;

/**
 * Which label printer the person has: the Phomemo PM-241 (the tested path) or
 * "Other 4x6 Bluetooth printer (beta)". The choice is remembered in this
 * browser by the hook.
 */
export function LabelPrinterKindPicker({ printer }: { printer: Printer }) {
  return (
    <div role="radiogroup" aria-label="Printer type" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label className="lst-radio"><input type="radio" name="ctnprinterkind" checked={printer.kind === "pm241"} disabled={printer.busy} onChange={() => printer.setKind("pm241")} /><span>Phomemo PM-241</span></label>
      <label className="lst-radio"><input type="radio" name="ctnprinterkind" checked={printer.kind === "generic"} disabled={printer.busy} onChange={() => printer.setKind("generic")} /><span>Other 4×6 Bluetooth printer (beta)</span></label>
    </div>
  );
}

/**
 * The beta printer's notes, the "Copy printer details" button and the visible
 * details box (the fallback when the clipboard is blocked, and what a failed
 * print shows straight away).
 */
export function GenericPrinterBeta({ printer }: { printer: Printer }) {
  const box = useRef<HTMLTextAreaElement>(null);
  // When the clipboard was refused, select the text so one keystroke copies it.
  useEffect(() => {
    if (printer.copy === "manual") box.current?.select();
  }, [printer.copy]);
  const failed = printer.state.phase === "failed";
  return (
    <>
      <p className="lst-hint" style={{ margin: 0 }}>Beta: this may not work with every printer, and it cannot tell us that a label came out. It needs Chrome on Mac, Windows or Android (not Safari on iPhone).</p>
      <p className="lst-hint" style={{ margin: 0 }}>If a label does not print, copy the printer details and send them to Laawol.</p>
      <div>
        <button className="lst-btn ghost" type="button" disabled={printer.busy} onClick={printer.copyDetails}>
          <Copy size={16} />
          Copy printer details
        </button>
      </div>
      {printer.copy === "copied" && <p className="lst-hint" role="status" style={{ margin: 0 }}>Printer details copied. Send them to Laawol.</p>}
      {printer.copy === "manual" && <p className="lst-hint" role="status" style={{ margin: 0 }}>Could not copy automatically. Select the text below and copy it.</p>}
      {printer.copy === "empty" && <p className="lst-hint" role="status" style={{ margin: 0 }}>Nothing to copy yet. Try printing a label first, then copy the details.</p>}
      {failed && printer.details && <p className="lst-hint" role="status" style={{ margin: 0 }}>The label did not print. Copy the details below and send them to Laawol so we can support your printer.</p>}
      {printer.details && (
        <textarea
          ref={box}
          className="lst-input"
          readOnly
          rows={8}
          value={printer.details}
          aria-label="Printer details"
          data-no-translate
          onFocus={(event) => event.currentTarget.select()}
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}
        />
      )}
    </>
  );
}
