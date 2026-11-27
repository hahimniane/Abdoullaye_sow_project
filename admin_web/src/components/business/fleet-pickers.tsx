"use client";

// The pick lists used by the Fleet forms (docs/FLEET.md section 16): a field
// that can be chosen from a list is a list, never a typed box. Each one
// reuses the console's shared sources: the Google address lookup, the US
// states and cities, the car make/model/year catalog and the calling-code
// phone field.

import { useEffect, useMemo, useRef, useState } from "react";

import { AddressAutocomplete } from "@/components/address-autocomplete";
import { CustomerPhoneField } from "@/components/customer-phone-field";
import { structuredAddressFromSuggestion } from "@/lib/address-fields";
import { getMakes, getModels, getYears } from "@/lib/car-catalog";
import {
  CHARGE_REASONS,
  composeVehicleType,
  matchKnown,
  MONTH_DAYS,
  optionsWith,
  splitVehicleType,
  stateCode,
  WEEKDAYS,
  type VehicleParts,
} from "@/lib/fleet-pickers";
import { useCarCatalog } from "@/lib/use-car-catalog";
import { citiesForState, OTHER_CITY, US_STATE_OPTIONS, withSelected } from "@/lib/us-locations";
import { cleanVin, decodeVinForCatalog } from "@/lib/vin-decode";

const ADD_NEW = "__add_new__";

/**
 * Pick one of the values this business already uses (plate companies,
 * insurers, who pays the insurance), or add a new one; whatever is added
 * joins the list next time. `fixed` choices (e.g. "The company") are always
 * offered first and are translated; saved values are shown as written.
 */
export function PickOrAdd({
  label,
  value,
  known,
  fixed = [],
  onChange,
  disabled,
  addLabel,
  emptyLabel = "Not set",
  maxLength = 80,
}: {
  label: string;
  value: string;
  known: readonly string[];
  fixed?: readonly string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  addLabel: string;
  emptyLabel?: string;
  maxLength?: number;
}) {
  const [adding, setAdding] = useState(false);
  const saved = known.filter((k) => !fixed.some((f) => f.toLowerCase() === k.toLowerCase()));
  const all = [...fixed, ...saved];
  const extra = optionsWith(all, value).filter((o) => !all.includes(o));
  return (
    <label className="lst-field">
      <span>{label}</span>
      {adding ? (
        <span className="fleet-pick-add">
          <input
            autoFocus
            data-no-translate
            disabled={disabled}
            maxLength={maxLength}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => onChange(matchKnown(all, value))}
          />
          <button className="lst-btn ghost fleet-pick-back" type="button" disabled={disabled} onClick={() => setAdding(false)}>
            Pick from the list
          </button>
        </span>
      ) : (
        <select
          disabled={disabled}
          value={value}
          onChange={(e) => {
            if (e.target.value === ADD_NEW) {
              onChange("");
              setAdding(true);
            } else onChange(e.target.value);
          }}
        >
          <option value="">{emptyLabel}</option>
          {fixed.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {[...extra, ...saved].map((o) => (
            <option data-no-translate key={o} value={o}>
              {o}
            </option>
          ))}
          <option value={ADD_NEW}>{addLabel}</option>
        </select>
      )}
    </label>
  );
}

/**
 * The day a bill is due: 1 to 28 for a monthly bill, Monday to Sunday for a
 * weekly one (stored as 1 to 7). The value is the number as text; "" is
 * "not set" when `emptyLabel` is given.
 */
export function DueDaySelect({
  label,
  value,
  weekly = false,
  onChange,
  disabled,
  emptyLabel,
}: {
  label: string;
  value: string;
  weekly?: boolean;
  onChange: (value: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const known = weekly ? WEEKDAYS.map((w) => String(w.day)) : MONTH_DAYS.map(String);
  // A day saved before the lists (e.g. a 30th) still shows as it was.
  const legacy = value && !known.includes(value) ? value : "";
  return (
    <label className="lst-field">
      <span>{label}</span>
      <select disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {legacy && (
          <option data-no-translate value={legacy}>
            {legacy}
          </option>
        )}
        {weekly
          ? WEEKDAYS.map((w) => (
              <option key={w.day} value={String(w.day)}>
                {w.label}
              </option>
            ))
          : MONTH_DAYS.map((d) => (
              <option data-no-translate key={d} value={String(d)}>
                {d}
              </option>
            ))}
      </select>
    </label>
  );
}

/** What a charge is for: a reason from the list or Other, plus details. */
export function ChargeReasonFields({
  reason,
  details,
  onReason,
  onDetails,
  disabled,
}: {
  reason: string;
  details: string;
  onReason: (reason: string) => void;
  onDetails: (details: string) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <label className="lst-field">
        <span>What for</span>
        <select disabled={disabled} value={reason} onChange={(e) => onReason(e.target.value)}>
          {CHARGE_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
          <option value="">Something else</option>
        </select>
      </label>
      <label className="lst-field">
        <span>{reason ? "Details (optional)" : "Say what it is for"}</span>
        <input
          autoFocus={!reason}
          data-no-translate
          disabled={disabled}
          maxLength={100}
          placeholder={reason === "Ticket" ? "Plate, day, ticket number" : ""}
          value={details}
          onChange={(e) => onDetails(e.target.value)}
        />
      </label>
    </>
  );
}

export type FleetAddress = { line1: string; city: string; state: string; zip: string };

/**
 * A driver's (or a friend's) address: the street is looked up with Google as
 * it is typed and fills the rest; the state and the city are lists (the
 * complete US catalog), with "Other" for a city the list does not have.
 */
export function FleetAddressFields({
  idPrefix,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string;
  value: FleetAddress;
  onChange: (value: FleetAddress) => void;
  disabled?: boolean;
}) {
  const code = stateCode(value.state);
  const listed = useMemo(() => citiesForState(code).filter((c) => c !== OTHER_CITY), [code]);
  const cityKnown = !value.city || listed.includes(value.city);
  // "Other" was picked, or a saved city is not in the state's list.
  const [typing, setTyping] = useState(!cityKnown);
  const stateOptions = useMemo(() => {
    if (!code || US_STATE_OPTIONS.some((o) => o.code === code)) return US_STATE_OPTIONS;
    return [{ code, name: code }, ...US_STATE_OPTIONS];
  }, [code]);

  return (
    <>
      <div className="lst-field wide fleet-address-street">
        <AddressAutocomplete
          id={`${idPrefix}-street`}
          label="Street address"
          required={false}
          suggestionsEnabled={!disabled}
          value={value.line1}
          onChange={(line1) => onChange({ ...value, line1 })}
          onSelect={(suggestion) => {
            const found = structuredAddressFromSuggestion(suggestion);
            const nextState = stateCode(found.state) || code;
            const nextCity = found.city || value.city;
            const inList = citiesForState(nextState).includes(nextCity);
            setTyping(Boolean(nextCity) && !inList);
            onChange({
              line1: [found.streetLine, found.apartment].filter(Boolean).join(" ") || value.line1,
              city: nextCity,
              state: nextState,
              zip: found.postalCode || value.zip,
            });
          }}
        />
      </div>
      <label className="lst-field">
        <span>State</span>
        <select
          disabled={disabled}
          value={code}
          onChange={(e) => {
            const next = e.target.value;
            const keep = citiesForState(next).includes(value.city);
            setTyping(false);
            onChange({ ...value, state: next, city: keep ? value.city : "" });
          }}
        >
          <option value="">Choose a state</option>
          {stateOptions.map((o) => (
            <option key={o.code} value={o.code}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className="lst-field">
        <span>City</span>
        <select
          disabled={disabled || !code}
          value={typing ? OTHER_CITY : value.city}
          onChange={(e) => {
            if (e.target.value === OTHER_CITY) {
              setTyping(true);
              onChange({ ...value, city: "" });
            } else {
              setTyping(false);
              onChange({ ...value, city: e.target.value });
            }
          }}
        >
          <option value="">{code ? "Choose a city" : "Choose the state first"}</option>
          {withSelected(listed, typing ? "" : value.city).map((c) => (
            <option data-no-translate key={c} value={c}>
              {c}
            </option>
          ))}
          <option value={OTHER_CITY}>Other city</option>
        </select>
      </label>
      {typing && (
        <label className="lst-field">
          <span>City name</span>
          <input
            autoFocus={!value.city}
            data-no-translate
            disabled={disabled}
            maxLength={80}
            value={value.city}
            onChange={(e) => onChange({ ...value, city: e.target.value })}
          />
        </label>
      )}
      <label className="lst-field">
        <span>ZIP code</span>
        <input
          data-no-translate
          disabled={disabled}
          inputMode="numeric"
          maxLength={10}
          value={value.zip}
          onChange={(e) => onChange({ ...value, zip: e.target.value })}
        />
      </label>
    </>
  );
}

/** A phone number with its country code, the console's shared phone field. */
export function FleetPhoneField({
  id,
  label = "Phone",
  value,
  onChange,
  disabled,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="lst-field wide fleet-phone">
      <CustomerPhoneField id={id} label={label} value={value} onChange={onChange} disabled={disabled} />
    </div>
  );
}

const lookup = { makes: getMakes, models: getModels, years: getYears };

/**
 * The car on a plate: make, model and year from the catalog, filled from the
 * VIN when a full one is typed. Saved as one line ("Toyota Camry 2021").
 * A line saved before the lists that the catalog cannot read is kept until
 * the make is picked.
 */
export function PlateCarFields({
  vehicleType,
  vin,
  onVehicleType,
  disabled,
}: {
  vehicleType: string;
  vin: string;
  onVehicleType: (value: string) => void;
  disabled?: boolean;
}) {
  const ready = useCarCatalog();
  const [parts, setParts] = useState<VehicleParts>({ make: "", model: "", year: "" });
  const [unread, setUnread] = useState("");
  const [note, setNote] = useState("");
  const [reading, setReading] = useState(false);
  const started = useRef(false);
  const lastVin = useRef(cleanVin(vin));

  // Once the catalog is in, read the saved line into the three lists.
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    const split = splitVehicleType(vehicleType, lookup);
    if (split) setParts(split);
    else setUnread(vehicleType.trim());
  }, [ready, vehicleType]);

  // A full VIN typed (or changed) fills the lists.
  useEffect(() => {
    const clean = cleanVin(vin);
    if (!clean || clean === lastVin.current) return;
    lastVin.current = clean;
    let live = true;
    setReading(true);
    setNote("");
    void decodeVinForCatalog(clean).then((r) => {
      if (!live) return;
      setReading(false);
      if (r.kind === "filled") {
        const next = { make: r.make, model: r.model, year: r.year };
        setParts(next);
        setUnread("");
        onVehicleType(composeVehicleType(next));
        setNote(r.model && r.year ? "Filled from the VIN." : "Filled the make from the VIN. Pick the model and year.");
      } else if (r.kind === "unknownMake") setNote("The VIN is for a make that is not in the list. Pick the closest.");
      else if (r.kind === "unreadable") setNote("This VIN could not be read. Pick the car from the lists.");
      else setNote("The VIN service did not answer. Pick the car from the lists.");
    });
    return () => {
      live = false;
    };
  }, [vin, onVehicleType]);

  const update = (next: VehicleParts) => {
    setParts(next);
    setUnread("");
    onVehicleType(composeVehicleType(next));
  };
  const makes = ready ? getMakes() : [];
  const models = ready && parts.make ? getModels(parts.make) : [];
  const years = ready && parts.make && parts.model ? getYears(parts.make, parts.model) : [];

  return (
    <>
      <label className="lst-field">
        <span>Car make</span>
        <select
          disabled={disabled || !ready}
          value={parts.make}
          onChange={(e) => update({ make: e.target.value, model: "", year: "" })}
        >
          <option value="">{ready ? "Choose a make" : "Loading…"}</option>
          {makes.map((m) => (
            <option data-no-translate key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="lst-field">
        <span>Model</span>
        <select disabled={disabled || !parts.make} value={parts.model} onChange={(e) => update({ ...parts, model: e.target.value, year: "" })}>
          <option value="">{parts.make ? "Choose a model" : "Choose the make first"}</option>
          {models.map((m) => (
            <option data-no-translate key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="lst-field">
        <span>Year</span>
        <select disabled={disabled || !parts.model} value={parts.year} onChange={(e) => update({ ...parts, year: e.target.value })}>
          <option value="">{parts.model ? "Choose a year" : "Choose the model first"}</option>
          {years.map((y) => (
            <option data-no-translate key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      {(unread || note || reading) && (
        <p className="lst-hint wide fleet-car-note" role="status">
          {reading ? (
            "Reading the VIN…"
          ) : unread ? (
            <>
              <span>Saved as</span> <b data-no-translate>{unread}</b>. <span>Pick the make, model and year to replace it.</span>
            </>
          ) : (
            note
          )}
        </p>
      )}
    </>
  );
}
