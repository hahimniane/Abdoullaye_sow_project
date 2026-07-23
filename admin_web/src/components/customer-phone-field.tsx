"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import {
  CALLING_CODE_OPTIONS,
  callingCodeOptionForCountry,
  callingCodeOptionForPhone,
  composeInternationalPhone,
} from "@/lib/calling-code-catalog";
import { currentWebLanguage } from "@/lib/language";

type CustomerPhoneFieldProps = {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  initialCountryCode?: string;
};

export function CustomerPhoneField({
  id,
  label,
  value,
  onChange,
  disabled = false,
  required = false,
  initialCountryCode = "US",
}: CustomerPhoneFieldProps) {
  const inferred = callingCodeOptionForPhone(value, initialCountryCode);
  const [countryCode, setCountryCode] = useState(
    inferred?.code ?? initialCountryCode,
  );
  const option =
    callingCodeOptionForCountry(countryCode) ??
    inferred ??
    CALLING_CODE_OPTIONS[0];
  const normalized = value.trim().replace(/[\s().-]/g, "");
  const allDigits = normalized.replace(/\D/g, "");
  const nationalNumber =
    normalized.startsWith("+") && allDigits.startsWith(option.callingCode)
      ? allDigits.slice(option.callingCode.length)
      : allDigits;
  const displayNames = useMemo(
    () =>
      new Intl.DisplayNames(
        [currentWebLanguage() === "fr" ? "fr" : "en"],
        { type: "region" },
      ),
    [],
  );

  return (
    <label className="customer-phone-label" htmlFor={id}>
      {label}
      <span className="customer-phone-control">
        <span className="customer-phone-country">
          <span aria-hidden="true">{option.flag}</span>
          <strong>{option.dialCode}</strong>
          <ChevronDown aria-hidden="true" size={15} />
          <select
            aria-label="Phone country"
            disabled={disabled}
            onChange={(event) => {
              const next = callingCodeOptionForCountry(event.target.value);
              if (!next) return;
              setCountryCode(next.code);
              onChange(
                composeInternationalPhone(next.callingCode, nationalNumber),
              );
            }}
            value={option.code}
          >
            {CALLING_CODE_OPTIONS.map((item) => (
              <option key={item.code} value={item.code}>
                {item.flag} {displayNames.of(item.code) ?? item.countryName} (
                {item.dialCode})
              </option>
            ))}
          </select>
        </span>
        <input
          autoComplete="tel-national"
          disabled={disabled}
          id={id}
          inputMode="tel"
          onChange={(event) =>
            onChange(
              composeInternationalPhone(
                option.callingCode,
                event.target.value,
              ),
            )
          }
          placeholder="Phone number"
          required={required}
          type="tel"
          value={nationalNumber}
        />
      </span>
      <small>International number: {value || option.dialCode}</small>
    </label>
  );
}
