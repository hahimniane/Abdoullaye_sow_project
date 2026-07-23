"use client";

import { useEffect, useState } from "react";

import { legalUrlForLanguage } from "@/lib/legal-links";
import {
  currentWebLanguage,
  type SupportedLanguage,
} from "@/lib/language";

type DisclosureCheckboxProps = {
  accepted: boolean;
  onChange: (accepted: boolean) => void;
  variant?: "legal" | "marketplace";
};

export function DisclosureCheckbox({
  accepted,
  onChange,
  variant = "marketplace",
}: DisclosureCheckboxProps) {
  const [language, setLanguage] = useState<SupportedLanguage>("en");
  useEffect(() => setLanguage(currentWebLanguage()), []);
  const isFrench = language === "fr";
  const termsUrl = legalUrlForLanguage("terms", language);
  const privacyUrl = legalUrlForLanguage("privacy", language);

  return (
    <label className="customer-disclosure">
      <input
        checked={accepted}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>
        {variant === "legal" ? (
          <>
            {isFrench ? "J’accepte les " : "I accept the "}
            <a href={termsUrl} rel="noreferrer" target="_blank">
              {isFrench ? "Conditions d’utilisation" : "Terms of Service"}
            </a>
            {isFrench ? " et la " : " and "}
            <a href={privacyUrl} rel="noreferrer" target="_blank">
              {isFrench ? "Politique de confidentialité" : "Privacy Policy"}
            </a>
            .
          </>
        ) : (
          <>
            I understand that the selected business is the independent service
            provider responsible for fulfillment, timing, and performance.
          </>
        )}
      </span>
    </label>
  );
}
