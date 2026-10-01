"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, Printer, Share2, X } from "lucide-react";

import { overlayDismiss } from "@/lib/overlay-dismiss";

export type PdfPreviewFile = {
  blob: Blob;
  fileName: string;
  title: string;
};

type PdfPreviewProps = PdfPreviewFile & {
  onClose: () => void;
};

/**
 * Every paper the console makes - an invoice, a month's bill, a month's
 * summary - opens here first: read it, then print it, download it, or hand it
 * to the share sheet. Going straight to a download meant nobody could check
 * a bill before it reached a customer.
 */
export function PdfPreview({ blob, fileName, title, onClose }: PdfPreviewProps) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [note, setNote] = useState("");
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const file = useMemo(() => new File([blob], fileName, { type: "application/pdf" }), [blob, fileName]);
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { canShare?: (d: ShareData) => boolean });
  const canShare = Boolean(nav?.share && nav?.canShare && nav.canShare({ files: [file] }));

  function print() {
    try {
      frameRef.current?.contentWindow?.focus();
      frameRef.current?.contentWindow?.print();
    } catch {
      // Some browsers will not print a PDF frame; the new tab always can.
      window.open(url, "_blank", "noopener");
    }
  }

  function download() {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setNote("Saved to your downloads.");
  }

  async function share() {
    try {
      await nav?.share?.({ files: [file], title: fileName });
    } catch (error) {
      if ((error as { name?: string })?.name !== "AbortError") setNote("Sharing is not available here. Download it instead.");
    }
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" aria-label={title} {...overlayDismiss(onClose)}>
      <div className="lst-modal pdf-preview" onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div><h3>{title}</h3><p>{fileName}</p></div>
          <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="pdf-preview-body">
          <iframe ref={frameRef} src={url} title={title} />
        </div>
        <footer className="lst-modal-foot">
          {note && <span className="lst-hint" role="status" style={{ marginRight: "auto" }}>{note}</span>}
          <a className="lst-btn ghost" href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Open in a new tab</a>
          <button className="lst-btn ghost" type="button" onClick={print}><Printer size={15} /> Print</button>
          <button className="lst-btn ghost" type="button" onClick={download}><Download size={15} /> Download</button>
          {canShare && <button className="lst-add" type="button" onClick={() => void share()}><Share2 size={15} /> Share</button>}
        </footer>
      </div>
    </div>
  );
}
