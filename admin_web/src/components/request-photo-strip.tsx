"use client";

import { useRef } from "react";
import { Camera, X } from "lucide-react";

import type { PhotoDraft } from "@/lib/package-requests";

type Props = {
  photos: PhotoDraft[];
  limit: number;
  disabled?: boolean;
  onAdd: (files: FileList | null) => void;
  onRemove: (photoKey: string) => void;
  /** The line under the photos ("Optional, up to 3 photos. Only the business sees them."). */
  hint: string;
};

/**
 * The photos of one piece on the request form: thumbnails with a remove
 * button, "Add photos" until `limit`, and a hint. The files stay on the device
 * until Send (the form uploads them to the chosen business's folder).
 */
export function RequestPhotoStrip({ photos, limit, disabled = false, onAdd, onRemove, hint }: Props) {
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <div className="pkr-photos">
        {photos.map((photo) => (
          <figure className={`pkr-photo ${photo.status}`} key={photo.key}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="Photo of the piece" src={photo.previewUrl} />
            {photo.status === "error" && <span className="pkr-photo-state pkr-photo-error">Not uploaded</span>}
            <button aria-label="Remove photo" className="pkr-photo-remove" disabled={disabled} onClick={() => onRemove(photo.key)} type="button">
              <X size={12} aria-hidden="true" />
            </button>
          </figure>
        ))}
        {photos.length < limit && (
          <button className="pkr-photo-add" disabled={disabled} onClick={() => input.current?.click()} type="button">
            <Camera size={18} aria-hidden="true" />
            <span>Add photos</span>
          </button>
        )}
        <input
          accept="image/*"
          aria-label="Add photos"
          className="sr-only"
          multiple
          onChange={(event) => {
            onAdd(event.target.files);
            event.target.value = "";
          }}
          ref={input}
          tabIndex={-1}
          type="file"
        />
      </div>
      <small className="pkr-hint">{hint}</small>
    </>
  );
}
