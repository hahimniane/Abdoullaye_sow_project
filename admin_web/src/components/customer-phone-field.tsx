"use client";

import { useEffect, useMemo, useState } from "react";

import { SearchableSelect } from "@/components/searchable-select";
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
  error?: string;
  onBlur?: () => void;
  required?: boolean;
  initialCountryCode?: string;
};

export function CustomerPhoneField({
  id,
  label,
  value,
  onChange,
  disabled = false,
  error,
  onBlur,
  required = false,
  initialCountryCode = "US",
}: CustomerPhoneFieldProps) {
  const inferred = callingCodeOptionForPhone(value, initialCountryCode);
  const [countryCode, setCountryCode] = useState(
    inferred?.code ?? initialCountryCode,
  );
  useEffect(() => {
    if (!value.trim()) setCountryCode(initialCountryCode);
  }, [initialCountryCode, value]);
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
  const language = currentWebLanguage() === "fr" ? "fr" : "en";
  const displayNames = useMemo(
    () =>
      new Intl.DisplayNames([language], {
        type: "region",
      }),
    [language],
  );

  return (
    <div className="customer-phone-label">
      <label htmlFor={id}>{label}</label>
      <span className="customer-phone-control">
        <SearchableSelect
          className="customer-phone-country"
          clearOnSearch={false}
          disabled={disabled}
          emptyMessage="No countries match your search."
          hideLabel
          label="Phone country"
          listLabel="Phone country options"
          onChange={(country) => {
            const next = callingCodeOptionForCountry(country);
            if (!next) return;
            setCountryCode(next.code);
            onChange(
              composeInternationalPhone(next.callingCode, nationalNumber),
            );
          }}
          options={CALLING_CODE_OPTIONS.map((item) => {
            const countryName =
              displayNames.of(item.code) ?? item.countryName;
            return {
              label: `${item.flag} ${countryName} (${item.dialCode})`,
              keywords: `${item.code} ${item.countryName} ${item.callingCode}`,
              selectedLabel: `${item.flag} ${item.dialCode}`,
              value: item.code,
            };
          })}
          placeholder="Search country"
          value={option.code}
        />
        <input
          aria-describedby={error && id ? `${id}-error` : undefined}
          aria-invalid={Boolean(error)}
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
          onBlur={onBlur}
          placeholder="Phone number"
          required={required}
          type="tel"
          value={nationalNumber}
        />
      </span>
      <small>
        <span>International number:</span> {value || option.dialCode}
      </small>
      {error && (
        <small className="customer-field-error" id={id ? `${id}-error` : undefined}>
          {error}
        </small>
      )}
    </div>
  );
}
