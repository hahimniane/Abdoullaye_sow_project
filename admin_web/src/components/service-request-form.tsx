"use client";

import { type ReactNode, useState } from "react";
import { Check } from "lucide-react";

type ServiceRequestFormProps = {
  title: string;
  intro: string;
  children: ReactNode;
  review: ReactNode;
  canReview: boolean;
  submitting: boolean;
  error: string;
  submitLabel: string;
  onSubmit: () => Promise<void>;
  onCancel: () => void;
};

export function ServiceRequestForm({
  title,
  intro,
  children,
  review,
  canReview,
  submitting,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}: ServiceRequestFormProps) {
  const [step, setStep] = useState<"details" | "review">("details");
  return (
    <section className="panel customer-request-form">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{intro}</p>
        </div>
      </div>
      <ol className="customer-form-steps" aria-label="Request progress">
        <li className={step === "details" ? "active" : "complete"}>
          {step === "review" ? <Check size={14} /> : "1"} Details
        </li>
        <li className={step === "review" ? "active" : ""}>2 Review & pay</li>
      </ol>
      {error && <div className="error-box">{error}</div>}
      <div className="customer-form-body">
        {step === "details" ? children : review}
      </div>
      <div className="customer-form-actions">
        <button
          className="secondary-button"
          disabled={submitting}
          onClick={step === "review" ? () => setStep("details") : onCancel}
          type="button"
        >
          {step === "review" ? "Back" : "Cancel"}
        </button>
        {step === "details" ? (
          <button
            className="primary-button"
            disabled={!canReview}
            onClick={() => setStep("review")}
            type="button"
          >
            Review request
          </button>
        ) : (
          <button
            aria-busy={submitting}
            className="primary-button"
            data-loading={submitting}
            disabled={submitting}
            onClick={() => void onSubmit()}
            type="button"
          >
            {submitting ? "Opening secure payment..." : submitLabel}
          </button>
        )}
      </div>
    </section>
  );
}
