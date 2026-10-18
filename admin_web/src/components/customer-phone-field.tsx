"use client";

import { useMemo, useState } from "react";

import { SearchableSelect } from "@/components/searchable-select";
import {
  CALLING_CODE_OPTIONS,
  callingCodeOptionForCountry,
  composeInternationalPhone,
  phoneFieldCountry,
  phoneFieldNationalNumber,
  phoneFromTyped,
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
  // The country the person picked, kept apart from the digits. It is never
  // overwritten by the form's default (initialCountryCode), and an empty
  // number keeps it: picking "United States (+1)" before typing must stick.
  const [chosenCountry, setChosenCountry] = useState<string | null>(null);
  // Derived every render, no effect: a value set from outside the field
  // (a saved recipient, an existing record) shows its own country.
  const countryCode = phoneFieldCountry(value, chosenCountry, initialCountryCode);
  const option =
    callingCodeOptionForCountry(countryCode) ?? CALLING_CODE_OPTIONS[0];
  const nationalNumber = phoneFieldNationalNumber(value, option);
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
            setChosenCountry(next.code);
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
              phoneFromTyped(
                event.target.value,
                option,
                option.code,
                setChosenCountry,
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
        <span>International number:</span>{" "}
        <span data-no-translate>{value || option.dialCode}</span>
      </small>
      {error && (
        <small className="customer-field-error" id={id ? `${id}-error` : undefined}>
          {error}
        </small>
      )}
    </div>
  );
}
