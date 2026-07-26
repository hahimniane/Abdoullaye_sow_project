"use client";

import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { MapPin } from "lucide-react";

import { functions } from "@/lib/firebase";

const CALL_TIMEOUT_MS = 30_000;

export type AddressSuggestion = {
  description: string;
  placeId: string;
  borough?: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
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
