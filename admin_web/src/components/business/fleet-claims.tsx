"use client";

// Fleet payments: "Reported by drivers, waiting for the bank"
// (docs/FLEET_PAYMENT_PROOF.md, Office). A driver's WhatsApp screenshot is only
// a claim; the bank deposit is the proof. Each open claim shows who, how much,
// when, what it waits for, its photo, and two office actions: "This deposit is
// theirs" (hand it a waiting deposit) and "Close". The list is built once per
// snapshot in lib/fleet-claims.ts.

import { useMemo, useState } from "react";
import { MessageSquareText, RefreshCw } from "lucide-react";
import { getDownloadURL, ref as storageRef } from "firebase/storage";

import { Panel } from "@/components/panel";
import { AttachmentPreview } from "@/components/support/attachment-preview";
import { formatDateTime } from "@/lib/format";
import { storage } from "@/lib/firebase";
import { depositsForClaim, openClaimViews, type ClaimView } from "@/lib/fleet-claims";
import { moneyText } from "@/lib/invoice-ledger";

import type { useFleetBank } from "./fleet-bank";
import { useFleetClaims, type FleetState } from "./fleet-data";
import { fleetLang, SaveButton, useFleetRun } from "./fleet-ui";

/** "View photo": the stored screenshot is fetched on click (never in bulk) and shown in the row. */
function ClaimPhoto({ path }: { path: string }) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "gone">("idle");
  if (!path) return <span className="lst-hint">No photo</span>;
  if (url) return <AttachmentPreview fileName="Payment screenshot" fileUrl={url} isImage />;
  if (state === "gone") return <span className="wa-media-gone">Photo not available</span>;
  async function open() {
    setState("loading");
    try {
      // A stored path, opened like the Fleet notes' files; a full link is used as given.
      const link = /^https?:\/\//i.test(path) ? path : await getDownloadURL(storageRef(storage, path));
      setUrl(link);
    } catch {
      setState("gone");
    }
  }
  return (
    <button className="ghost-button compact" type="button" disabled={state === "loading"} aria-busy={state === "loading"} onClick={() => void open()}>
      {state === "loading" && <RefreshCw className="spin" size={12} aria-hidden="true" />} View photo
    </button>
  );
}

export function FleetClaimsPanel({ businessId, state, bank }: { businessId: string; state: FleetState; bank: ReturnType<typeof useFleetBank> }) {
  const lang = fleetLang();
  const claims = useFleetClaims(businessId, true);
  const { busy, error, setError, run } = useFleetRun(businessId);
  const [flash, setFlash] = useState("");
  const [openId, setOpenId] = useState("");
  const [pickedDeposit, setPickedDeposit] = useState("");

  const driverNames = useMemo(
    () => new Map(state.data.drivers.map((d) => [String(d.id), String(d.name ?? "") || String(d.phone ?? "")])),
    [state.data.drivers],
  );
  const views = useMemo(() => openClaimViews(claims.rows, driverNames), [claims.rows, driverNames]);
  const waiting = bank.status?.waiting ?? [];

  async function assign(view: ClaimView) {
    const deposit = waiting.find((w) => w.id === pickedDeposit);
    if (!deposit) {
      setError("Pick the deposit that is theirs.");
      return;
    }
    setFlash("");
    const money = (l: "en" | "fr") => moneyText(deposit.amountCents, l);
    const result = await run("claim_assign", { claimId: view.id, creditId: deposit.id }, {
      en: `Give this ${money("en")} deposit from ${deposit.senderName || "an unknown sender"} to ${view.who}? It pays their bills, and their next deposits from the same sender are paid by themselves.`,
      fr: `Donner ce dépôt de ${money("fr")} de ${deposit.senderName || "un expéditeur inconnu"} à ${view.who} ? Il paie ses factures, et ses prochains dépôts du même expéditeur seront payés automatiquement.`,
    });
    if (result) {
      setFlash("Payment recorded.");
      setOpenId("");
      setPickedDeposit("");
      bank.reload();
    }
  }

  async function close(view: ClaimView) {
    setFlash("");
    const result = await run("claim_close", { claimId: view.id }, {
      en: `Close this report from ${view.who}? The bill stays unpaid and nothing is recorded.`,
      fr: `Fermer ce signalement de ${view.who} ? La facture reste impayée et rien n’est enregistré.`,
    });
    if (result) {
      setFlash("Report closed.");
      if (openId === view.id) setOpenId("");
    }
  }

  return (
    <Panel title="Reported by drivers, waiting for the bank" icon={<MessageSquareText size={18} />}>
      <p className="lst-hint">A driver sent a payment screenshot on WhatsApp. Nobody is marked paid from a picture: the deposit in the bank is the proof.</p>
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      {flash && <p className="fleet-saved" role="status">{flash}</p>}
      {claims.loading && views.length === 0 ? (
        <p className="lst-hint" role="status"><RefreshCw className="spin" size={12} aria-hidden="true" /> Loading…</p>
      ) : claims.error && views.length === 0 ? (
        <p className="lst-hint" role="alert">The reported payments could not be loaded. Refresh in a moment.</p>
      ) : views.length === 0 ? (
        <p className="empty-state">No payment reported by a driver is waiting.</p>
      ) : (
        <ul className="fleet-bank-waiting">
          {views.map((v) => {
            const picking = openId === v.id;
            const offers = picking ? depositsForClaim(v.amountCents, waiting) : [];
            const chosen = picking ? offers.find((o) => o.deposit.id === pickedDeposit) : undefined;
            return (
              <li key={v.id} className="fleet-claim">
                <div className="fleet-bank-deposit">
                  <strong data-no-translate>{v.amountCents === null ? "—" : moneyText(v.amountCents, lang)}</strong>
                  <span data-no-translate>{v.who}</span>
                  <small data-no-translate>{v.atMs > 0 ? formatDateTime(v.atMs) : ""}</small>
                  <small>{v.sentence}</small>
                  <ClaimPhoto path={v.mediaPath} />
                </div>
                <div className="fleet-bank-assign">
                  {picking ? (
                    <>
                      <label className="lst-field">
                        <span className="sr-only">Deposit that is theirs</span>
                        <select disabled={busy} value={pickedDeposit} aria-label="Deposit that is theirs" onChange={(e) => setPickedDeposit(e.target.value)}>
                          <option value="">{offers.length ? "Pick the deposit…" : "No deposit is waiting"}</option>
                          {offers.map(({ deposit, sameAmount }) => (
                            <option key={deposit.id} value={deposit.id} data-no-translate>
                              {[moneyText(deposit.amountCents, lang), deposit.senderName || "—", deposit.atMs > 0 ? formatDateTime(deposit.atMs) : deposit.dateKey, sameAmount ? "=" : ""].filter(Boolean).join(" · ")}
                            </option>
                          ))}
                        </select>
                      </label>
                      {chosen && !chosen.sameAmount && v.amountCents !== null && (
                        <small className="lst-hint">This deposit is for a different amount. The bank&apos;s amount is what is recorded.</small>
                      )}
                      <SaveButton busy={busy} label="Give this deposit" busyLabel="Recording..." onClick={() => void assign(v)} disabled={!pickedDeposit} />
                      <button className="ghost-button compact" type="button" disabled={busy} onClick={() => { setOpenId(""); setPickedDeposit(""); }}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className="ghost-button compact" type="button" disabled={busy} onClick={() => { setError(""); setOpenId(v.id); setPickedDeposit(""); }}>This deposit is theirs</button>
                      <button className="ghost-button compact" type="button" disabled={busy} onClick={() => void close(v)}>Close</button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
