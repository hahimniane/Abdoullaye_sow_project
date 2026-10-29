"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { PackageCheck, Plane, Search, Ship } from "lucide-react";

import { MarkDeliveredDialog, useProofPickupCode } from "@/components/business/package-delivery";
import { PackageStaffView } from "@/components/package-staff-view";
import {
  arrivedContainerRows,
  deliveryAccess,
  deliveryBalanceCents,
  deliveryCodeFrom,
  pickupCodeAsked,
  type ArrivedLineRow,
} from "@/lib/container-delivery";
import { db } from "@/lib/firebase";
import { currentLanguage, text } from "@/lib/format";
import { guestPiecesText } from "@/lib/guest-tracking";
import { groupForLine } from "@/lib/waiting-packages";
import type { UserProfile } from "@/types/admin";

type Row = Record<string, unknown>;

// How long the arrivals list waits for Firestore before saying it is empty.
const LOAD_TIMEOUT_MS = 8000;

/**
 * Deliveries: destination staff find a package by the code on its label
 * (typed, pasted, or read by a scanner that types the label's link) and hand
 * it over - what it is, who sends it and who collects it, where its
 * container stands, and Mark delivered. The package itself is the staff view
 * of the tracking page (PackageStaffView), the one place that reads a line
 * by its code; a person with only the Deliveries permission sees no prices,
 * payments or balances there. Scanning the label's QR with a phone opens the
 * same view on the tracking page.
 *
 * Below the code box, what arrived and is still to hand over
 * (docs/AIR_PACKAGES.md §5): every container of the business marked ready
 * for pickup - a flight or a sea container - with its undelivered packages,
 * each with the same Mark delivered dialog. Two business-scoped listeners
 * (equality filters only, no composite index), rows precomputed once per
 * snapshot.
 */
export function DeliveriesPanel({
  firebaseUser,
  profile,
  previewMode = false,
}: {
  firebaseUser: User | null | undefined;
  profile: UserProfile;
  previewMode?: boolean;
}) {
  const [typed, setTyped] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const businessId = text(profile.businessId, "");
  const access = useMemo(() => deliveryAccess(profile), [profile]);
  const pickupCodeOn = useProofPickupCode(previewMode ? "" : businessId);
  const lang = currentLanguage() === "fr" ? "fr" : "en";

  function find(event: FormEvent) {
    event.preventDefault();
    const next = deliveryCodeFrom(typed);
    if (!next) {
      setError("That is not a package code. Codes look like CL-K7M4P2.");
      return;
    }
    setError("");
    setTyped(next);
    setCode(next);
  }

  // Arrived containers and the lines on them, live.
  const [containers, setContainers] = useState<Row[] | null>(null);
  const [lines, setLines] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!businessId || previewMode) return undefined;
    // Loading states always resolve: an unanswered listener reads as empty.
    const timer = window.setTimeout(() => {
      setContainers((current) => current ?? []);
      setLines((current) => current ?? []);
    }, LOAD_TIMEOUT_MS);
    const stopContainers = onSnapshot(
      query(collection(db, "containers"), where("businessId", "==", businessId), where("status", "==", "arrived")),
      (snap) => setContainers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setContainers([]),
    );
    const stopLines = onSnapshot(
      query(collection(db, "containerLines"), where("businessId", "==", businessId), where("containerStatus", "==", "arrived")),
      (snap) => setLines(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setLines([]),
    );
    return () => {
      window.clearTimeout(timer);
      stopContainers();
      stopLines();
    };
  }, [businessId, previewMode]);
  const arrived = useMemo(() => arrivedContainerRows(containers ?? [], lines ?? []), [containers, lines]);
  const loaded = containers !== null && lines !== null;
  const [delivering, setDelivering] = useState<ArrivedLineRow | null>(null);
  const [notice, setNotice] = useState("");

  return (
    <div className="dlv-panel">
      <article className="panel">
        <div className="panel-header">
          <div><PackageCheck size={18} /><h2>Deliveries</h2></div>
        </div>
        <p className="panel-lede">
          Find a package by the code on its label, check who collects it, and mark it delivered.
        </p>
        <form className="dlv-find" onSubmit={find}>
          <label className="lst-field">
            <span>Package code</span>
            <input
              autoCapitalize="characters"
              autoComplete="off"
              autoFocus
              data-no-translate
              disabled={previewMode}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="CL-K7M4P2"
              spellCheck={false}
              value={typed}
            />
          </label>
          <button className="lst-btn" disabled={previewMode || !typed.trim()} type="submit">
            <Search size={14} /> Find package
          </button>
        </form>
        {error && <div className="lst-form-error" role="alert">{error}</div>}
        <p className="lst-hint dlv-hint">You can also scan the label&apos;s QR code with your phone camera.</p>
      </article>
      {code && !previewMode && (
        <PackageStaffView code={code} embedded firebaseUser={firebaseUser} profile={profile} />
      )}
      {!previewMode && businessId && (
        <article className="panel dlv-arrived">
          <div className="panel-header">
            <div><PackageCheck size={18} /><h2>Arrived · to hand over</h2></div>
            {loaded && <span className="status-pill muted" data-no-translate>{arrived.reduce((n, box) => n + box.lines.length, 0)}</span>}
          </div>
          <p className="panel-lede">Every shipment ready for pickup and the packages still on it.</p>
          {notice && (
            <p className="dlv-notice" role="status">
              {notice}{" "}
              <button className="ghost-button" type="button" onClick={() => setNotice("")}>Dismiss</button>
            </p>
          )}
          {!loaded ? (
            <p className="lst-hint dlv-hint">Loading…</p>
          ) : arrived.length === 0 ? (
            <p className="lst-hint dlv-hint">Nothing is waiting to be handed over.</p>
          ) : (
            <div className="dlv-arrived-list">
              {arrived.map((box) => (
                <section className="dlv-arrived-box" key={box.id}>
                  <h3>
                    {box.air ? <Plane aria-hidden="true" size={15} /> : <Ship aria-hidden="true" size={15} />}{" "}
                    <span>{box.air ? "Shipment" : "Container"}</span> <b data-no-translate>{box.title}</b>{" "}
                    <small data-no-translate>· {box.lines.length}</small>
                  </h3>
                  <ul>
                    {box.lines.map((row) => (
                      <li key={row.id}>
                        <code className="ctn-code" data-no-translate>{row.trackingCode}</code>
                        <span className="dlv-arrived-who">
                          <b data-no-translate>{row.receiverName || "—"}</b>
                          {row.receiverPhone && <small data-no-translate>{row.receiverPhone}</small>}
                        </span>
                        <small data-no-translate>{guestPiecesText(row.pieceCount, lang)}</small>
                        {access.canDeliver && (
                          <button className="lst-btn ghost" type="button" onClick={() => { setNotice(""); setDelivering(row); }}>
                            <PackageCheck size={14} /> Mark delivered
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </article>
      )}
      {delivering && (
        <MarkDeliveredDialog
          askPickupCode={pickupCodeAsked({ pickupCode: pickupCodeOn === true }, delivering.line)}
          balanceCents={deliveryBalanceCents(groupForLine(null, delivering.line))}
          businessId={businessId}
          canSeeMoney={access.canSeeMoney}
          line={delivering.line}
          onClose={() => setDelivering(null)}
          onDone={setNotice}
        />
      )}
    </div>
  );
}
