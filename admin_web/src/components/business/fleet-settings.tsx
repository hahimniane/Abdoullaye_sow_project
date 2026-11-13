"use client";

import { useState } from "react";
import { FileUp, Settings } from "lucide-react";

import { Panel } from "@/components/panel";
import {
  centsToInput,
  dollarsToCents,
  fleetErrorMessage,
  parseCsv,
  readImportPreview,
  type FleetSettingsView,
  type ImportPreview,
} from "@/lib/fleet";
import { moneyText } from "@/lib/invoice-ledger";

import { FleetBankSchedule } from "./fleet-bank";
import { FleetWhatsAppPanel, type WhatsAppDriver } from "./fleet-whatsapp";
import { callFleet } from "./fleet-data";
import { fleetLang, SaveButton, useFleetRun } from "./fleet-ui";

export function FleetSettings({
  businessId,
  settings,
  drivers = [],
}: {
  businessId: string;
  settings: FleetSettingsView;
  drivers?: WhatsAppDriver[];
}) {
  return (
    <div className="stack fleet-page">
      <SettingsForm businessId={businessId} settings={settings} />
      <FleetWhatsAppPanel businessId={businessId} settings={settings} drivers={drivers} />
      <FleetBankSchedule businessId={businessId} />
      <ImportSheet businessId={businessId} />
    </div>
  );
}

function SettingsForm({ businessId, settings }: { businessId: string; settings: FleetSettingsView }) {
  const [fee, setFee] = useState(centsToInput(settings.lateFeeCents));
  const [day, setDay] = useState(String(settings.lateFeeDay));
  const [first, setFirst] = useState(settings.lateFeeFirstMonth);
  const [rule, setRule] = useState<"full" | "days">(settings.returnRule);
  const [zelleName, setZelleName] = useState(settings.zelleName);
  const [zelleHandle, setZelleHandle] = useState(settings.zelleHandle);
  const [only, setOnly] = useState(settings.driversSeeOnly);
  const [saved, setSaved] = useState(false);
  const { busy, error, setError, run } = useFleetRun(businessId);

  async function save() {
    setSaved(false);
    const cents = fee.trim() ? dollarsToCents(fee) : 0;
    const dayNumber = Number(day);
    if (cents === null || !(dayNumber >= 1 && dayNumber <= 28)) {
      setError("Some details are missing or not valid.");
      return;
    }
    const result = await run(
      "settings_save",
      {
        settings: {
          lateFee: { cents, dayOfMonth: dayNumber, firstMonth: first },
          returnRule: rule,
          driversSeeOnlyThisBusiness: only,
          zelle: { name: zelleName, handle: zelleHandle },
        },
      },
      {
        en: "Save the Fleet settings? The late fee and the car-returned rule apply to bills from now on.",
        fr: "Enregistrer les paramètres Fleet ? Les frais de retard et la règle de retour de voiture s’appliquent aux factures à partir de maintenant.",
      },
    );
    if (result) setSaved(true);
  }

  return (
    <Panel title="Fleet settings" icon={<Settings size={18} />}>
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      <div className="lst-form-grid">
        <label className="lst-field">
          <span>Late fee ($, 0 for none)</span>
          <input data-no-translate disabled={busy} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
        </label>
        <label className="lst-field">
          <span>Late fee applies on day of the month (1–28)</span>
          <input data-no-translate disabled={busy} inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="lst-field">
          <span>First month the late fee applies</span>
          <input disabled={busy} type="month" value={first} onChange={(e) => setFirst(e.target.value)} />
        </label>
        <label className="lst-field">
          <span>When a car is returned mid-period</span>
          <select disabled={busy} value={rule} onChange={(e) => setRule(e.target.value as "full" | "days")}>
            <option value="full">Bill the full period</option>
            <option value="days">Bill the days used</option>
          </select>
        </label>
        <label className="lst-field">
          <span>Zelle name shown to drivers</span>
          <input data-no-translate disabled={busy} maxLength={80} value={zelleName} onChange={(e) => setZelleName(e.target.value)} />
        </label>
        <label className="lst-field">
          <span>Zelle email or phone shown to drivers</span>
          <input data-no-translate disabled={busy} maxLength={120} value={zelleHandle} onChange={(e) => setZelleHandle(e.target.value)} />
        </label>
        <label className="lst-check wide">
          <input type="checkbox" disabled={busy} checked={only} onChange={(e) => setOnly(e.target.checked)} />
          <span>Drivers see only this business</span>
        </label>
      </div>
      <p className="lst-hint">
        On: a Fleet driver sees this business&apos;s pages and services on Laawol, and no other business. Other customers are not affected.
      </p>
      <div className="fleet-actions">
        <SaveButton busy={busy} label="Save settings" busyLabel="Saving..." onClick={() => void save()} />
        {saved && <span className="fleet-saved" role="status">Saved.</span>}
      </div>
    </Panel>
  );
}

/** The sheet import; also on the admin console's business page, so a platform
 * admin can bring a fleet in for the business (Landa, 2026-11-12). */
export function ImportSheet({ businessId }: { businessId: string }) {
  const lang = fleetLang();
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [written, setWritten] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { run, error: runError } = useFleetRun(businessId);

  async function choose(file: File | undefined) {
    setPreview(null);
    setWritten(null);
    setError("");
    setRows(null);
    if (!file) return;
    setFileName(file.name);
    setBusy(true);
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2) {
        setError("That file has no rows to import. Export the sheet as CSV, with its header row.");
        return;
      }
      setRows(parsed);
      const answer = await callFleet("import_sheet", businessId, { rows: parsed, dryRun: true });
      setPreview(readImportPreview(answer));
    } catch (failure) {
      setError(fleetErrorMessage(failure));
    } finally {
      // Always resolves, whatever happened above.
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!rows || !preview) return;
    setBusy(true);
    try {
      const result = await run<{ written?: number }>(
        "import_sheet",
        { rows },
        {
          en: `Import ${preview.drivers} drivers, ${preview.cars} cars and ${preview.payments} payments (${moneyText(preview.paymentsCents, "en")})? Running it again later changes nothing that was already imported.`,
          fr: `Importer ${preview.drivers} chauffeurs, ${preview.cars} voitures et ${preview.payments} paiements (${moneyText(preview.paymentsCents, "fr")}) ? Le relancer plus tard ne change rien de ce qui a déjà été importé.`,
        },
      );
      if (result) {
        setWritten(Number(result.written) || 0);
        setRows(null);
        setPreview(null);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Import from spreadsheet" icon={<FileUp size={18} />}>
      <p className="lst-hint">
        Export your Fleet sheet as a CSV file and choose it here. Nothing is saved until you confirm: first you see what would be imported.
      </p>
      <label className="lst-field">
        <span>CSV file</span>
        <input accept=".csv,text/csv" disabled={busy} type="file" onChange={(e) => void choose(e.target.files?.[0])} />
      </label>
      {busy && !preview && <p className="lst-hint">Reading the file…</p>}
      {(error || runError) && <div className="lst-form-error" role="alert">{error || runError}</div>}
      {written !== null && (
        <div className="info-band" role="status">
          Imported. <span data-no-translate>{written}</span> records were written.
        </div>
      )}
      {preview && (
        <div className="fleet-import">
          <h3>What would be imported</h3>
          <div className="fleet-facts">
            <div><small>Drivers</small><b data-no-translate>{preview.drivers}</b></div>
            <div><small>Cars</small><b data-no-translate>{preview.cars}</b></div>
            <div><small>Assignments</small><b data-no-translate>{preview.assignments}</b></div>
            <div><small>Payments</small><b data-no-translate>{preview.payments}</b></div>
            <div><small>Payments total</small><b data-no-translate>{moneyText(preview.paymentsCents, lang)}</b></div>
            <div><small>Owed bills</small><b data-no-translate>{preview.bills}</b></div>
          </div>
          <p className="lst-hint" data-no-translate>{fileName}</p>
          {preview.warnings.length > 0 && (
            <div className="fleet-warnings">
              <b>Warnings</b>
              <ul>
                {preview.warnings.slice(0, 8).map((w, i) => (
                  <li data-no-translate key={`${w.row}-${w.field}-${i}`}>
                    Row {w.row}, {w.field}: {w.message}
                  </li>
                ))}
              </ul>
              {preview.warnings.length > 8 && (
                <small>
                  <span>More warnings not shown:</span> <span data-no-translate>{preview.warnings.length - 8}</span>
                </small>
              )}
            </div>
          )}
          <div className="fleet-actions">
            <SaveButton busy={busy} label="Import for real" busyLabel="Importing..." onClick={() => void confirmImport()} />
          </div>
        </div>
      )}
    </Panel>
  );
}
