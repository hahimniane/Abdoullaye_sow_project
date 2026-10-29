"use client";

import { useEffect, useState } from "react";
import { getDownloadURL, ref } from "firebase/storage";
import { AlertTriangle, Camera, Check, PackageCheck, RefreshCw } from "lucide-react";

import { MessageCustomerButton } from "@/components/support/message-customer";
import { storage } from "@/lib/firebase";
import { currentLanguage, text } from "@/lib/format";
import { proofTickLabels, proofTicks, senderConfirmationOf, type ProofTicks as ProofTickState } from "@/lib/package-proof";

type Row = Record<string, unknown>;

/**
 * The three ticks a package shows (docs/AIR_PACKAGES.md decision 11):
 * drop-off photo · sender OK · delivered. Compact, with the words in a
 * tooltip, on the Waiting rows, the container lines and the staff view.
 * Grey is "not yet"; the sender's tick is amber while asked, green when
 * confirmed, red when they reported a problem; a delivery without the
 * pickup code reads as such.
 *
 * `ticks` lets a list that already computed them pass them in; otherwise
 * they are read from the line once per render of this row.
 */
export function ProofTicks({ line, ticks }: { line: Row; ticks?: ProofTickState }) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const state = ticks ?? proofTicks(line);
  const labels = proofTickLabels(state, lang);
  const sender = state.senderOk;
  return (
    <span className="prf-ticks" data-no-translate role="group" aria-label={lang === "fr" ? "Preuves" : "Proof"}>
      <span className={`prf-tick${state.photo ? " on" : ""}`} title={labels.photo} aria-label={labels.photo} role="img">
        <Camera size={12} aria-hidden="true" />
      </span>
      <span className={`prf-tick prf-sender-${sender}`} title={labels.sender} aria-label={labels.sender} role="img">
        {sender === "problem" ? <AlertTriangle size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
      </span>
      <span
        className={`prf-tick${state.delivered ? (state.deliveredWithoutCode ? " on without-code" : " on") : ""}`}
        title={labels.delivered}
        aria-label={labels.delivered}
        role="img"
      >
        <PackageCheck size={12} aria-hidden="true" />
        {state.deliveredWithoutCode && <span className="prf-tick-note">{lang === "fr" ? "sans code" : "no code"}</span>}
      </span>
    </span>
  );
}

/**
 * "Sender reported a problem": the red flag on a line whose sender tapped
 * Something's wrong, with the note WhatsApp carried (if any) and the way
 * into the conversation that opened with it (Support).
 * `compact` is the list rows' one-liner; the staff view shows the banner.
 */
export function SenderProblemBanner({ line, compact = false }: { line: Row; compact?: boolean }) {
  const confirmation = senderConfirmationOf(line);
  if (confirmation.status !== "problem") return null;
  const note = text(confirmation.note, "");
  if (compact) {
    return (
      <small className="prf-problem prf-problem-compact" role="status">
        <AlertTriangle size={11} aria-hidden="true" /> <span>Sender reported a problem</span>
        <MessageCustomerButton row={line} label="Open conversation" />
      </small>
    );
  }
  return (
    <div className="prf-problem" role="alert">
      <AlertTriangle size={16} aria-hidden="true" />
      <div>
        <strong>Sender reported a problem</strong>
        {note && <p data-no-translate>{note}</p>}
        <p>The sender tapped Something&apos;s wrong on the confirmation message. Loading this package warns but never blocks.</p>
        <MessageCustomerButton row={line} label="Open conversation" />
      </div>
    </div>
  );
}

/** Download URLs for Storage paths, each as it arrives; a path that fails stays absent. */
export function useStoragePhotoUrls(paths: readonly string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join("|");
  useEffect(() => {
    let active = true;
    for (const path of key ? key.split("|") : []) {
      getDownloadURL(ref(storage, path))
        .then((url) => {
          if (active) setUrls((current) => (current[path] === url ? current : { ...current, [path]: url }));
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [key]);
  return urls;
}

/**
 * The photos on a line, read-only: the drop-off photos staff took (or the
 * server copied from the request or WhatsApp), each opening full size.
 */
export function ProofPhotoThumbs({ paths, alt = "Photo of the package" }: { paths: readonly string[]; alt?: string }) {
  const urls = useStoragePhotoUrls(paths);
  if (paths.length === 0) return null;
  return (
    <span className="pkq-photos prf-photos">
      {paths.map((path) =>
        urls[path] ? (
          <a href={urls[path]} key={path} rel="noopener noreferrer" target="_blank">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={alt} src={urls[path]} />
          </a>
        ) : (
          <span className="pkq-photo-wait" key={path}><RefreshCw className="spin" size={12} aria-hidden="true" /></span>
        ),
      )}
    </span>
  );
}
