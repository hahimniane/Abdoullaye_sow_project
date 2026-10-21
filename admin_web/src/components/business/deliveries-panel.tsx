"use client";

import { useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { PackageCheck, Search } from "lucide-react";

import { PackageStaffView } from "@/components/package-staff-view";
import { deliveryCodeFrom } from "@/lib/container-delivery";
import type { UserProfile } from "@/types/admin";

/**
 * Deliveries: destination staff find a package by the code on its label
 * (typed, pasted, or read by a scanner that types the label's link) and hand
 * it over - what it is, who sends it and who collects it, where its
 * container stands, and Mark delivered. The package itself is the staff view
 * of the tracking page (PackageStaffView), the one place that reads a line
 * by its code; a person with only the Deliveries permission sees no prices,
 * payments or balances there. Scanning the label's QR with a phone opens the
 * same view on the tracking page.
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
    </div>
  );
}
