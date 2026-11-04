"use client";

import { Minus, Plus } from "lucide-react";

/** A − 2 + control for a quantity (0 removes the item; `min` keeps it at least that many). */
export function QuantityStepper({ label, value, onChange, min = 0 }: { label: string; value: number; onChange: (next: number) => void; min?: number }) {
  return (
    <span className="pkr-stepper" role="group" aria-label={label}>
      <button aria-label="Remove one" className="icon-button" disabled={value <= min} onClick={() => onChange(value - 1)} type="button">
        <Minus size={16} aria-hidden="true" />
      </button>
      <strong data-no-translate>{value}</strong>
      <button aria-label="Add one" className="icon-button" onClick={() => onChange(value + 1)} type="button">
        <Plus size={16} aria-hidden="true" />
      </button>
    </span>
  );
}
