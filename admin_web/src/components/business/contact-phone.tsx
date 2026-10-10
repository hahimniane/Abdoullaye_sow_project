"use client";

import { useState } from "react";

import { CustomerPhoneField } from "@/components/customer-phone-field";
import { contactPhoneReach } from "@/lib/container-manifest";

/**
 * A contact's phone, the shared calling-code picker, and the WhatsApp switch
 * under it. The switch cannot be on without a number; a number with no
 * country code is saved (older app versions send them) but warned about,
 * because WhatsApp cannot reach it.
 */
export function ContactPhone({
  id,
  label,
  value,
  onChange,
  notify,
  onNotify,
  initialCountryCode,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  notify: boolean;
  onNotify: (value: boolean) => void;
  initialCountryCode: string;
  disabled?: boolean;
}) {
  // A half-typed number is "incomplete" on every keystroke; only say so once
  // the person has left the field.
  const [touched, setTouched] = useState(false);
  const reach = contactPhoneReach(value);
  const hasPhone = reach !== "empty";
  return (
    <div className="ctn-phone">
      <CustomerPhoneField
        id={id}
        label={label}
        value={value}
        onChange={(next) => { setTouched(false); onChange(next); }}
        onBlur={() => setTouched(true)}
        initialCountryCode={initialCountryCode}
        disabled={disabled}
      />
      {reach === "local" && (
        <small className="ctn-phone-warn" role="status">Add the country code so WhatsApp updates can reach this number.</small>
      )}
      {reach === "incomplete" && touched && (
        <small className="ctn-phone-warn" role="status">This number is too short to receive WhatsApp updates.</small>
      )}
      <label className="ctn-notify">
        <input
          type="checkbox"
          checked={notify && hasPhone}
          disabled={disabled || !hasPhone}
          onChange={(e) => onNotify(e.target.checked)}
        />
        <span>Send this person WhatsApp updates about this shipment</span>
      </label>
    </div>
  );
}
