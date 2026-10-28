"use client";

import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

import type { ShippingStep, ShippingStepSpec } from "@/lib/business-sidebar";

/**
 * The Shipping page's step bar: the package's trip (Requests → Waiting →
 * Containers → Deliveries) with arrows between, then the extra lists
 * (Barrel orders, Freight, This month) after a gap. A count shows once the
 * list behind it has loaded.
 */
export function ShippingStepBar({
  steps,
  active,
  counts,
  onSelect,
}: {
  steps: readonly ShippingStepSpec[];
  active: ShippingStep;
  counts: Partial<Record<ShippingStep, number>>;
  onSelect: (step: ShippingStep) => void;
}) {
  const flow = steps.filter((step) => step.flow);
  const extra = steps.filter((step) => !step.flow);
  const button = (step: ShippingStepSpec) => {
    const count = counts[step.id];
    return (
      <button
        aria-pressed={active === step.id}
        className={`segment ${active === step.id ? "active" : ""}`}
        key={step.id}
        onClick={() => onSelect(step.id)}
        type="button"
      >
        {step.label}
        {typeof count === "number" && <b>{count}</b>}
      </button>
    );
  };
  return (
    <nav aria-label="Shipping steps" className="shipping-steps">
      <div className="service-segments shipping-flow">
        {flow.map((step, index) => (
          <Fragment key={step.id}>
            {index > 0 && <ChevronRight aria-hidden className="shipping-step-arrow" size={14} />}
            {button(step)}
          </Fragment>
        ))}
      </div>
      {extra.length > 0 && (
        <div className="service-segments shipping-extra">{extra.map(button)}</div>
      )}
    </nav>
  );
}
