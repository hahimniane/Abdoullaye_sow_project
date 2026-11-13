"use client";

// Fleet drivers on WhatsApp (docs/FLEET.md §9): off until a Fleet admin
// sends a test to their own phone and switches it on. Then drivers get a
// receipt for each payment and rent reminders with the exact Zelle amount.

import { useState } from "react";
import { MessageCircle } from "lucide-react";

import { Panel } from "@/components/panel";
import type { FleetSettingsView } from "@/lib/fleet";

import { SaveButton, useFleetRun } from "./fleet-ui";

type TestAnswer = { receipt?: string; reminder?: string };

export function FleetWhatsAppPanel({
  businessId,
  settings,
  driversWithPhone,
}: {
  businessId: string;
  settings: FleetSettingsView;
  driversWithPhone: number;
}) {
  const [enabled, setEnabled] = useState(settings.whatsappEnabled);
  const [phone, setPhone] = useState("");
  const [testResult, setTestResult] = useState("");
  const { busy, error, run } = useFleetRun(businessId);

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

  async function toggle(next: boolean) {
    const answer = await run(
      "whatsapp_save",
      { enabled: next },
      next
        ? {
            en: `Turn on WhatsApp to drivers? From now on the ${driversWithPhone} active drivers with a phone get a receipt for each payment and reminders before and after rent is due.`,
            fr: `Activer WhatsApp pour les chauffeurs ? Dès maintenant, les ${driversWithPhone} chauffeurs actifs avec un téléphone reçoivent un reçu pour chaque paiement et des rappels avant et après l’échéance du loyer.`,
          }
        : {
            en: "Turn off WhatsApp to drivers? No more receipts or reminders are sent.",
            fr: "Désactiver WhatsApp pour les chauffeurs ? Plus aucun reçu ni rappel n’est envoyé.",
          },
    );
    if (answer) setEnabled(next);
  }

  return (
    <Panel title="WhatsApp to drivers" icon={<MessageCircle size={18} />}>
      <p className="lst-hint">
        Drivers get, on WhatsApp, in English and French: a receipt each time a payment is recorded, and a reminder 2 days before rent is due, on the due day, 3 days after if still unpaid, then every week. Each reminder says how to pay by Zelle and the exact amount to send, with the driver&apos;s cents.
      </p>
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      <div className={`fleet-wa-state${enabled ? " on" : ""}`} role="status">
        <strong>{enabled ? "On: drivers get receipts and reminders." : "Off: no message is sent to drivers."}</strong>
        {!enabled && <small>Send yourself a test first, then turn it on.</small>}
      </div>
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
          <SaveButton busy={busy} label="Turn on WhatsApp to drivers" busyLabel="Saving..." onClick={() => void toggle(true)} />
        )}
      </div>
    </Panel>
  );
}
