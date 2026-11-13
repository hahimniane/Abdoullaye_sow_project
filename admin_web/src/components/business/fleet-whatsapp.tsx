"use client";

// Fleet drivers on WhatsApp (docs/FLEET.md §9): off until a Fleet admin
// sends a test to their own phone and switches it on. Then drivers get a
// receipt for each payment and rent reminders with the exact Zelle amount.
// "Only chosen drivers" limits it to a few drivers: a test or a pilot.

import { useMemo, useState } from "react";
import { MessageCircle, X } from "lucide-react";

import { Panel } from "@/components/panel";
import type { FleetSettingsView } from "@/lib/fleet";

import { fleetLang, SaveButton, useFleetRun } from "./fleet-ui";

type TestAnswer = { receipt?: string; reminder?: string };
type SaveAnswer = { enabled?: boolean; onlyDriverIds?: string[] };

/** An active driver who can be picked for messages. */
export type WhatsAppDriver = { id: string; name: string; hasPhone: boolean };

export function FleetWhatsAppPanel({
  businessId,
  settings,
  drivers,
}: {
  businessId: string;
  settings: FleetSettingsView;
  drivers: WhatsAppDriver[];
}) {
  const [enabled, setEnabled] = useState(settings.whatsappEnabled);
  const [savedOnly, setSavedOnly] = useState<string[]>(settings.whatsappOnlyDriverIds);
  const [only, setOnly] = useState<string[]>(settings.whatsappOnlyDriverIds);
  const [mode, setMode] = useState<"all" | "some">(settings.whatsappOnlyDriverIds.length ? "some" : "all");
  const [phone, setPhone] = useState("");
  const [testResult, setTestResult] = useState("");
  const { busy, error, run } = useFleetRun(businessId);

  const byId = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
  const withPhone = useMemo(() => drivers.filter((d) => d.hasPhone).length, [drivers]);
  const pickable = useMemo(
    () => drivers.filter((d) => d.hasPhone && !only.includes(d.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [drivers, only],
  );
  const audience = mode === "some" ? only : [];
  const audienceChanged = audience.join("|") !== savedOnly.join("|");
  const canTurnOn = mode === "all" || only.length > 0;

  async function sendTest() {
    setTestResult("");
    const answer = await run<TestAnswer>("whatsapp_test", { phone });
    if (!answer) return;
    const ok = answer.receipt === "sent" && answer.reminder === "sent";
    setTestResult(
      ok
        ? "Two test messages were sent: a receipt and a reminder. Check WhatsApp on that phone."
        : "The test could not be sent. If these messages are new, Meta may still be reviewing them: try again later.",
    );
  }

  function saved(answer: SaveAnswer | null, next: boolean) {
    if (!answer) return;
    setEnabled(next);
    const list = Array.isArray(answer.onlyDriverIds) ? answer.onlyDriverIds : audience;
    setSavedOnly(list);
    setOnly(list);
    setMode(list.length ? "some" : "all");
  }

  async function toggle(next: boolean) {
    const count = mode === "some" ? only.length : withPhone;
    const answer = await run<SaveAnswer>(
      "whatsapp_save",
      { enabled: next, onlyDriverIds: audience },
      next
        ? mode === "some"
          ? {
              en: `Turn on WhatsApp for ${count} chosen driver(s) only? No other driver gets a message.`,
              fr: `Activer WhatsApp pour ${count} chauffeur(s) choisi(s) seulement ? Aucun autre chauffeur ne reçoit de message.`,
            }
          : {
              en: `Turn on WhatsApp to drivers? From now on the ${count} active drivers with a phone get a receipt for each payment and reminders before and after rent is due.`,
              fr: `Activer WhatsApp pour les chauffeurs ? Dès maintenant, les ${count} chauffeurs actifs avec un téléphone reçoivent un reçu pour chaque paiement et des rappels avant et après l’échéance du loyer.`,
            }
        : {
            en: "Turn off WhatsApp to drivers? No more receipts or reminders are sent.",
            fr: "Désactiver WhatsApp pour les chauffeurs ? Plus aucun reçu ni rappel n’est envoyé.",
          },
    );
    saved(answer, next);
  }

  async function saveAudience() {
    const answer = await run<SaveAnswer>(
      "whatsapp_save",
      { enabled: true, onlyDriverIds: audience },
      mode === "some"
        ? {
            en: `Send WhatsApp to ${only.length} chosen driver(s) only?`,
            fr: `Envoyer WhatsApp à ${only.length} chauffeur(s) choisi(s) seulement ?`,
          }
        : {
            en: `Send WhatsApp to all ${withPhone} active drivers with a phone?`,
            fr: `Envoyer WhatsApp aux ${withPhone} chauffeurs actifs avec un téléphone ?`,
          },
    );
    saved(answer, true);
  }

  // The chosen-drivers line has a number in it, so it carries its own French.
  const chosenText =
    fleetLang() === "fr"
      ? `Activé pour ${savedOnly.length} chauffeur(s) choisi(s) seulement.`
      : `On for ${savedOnly.length} chosen driver(s) only.`;
  const chosen = enabled && savedOnly.length > 0;
  const stateText = !enabled
    ? "Off: no message is sent to drivers."
    : chosen
      ? chosenText
      : "On: drivers get receipts and reminders.";

  return (
    <Panel title="WhatsApp to drivers" icon={<MessageCircle size={18} />}>
      <p className="lst-hint">
        Drivers get, on WhatsApp, in English and French: a receipt each time a payment is recorded, and a reminder 2 days before rent is due, on the due day, 3 days after if still unpaid, then every week. Each reminder says how to pay by Zelle and the exact amount to send, with the driver&apos;s cents.
      </p>
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      <div className={`fleet-wa-state${enabled ? " on" : ""}`} role="status">
        {chosen ? <strong data-no-translate>{stateText}</strong> : <strong>{stateText}</strong>}
        {!enabled && <small>Send yourself a test first, then turn it on.</small>}
      </div>

      <fieldset className="fleet-wa-who" disabled={busy}>
        <legend>Who gets messages</legend>
        <label className="fleet-wa-choice">
          <input type="radio" name="fleet-wa-who" checked={mode === "all"} onChange={() => setMode("all")} />
          <span>All active drivers with a phone</span>
        </label>
        <label className="fleet-wa-choice">
          <input type="radio" name="fleet-wa-who" checked={mode === "some"} onChange={() => setMode("some")} />
          <span>Only chosen drivers (a test or a pilot)</span>
        </label>
        {mode === "some" && (
          <div className="fleet-wa-picked">
            {only.length === 0 && <small className="lst-hint">Pick at least one driver.</small>}
            <ul className="fleet-wa-chips">
              {only.map((id) => (
                <li key={id} className="fleet-wa-chip">
                  <span data-no-translate>{byId.get(id)?.name || id}</span>
                  <button type="button" aria-label="Remove this driver" title="Remove this driver" onClick={() => setOnly(only.filter((x) => x !== id))}>
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
            <label className="lst-field">
              <span>Add to the list</span>
              <select
                value=""
                onChange={({ target: { value: picked } }) => {
                  if (picked) setOnly([...only, picked]);
                }}
              >
                <option value="">Choose a driver...</option>
                {pickable.map((d) => (
                  <option key={d.id} value={d.id} data-no-translate>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {enabled && audienceChanged && (
          <div className="fleet-actions">
            <SaveButton busy={busy} label="Save who gets messages" busyLabel="Saving..." onClick={() => void saveAudience()} disabled={!canTurnOn} />
          </div>
        )}
      </fieldset>

      <div className="lst-form-grid">
        <label className="lst-field">
          <span>Your phone for a test</span>
          <input
            data-no-translate
            disabled={busy}
            inputMode="tel"
            placeholder="+1 718 555 0100"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
      </div>
      {testResult && <p className="fleet-saved" role="status">{testResult}</p>}
      <div className="fleet-actions">
        <SaveButton busy={busy} label="Send a test" busyLabel="Sending..." onClick={() => void sendTest()} disabled={phone.replace(/\D/g, "").length < 10} />
        {enabled ? (
          <SaveButton busy={busy} label="Turn off WhatsApp to drivers" busyLabel="Saving..." onClick={() => void toggle(false)} danger />
        ) : (
          <SaveButton busy={busy} label="Turn on WhatsApp to drivers" busyLabel="Saving..." onClick={() => void toggle(true)} disabled={!canTurnOn} />
        )}
      </div>
    </Panel>
  );
}

type RemindAnswer = { status?: string };

/**
 * "Send a WhatsApp reminder" on a driver's page: shown when WhatsApp is on
 * for this driver and they owe money. The server sends it once a day per bill.
 */
export function FleetRemindButton({
  businessId,
  settings,
  driverId,
  active,
  owedCents,
}: {
  businessId: string;
  settings: FleetSettingsView;
  driverId: string;
  active: boolean;
  owedCents: number;
}) {
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const { busy, error, run } = useFleetRun(businessId);
  const only = settings.whatsappOnlyDriverIds;
  const allowed = settings.whatsappEnabled && (only.length === 0 || only.includes(driverId));
  if (!allowed || !active || !(owedCents > 0)) return null;

  async function send() {
    setResult(null);
    const answer = await run<RemindAnswer>("whatsapp_remind_driver", { driverId }, {
      en: "Send this driver a WhatsApp reminder now, with the amount owed and how to pay by Zelle?",
      fr: "Envoyer maintenant à ce chauffeur un rappel WhatsApp, avec le montant dû et comment payer par Zelle ?",
    });
    if (!answer) return;
    const status = answer.status ?? "";
    setResult(
      status === "sent"
        ? { text: "Reminder sent on WhatsApp.", ok: true }
        : status === ""
          ? { text: "A reminder was already sent today for this bill.", ok: true }
          : status === "skipped"
            ? { text: "No WhatsApp number on file for this driver.", ok: false }
            : { text: "The reminder could not be sent. Check the driver's phone number.", ok: false },
    );
  }

  return (
    <>
      <SaveButton busy={busy} label="Send a WhatsApp reminder" busyLabel="Sending..." onClick={() => void send()} />
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      {result &&
        (result.ok ? (
          <p className="fleet-saved" role="status">{result.text}</p>
        ) : (
          <div className="lst-form-error" role="alert">{result.text}</div>
        ))}
    </>
  );
}
