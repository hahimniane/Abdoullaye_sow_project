"use client";

import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { MapPin } from "lucide-react";

import { COUNTRY_NAMES } from "@/lib/country-catalog";
import { functions } from "@/lib/firebase";
import { US_STATE_OPTIONS, withSelected } from "@/lib/us-locations";
import {
  type StructuredAddress,
  structuredAddressFromLine,
  structuredAddressFromSuggestion,
} from "@/lib/address-fields";

const CALL_TIMEOUT_MS = 30_000;

export type AddressSuggestion = {
  description: string;
  placeId: string;
  borough?: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  // Named parts from suggestPickupAddresses. Optional so a client build that
  // is newer than the deployed callable degrades to the single line instead
  // of rendering an empty form.
  streetLine?: string;
  apartment?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  postalCode?: string;
  country?: string;
  countryCode?: string;
};

async function suggestPickupAddresses(input: string) {
  const callable = httpsCallable<{ input: string }, AddressSuggestion[]>(
    functions,
    "suggestPickupAddresses",
  );
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      callable({ input }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("The request timed out. Try again.")),
          CALL_TIMEOUT_MS,
        );
      }),
    ]);
    return response.data;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// Google Places-backed address field shared by the customer checkout flow
// and the business console (e.g. office-location addresses) so both get the
// same reliable suggestion behavior instead of a plain text input.
export function AddressAutocomplete({
  id,
  label = "Address",
  onBlur,
  onChange,
  onSelect,
  required = true,
  suggestionsEnabled,
  value,
}: {
  id: string;
  label?: string;
  onBlur?: () => void;
  onChange: (value: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
  required?: boolean;
  suggestionsEnabled: boolean;
  value: string;
}) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [touched, setTouched] = useState(false);
  const addressInvalid = required && touched && value.trim().length === 0;
  const query = value.trim();
  const listboxId = `${id}-suggestions`;

  function selectSuggestion(suggestion: AddressSuggestion) {
    const resolved = suggestion.formattedAddress || suggestion.description;
    setSelectedAddress(resolved);
    setSuggestions([]);
    setActiveIndex(-1);
    onSelect(suggestion);
  }

  useEffect(() => {
    if (
      !suggestionsEnabled ||
      query.length < 3 ||
      query === selectedAddress
    ) {
      setSuggestions([]);
      setLoading(false);
      setSuggestionError(false);
      setSearchedQuery("");
      setActiveIndex(-1);
      return;
    }
    let active = true;
    const debounce = setTimeout(() => {
      setLoading(true);
      setSuggestionError(false);
      void suggestPickupAddresses(query)
        .then((result) => {
          if (!active) return;
          setSuggestions(Array.isArray(result) ? result : []);
          setSearchedQuery(query);
          setActiveIndex(-1);
        })
        .catch(() => {
          if (!active) return;
          setSuggestions([]);
          setSearchedQuery(query);
          setSuggestionError(true);
          setActiveIndex(-1);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(debounce);
    };
  }, [query, selectedAddress, suggestionsEnabled]);

  return (
    <div className="customer-address-field customer-form-span">
      <label htmlFor={id}>{label}</label>
      <div className="customer-address-control">
        <MapPin aria-hidden="true" size={17} />
        <input
          aria-activedescendant={
            activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
          aria-autocomplete="list"
          aria-busy={loading}
          aria-controls={suggestionsEnabled ? listboxId : undefined}
          aria-describedby={addressInvalid ? `${id}-error` : undefined}
          aria-expanded={suggestions.length > 0}
          aria-invalid={addressInvalid}
          autoComplete="off"
          id={id}
          required={required}
          onBlur={() => {
            setTouched(true);
            onBlur?.();
          }}
          onChange={(event) => {
            setSelectedAddress("");
            setSuggestionError(false);
            setSearchedQuery("");
            setActiveIndex(-1);
            onChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && suggestions.length > 0) {
              event.preventDefault();
              setActiveIndex((current) =>
                Math.min(current + 1, suggestions.length - 1),
              );
            } else if (event.key === "ArrowUp" && suggestions.length > 0) {
              event.preventDefault();
              setActiveIndex((current) =>
                current <= 0 ? suggestions.length - 1 : current - 1,
              );
            } else if (
              event.key === "Enter" &&
              activeIndex >= 0 &&
              suggestions[activeIndex]
            ) {
              event.preventDefault();
              selectSuggestion(suggestions[activeIndex]);
            } else if (event.key === "Escape") {
              setSuggestions([]);
              setActiveIndex(-1);
            }
          }}
          placeholder={
            suggestionsEnabled
              ? "Start typing an address"
              : "Enter an address"
          }
          role="combobox"
          value={value}
        />
        {loading && <span className="loading-spinner" />}
      </div>
      {addressInvalid && (
        <small className="customer-field-error" id={`${id}-error`}>
          Enter a complete address.
        </small>
      )}
      {suggestions.length > 0 && (
        <div
          aria-label="Address suggestions"
          className="customer-address-suggestions"
          id={listboxId}
          role="listbox"
        >
          {suggestions.map((suggestion, index) => (
            <button
              aria-selected={activeIndex === index}
              className={activeIndex === index ? "active" : ""}
              id={`${listboxId}-option-${index}`}
              key={suggestion.placeId}
              onClick={() => selectSuggestion(suggestion)}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              type="button"
            >
              <MapPin size={15} />
              <span>
                <strong>{suggestion.description}</strong>
                {suggestion.borough && <small>{suggestion.borough}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
      {loading && (
        <small className="customer-address-status" role="status">
          Searching addresses...
        </small>
      )}
      {!loading &&
        !suggestionError &&
        query.length >= 3 &&
        searchedQuery === query &&
        suggestions.length === 0 && (
          <small className="customer-address-status" role="status">
            No matching addresses. Keep typing or enter the complete address.
          </small>
        )}
      {suggestionError && (
        <small className="customer-address-status error" role="status">
          {
            "Address suggestions are unavailable. Enter the complete address to continue."
          }
        </small>
      )}
    </div>
  );
}

const US_COUNTRY_NAME = "United States";

// The customer's address as separate, editable fields (backlog item 1).
//
// Choosing a suggestion fills each field instead of pasting one opaque string
// the customer cannot correct, and the apartment/unit is its own field that a
// suggestion never overwrites - Google autocompletes buildings, not units, so
// its subpremise is nearly always empty. Nothing here forces the customer to
// accept a suggestion: the street box is a plain text input, and every other
// field stays editable after a suggestion lands.
export function StructuredAddressFields({
  disabled = false,
  idPrefix,
  onBlur,
  onChange,
  required = true,
  streetLabel = "Street address",
  suggestionsEnabled,
  value,
}: {
  disabled?: boolean;
  idPrefix: string;
  onBlur?: () => void;
  // The chosen suggestion travels with the change so a caller can apply
  // server-derived extras (the pickup borough) in the same state update
  // instead of a second, racing one.
  onChange: (value: StructuredAddress, suggestion?: AddressSuggestion) => void;
  required?: boolean;
  streetLabel?: string;
  suggestionsEnabled: boolean;
  value: StructuredAddress;
}) {
  // A US address gets the canonical state picker; anywhere else has no
  // canonical region catalog, so the field stays typed (and is pre-filled from
  // the suggestion).
  const isUnitedStates = value.country.trim() === US_COUNTRY_NAME;
  const stateOptions = withSelected(
    US_STATE_OPTIONS.map((option) => option.code),
    value.state.trim(),
  );

  return (
    <>
      <AddressAutocomplete
        id={`${idPrefix}-street`}
        label={streetLabel}
        onBlur={onBlur}
        onChange={(streetLine) =>
          onChange(structuredAddressFromLine(streetLine, value))
        }
        onSelect={(suggestion) =>
          onChange(structuredAddressFromSuggestion(suggestion, value), suggestion)
        }
        required={required}
        suggestionsEnabled={suggestionsEnabled}
        value={value.streetLine}
      />
      <label
        className="customer-form-span"
        htmlFor={`${idPrefix}-apartment`}
      >
        Apartment, suite, or unit (optional)
        <input
          autoComplete="address-line2"
          disabled={disabled}
          id={`${idPrefix}-apartment`}
          onBlur={onBlur}
          onChange={(event) =>
            onChange({ ...value, apartment: event.target.value })
          }
          placeholder="Apt 4B"
          type="text"
          value={value.apartment}
        />
        <small>
          Apartment numbers are rarely in the suggestion — add yours here.
        </small>
      </label>
      <label htmlFor={`${idPrefix}-city`}>
        City
        <input
          autoComplete="address-level2"
          disabled={disabled}
          id={`${idPrefix}-city`}
          onBlur={onBlur}
          onChange={(event) => onChange({ ...value, city: event.target.value })}
          type="text"
          value={value.city}
        />
      </label>
      <label htmlFor={`${idPrefix}-state`}>
        State or region
        {isUnitedStates ? (
          <select
            disabled={disabled}
            id={`${idPrefix}-state`}
            onBlur={onBlur}
            onChange={(event) =>
              onChange({ ...value, state: event.target.value })
            }
            value={value.state.trim()}
          >
            <option value="">Select a state</option>
            {stateOptions.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        ) : (
          <input
            autoComplete="address-level1"
            disabled={disabled}
            id={`${idPrefix}-state`}
            onBlur={onBlur}
            onChange={(event) =>
              onChange({ ...value, state: event.target.value })
            }
            type="text"
            value={value.state}
          />
        )}
      </label>
      <label htmlFor={`${idPrefix}-postal-code`}>
        ZIP or postal code
        <input
          autoComplete="postal-code"
          disabled={disabled}
          id={`${idPrefix}-postal-code`}
          inputMode="numeric"
          onBlur={onBlur}
          onChange={(event) =>
            onChange({ ...value, postalCode: event.target.value })
          }
          type="text"
          value={value.postalCode}
        />
      </label>
      <label htmlFor={`${idPrefix}-country`}>
        Country
        <select
          disabled={disabled}
          id={`${idPrefix}-country`}
          onBlur={onBlur}
          onChange={(event) =>
            onChange({ ...value, country: event.target.value })
          }
          value={value.country.trim()}
        >
          <option value="">Select a country</option>
          {/* Canonical 249-country catalog; a stored value outside it is
              folded in so the picker never renders blank. */}
          {withSelected([...COUNTRY_NAMES], value.country.trim()).map(
            (country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ),
          )}
        </select>
      </label>
    </>
  );
}
