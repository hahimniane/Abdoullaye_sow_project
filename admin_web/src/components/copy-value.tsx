"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * One tap to copy a value nobody should retype - a 17-character VIN, a
 * customer's name - with the tick as the only confirmation. Inline and small
 * enough to sit inside a table cell; it never steals the row's click.
 */
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const text = String(value ?? "").trim();
  if (!text) return null;
  return (
    <button
      type="button"
      className={`copy-value${copied ? " copied" : ""}`}
      title={copied ? "Copied" : label}
      aria-label={copied ? "Copied" : label}
      onClick={async (event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          /* clipboard blocked: the tick simply does not appear */
        }
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}
