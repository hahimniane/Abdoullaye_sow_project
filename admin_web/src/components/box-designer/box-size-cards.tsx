"use client";

import { useId } from "react";

import { BOX_SIZE_IDS, boxPicture, boxSizeExample, boxSizeLimit, boxSizeName, quotedText, shortMoney, type BoxPrices, type BoxSizeId } from "@/lib/package-box";
import type { Lang } from "@/lib/package-requests";

type Props = {
  value: BoxSizeId;
  onChange: (size: BoxSizeId) => void;
  lang: Lang;
  /** What the chosen business charges (or the lowest while comparing); omit to show no prices. */
  prices?: BoxPrices | null;
  comparing?: boolean;
  disabled?: boolean;
  /** The group's name for screen readers. */
  label: string;
};

/**
 * The four sizes as picture cards (Small, Medium, Large, Extra large), each
 * drawn once beside a sneaker for scale. A radio group: arrow keys and Tab
 * work as in any radio list.
 */
export function BoxSizeCards({ value, onChange, lang, prices, comparing = false, disabled = false, label }: Props) {
  const group = useId();
  return (
    <div aria-label={label} className="bsz" role="radiogroup">
      {BOX_SIZE_IDS.map((id) => {
        const cents = id === "xl" || !prices ? null : prices[id] ?? null;
        const priceText = prices ? (cents !== null ? `${comparing ? (lang === "fr" ? "dès " : "from ") : ""}${shortMoney(cents, lang)}` : null) : null;
        return (
          <label className={`bsz-card${value === id ? " active" : ""}`} key={id}>
            <input checked={value === id} disabled={disabled} name={group} onChange={() => onChange(id)} type="radio" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="" height={96} loading="lazy" src={boxPicture(id)} width={96} />
            <strong data-no-translate>{boxSizeName(id, lang)}</strong>
            <small data-no-translate>{boxSizeExample(id, lang)}</small>
            {id !== "xl" && <small className="bsz-limit" data-no-translate>{boxSizeLimit(id, lang)}</small>}
            {prices && (
              <span className={`bsz-price${priceText ? "" : " quote"}`} data-no-translate>
                {priceText ?? quotedText(lang)}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
