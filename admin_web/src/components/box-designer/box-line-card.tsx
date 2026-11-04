"use client";

import { useState } from "react";
import { Ruler, Trash2 } from "lucide-react";

import { BoxDesigner } from "@/components/box-designer/box-designer";
import { BoxSizeCards } from "@/components/box-designer/box-size-cards";
import { QuantityStepper } from "@/components/quantity-stepper";
import { RequestPhotoStrip } from "@/components/request-photo-strip";
import { BOX_PHOTO_LIMIT, boxLineSize, pickBoxSize, setBoxDims, setBoxQuantity, typicalDims, type BoxLine, type BoxPrices } from "@/lib/package-box";
import type { Lang } from "@/lib/package-requests";

type Props = {
  line: BoxLine;
  lang: Lang;
  /** The chosen business's prices, or the lowest per size while comparing. */
  prices: BoxPrices | null;
  comparing: boolean;
  disabled?: boolean;
  onChange: (next: BoxLine) => void;
  onRemove: () => void;
  onAddPhotos: (files: FileList | null) => void;
  onRemovePhoto: (photoKey: string) => void;
};

/**
 * One box on the Send a package form (Sea): size picture cards and a
 * quantity, "Know the inches?" which opens the 3D designer (the size follows
 * the inches), and up to 3 optional photos. Typed inches always win over the
 * card that was tapped; tapping a card forgets the inches.
 */
export function BoxLineCard({ line, lang, prices, comparing, disabled = false, onChange, onRemove, onAddPhotos, onRemovePhoto }: Props) {
  const [open, setOpen] = useState(() => line.dims !== null);
  const size = boxLineSize(line);
  return (
    <article className="pkr-piece pkr-box-line">
      <header>
        <span className="pkr-item-name">
          <strong>Box</strong>
          <small>Pick the closest size. Know the inches? The size follows them.</small>
        </span>
        <button aria-label="Remove this piece" className="icon-button" disabled={disabled} onClick={onRemove} type="button">
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </header>
      <BoxSizeCards
        comparing={comparing}
        disabled={disabled}
        label="Box size"
        lang={lang}
        onChange={(next) => {
          setOpen(false);
          onChange(pickBoxSize(line, next));
        }}
        prices={prices}
        value={size}
      />
      <div className="pkr-box-qty">
        <span>How many of this size?</span>
        <QuantityStepper label="How many boxes" min={1} onChange={(n) => onChange(setBoxQuantity(line, n))} value={line.quantity} />
      </div>
      {!open ? (
        <button
          className="secondary-button pkr-add"
          disabled={disabled}
          onClick={() => {
            setOpen(true);
            if (!line.dims) onChange(setBoxDims(line, typicalDims(size)));
          }}
          type="button"
        >
          <Ruler size={16} aria-hidden="true" /> Know the inches?
        </button>
      ) : (
        <div className="pkr-group">
          <BoxDesigner comparing={comparing} dims={line.dims ?? typicalDims(size)} lang={lang} onChange={(dims) => onChange(setBoxDims(line, dims))} prices={prices} size={size} />
          <button
            className="text-button"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onChange(setBoxDims(line, null));
            }}
            type="button"
          >
            I do not know the inches
          </button>
        </div>
      )}
      <RequestPhotoStrip
        disabled={disabled}
        hint="Optional, up to 3 photos. Only the business sees them."
        limit={BOX_PHOTO_LIMIT}
        onAdd={onAddPhotos}
        onRemove={onRemovePhoto}
        photos={line.photos}
      />
    </article>
  );
}
