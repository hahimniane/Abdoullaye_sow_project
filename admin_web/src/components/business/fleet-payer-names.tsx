"use client";

// The driver page's "Names this driver pays from": the Zelle sender names
// remembered for this driver. A deposit from one of them pays the driver by
// itself (docs/FLEET_PAYMENT_PROOF.md, Q5). The office can add and remove.

import { useEffect, useMemo, useState } from "react";
import { Landmark, X } from "lucide-react";

import { Panel } from "@/components/panel";
import { cleanPayerNames, readPayerNames } from "@/lib/fleet-claims";
import { splitBadName } from "@/lib/fleet";

import { SaveButton, useFleetRun } from "./fleet-ui";

export function FleetPayerNames({ businessId, driver }: { businessId: string; driver: Record<string, unknown> & { id: string } }) {
  const { busy, error, setError, run } = useFleetRun(businessId);
  const saved = useMemo(() => readPayerNames(driver), [driver]);
  const [names, setNames] = useState<string[]>(saved);
  const [draft, setDraft] = useState("");
  // The live record is the truth: follow it when it changes (a save answered, or a deposit remembered a name).
  const signature = saved.join("\u0000");
  useEffect(() => setNames(saved), [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const bad = useMemo(() => splitBadName(error), [error]);

  async function save(next: string[], confirm?: { en: string; fr: string }) {
    const result = await run<{ names?: unknown }>("payer_names_save", { driverId: driver.id, names: next }, confirm);
    if (result) {
      setNames(Array.isArray(result.names) ? cleanPayerNames(result.names) : next);
      return true;
    }
    return false;
  }

  async function add() {
    const next = cleanPayerNames([...names, draft]);
    if (next.length === names.length) {
      setError(draft.trim() ? "That name is already on the list." : "Type a name first.");
      return;
    }
    if (await save(next)) setDraft("");
  }

  return (
    <Panel title="Names this driver pays from" icon={<Landmark size={18} />}>
      <p className="lst-hint">A Zelle from one of these names pays this driver by itself.</p>
      {names.length === 0 ? (
        <p className="empty-state">No name yet. It is remembered the first time a deposit is matched to this driver.</p>
      ) : (
        <ul className="fleet-payer-names">
          {names.map((name) => (
            <li key={name}>
              <span data-no-translate>{name}</span>
              <button
                className="lst-icon-btn"
                type="button"
                disabled={busy}
                aria-label="Remove this name"
                title="Remove this name"
                onClick={() => void save(names.filter((n) => n !== name), {
                  en: `Stop paying this driver automatically from ${name}? Deposits from this name will wait for the office again.`,
                  fr: `Ne plus payer ce chauffeur automatiquement depuis ${name} ? Les dépôts de ce nom attendront de nouveau le bureau.`,
                })}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="fleet-payer-add"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <label className="lst-field">
          <span className="sr-only">Add a name</span>
          <input
            aria-label="Add a name"
            maxLength={80}
            placeholder="Name on the Zelle account"
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <SaveButton busy={busy} label="Add name" busyLabel="Saving..." onClick={() => void add()} disabled={!draft.trim()} />
      </form>
      <p className="lst-hint">Type the full name as the bank shows it, at least two words.</p>
      {error && (
        <div className="lst-form-error" role="alert">
          {bad ? (<><span data-no-translate>&ldquo;{bad.name}&rdquo;</span> <span>{bad.rest}</span></>) : error}
        </div>
      )}
    </Panel>
  );
}
