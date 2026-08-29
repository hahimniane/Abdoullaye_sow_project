"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { CustomerPhoneField } from "@/components/customer-phone-field";
import {
  beginGuestSession,
  guestSessionErrorMessage,
} from "@/lib/guest-checkout";
import {
  type GuestContact,
  type GuestContactField,
  guestContactProblems,
  normalizeGuestContact,
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
      await beginGuestSession(normalizeGuestContact(contact));
      onContinued();
    } catch (sessionError) {
      setError(guestSessionErrorMessage(sessionError));
      setSubmitting(false);
    }
  }

  const disabled = submitting || busy;

  return (
    <form className="login-card guest-contact-panel" onSubmit={submit}>
      <p className="guest-contact-intro">
        <ShieldCheck aria-hidden="true" size={16} />
        Book without an account. We use these details to send your receipt and
        tracking number, and to reach you about this shipment.
      </p>

      <label htmlFor="guest-contact-name">
        Full name
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

      <label htmlFor="guest-contact-email">
        Email address
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
