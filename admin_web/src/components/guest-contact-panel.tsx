"use client";

import { FormEvent, useState } from "react";
import { signInAnonymously } from "firebase/auth";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { CustomerPhoneField } from "@/components/customer-phone-field";
import { auth } from "@/lib/firebase";
import {
  type GuestContact,
  type GuestContactField,
  guestContactProblems,
  normalizeGuestContact,
  rememberGuestContact,
} from "@/lib/guest-contact";

type GuestContactPanelProps = {
  busy?: boolean;
  onContinued: () => void;
};

const EMPTY: GuestContact = { name: "", email: "", phone: "" };

export function GuestContactPanel({
  busy = false,
  onContinued,
}: GuestContactPanelProps) {
  const [contact, setContact] = useState<GuestContact>(EMPTY);
  const [touched, setTouched] = useState<GuestContactField[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const problems = guestContactProblems(contact);
  const shows = (field: GuestContactField) =>
    touched.includes(field) && problems.includes(field);
  const markTouched = (field: GuestContactField) =>
    setTouched((current) =>
      current.includes(field) ? current : [...current, field],
    );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting || busy) return;
    if (problems.length) {
      setTouched(["name", "email", "phone"]);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const normalized = normalizeGuestContact(contact);
      // Stored before the sign-in rather than after: the anonymous session
      // flipping to signed-in re-renders this panel away, and the checkout
      // that follows reads the contact back out of storage.
      rememberGuestContact(normalized);
      await signInAnonymously(auth);
      onContinued();
    } catch {
      setError("We could not continue. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  const disabled = submitting || busy;

  return (
    <form className="guest-contact-panel" onSubmit={submit}>
      <p className="guest-contact-intro">
        <ShieldCheck aria-hidden="true" size={16} />
        Book without an account. We use these details to send your receipt and
        tracking number, and to reach you about this shipment.
      </p>

      <label className="field" htmlFor="guest-contact-name">
        <span>Full name</span>
        <input
          autoComplete="name"
          disabled={disabled}
          id="guest-contact-name"
          onBlur={() => markTouched("name")}
          onChange={(event) =>
            setContact({ ...contact, name: event.target.value })
          }
          placeholder="Mariama Diallo"
          type="text"
          value={contact.name}
        />
        {shows("name") && (
          <small className="field-error">Enter your full name</small>
        )}
      </label>

      <label className="field" htmlFor="guest-contact-email">
        <span>Email address</span>
        <input
          autoComplete="email"
          disabled={disabled}
          id="guest-contact-email"
          onBlur={() => markTouched("email")}
          onChange={(event) =>
            setContact({ ...contact, email: event.target.value })
          }
          placeholder="you@example.com"
          type="email"
          value={contact.email}
        />
        {shows("email") && (
          <small className="field-error">Enter a valid email address</small>
        )}
      </label>

      <CustomerPhoneField
        disabled={disabled}
        error={shows("phone") ? "Enter a valid phone number" : undefined}
        id="guest-contact-phone"
        label="Phone number"
        onBlur={() => markTouched("phone")}
        onChange={(phone) => setContact({ ...contact, phone })}
        required
        value={contact.phone}
      />

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <button className="primary-button" disabled={disabled} type="submit">
        {submitting ? "One moment..." : "Continue as guest"}
        <ArrowRight aria-hidden="true" size={16} />
      </button>

      <small className="guest-contact-note">
        Your tracking number arrives by email. Keep it to follow this
        booking.
      </small>
    </form>
  );
}
