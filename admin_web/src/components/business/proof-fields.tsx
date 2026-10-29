"use client";

import { useEffect, useRef } from "react";
import { Camera, Plus, RefreshCw, X } from "lucide-react";

import { useStoragePhotoUrls } from "@/components/business/proof-ticks";
import { uploadPackagePhoto } from "@/lib/package-photo";
import {
  MAX_CONTENTS,
  MAX_CONTENT_LABEL,
  MAX_CONTENT_QUANTITY,
  MAX_PHOTOS,
  MAX_SERIAL,
  contentDraftRowProblems,
  newContentDraft,
  proofDraftProblems,
  proofProblemText,
  type ProofDraft,
  type ProofPhotoDraft,
} from "@/lib/package-proof";

/** Why one photo did not upload, in the request form's words. */
const PHOTO_UPLOAD_ERRORS: Record<string, string> = {
  "not-an-image": "That file is not a photo.",
  "image-unreadable": "That photo could not be read.",
  "image-too-large": "That photo is too large.",
  "no-session": "Sign in again to add photos.",
};
const PHOTO_UPLOAD_FAILED = "One of the photos could not be used. Add it again.";

function photoUploadError(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  return PHOTO_UPLOAD_ERRORS[code] ?? PHOTO_UPLOAD_FAILED;
}

let photoSequence = 0;

/**
 * The proof on a package as staff enter it (docs/AIR_PACKAGES.md §5):
 * photos (the camera on a phone, a file picker on a desktop; compressed and
 * uploaded one by one to the staff member's own folder), what is inside,
 * the weight and the declared value. One editor for the register form, the
 * container line form and the receive-request dialog; the rules live in
 * `lib/package-proof.ts`. Photos already on an edited line show as
 * thumbnails, the server-copied ones (`req/`, `wa/`) included.
 */
export function ProofFields({
  id,
  businessId,
  draft,
  onChange,
  showErrors,
  disabled = false,
  lang,
  photosRequired = false,
}: {
  /** The wrapper's element id: a refused save scrolls here. */
  id: string;
  businessId: string;
  draft: ProofDraft;
  onChange: (next: ProofDraft) => void;
  /** After a refused save, each field shows its own problem, live, until fixed. */
  showErrors: boolean;
  disabled?: boolean;
  lang: "en" | "fr";
  /** The business switched "Photos required at drop-off" on, and this is a counter entry. */
  photosRequired?: boolean;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  // The latest draft, for uploads that finish after other edits.
  const latest = useRef(draft);
  latest.current = draft;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Object URLs of photos chosen here are released when they leave the list.
  const previews = useRef(new Set<string>());
  useEffect(() => {
    const live = new Set(draft.photos.map((photo) => photo.previewUrl).filter(Boolean));
    for (const url of previews.current) {
      if (!live.has(url)) {
        URL.revokeObjectURL(url);
        previews.current.delete(url);
      }
    }
  }, [draft.photos]);
  useEffect(() => () => {
    for (const url of previews.current) URL.revokeObjectURL(url);
  }, []);

  const problems = showErrors ? proofDraftProblems(draft, { photosRequired }) : [];
  const rowProblems = showErrors ? contentDraftRowProblems(draft) : [];
  const storedPaths = draft.photos.filter((photo) => photo.status === "ready" && photo.path && !photo.previewUrl).map((photo) => photo.path);
  const urls = useStoragePhotoUrls(storedPaths);
  const photoProblem = problems.find((p) => p === "photo_required" || p === "photos_uploading");
  const failedPhoto = draft.photos.find((photo) => photo.status === "error");

  function patch(next: Partial<ProofDraft>) {
    onChange({ ...latest.current, ...next });
  }

  function setPhoto(key: string, change: Partial<ProofPhotoDraft>) {
    patch({ photos: latest.current.photos.map((photo) => (photo.key === key ? { ...photo, ...change } : photo)) });
  }

  async function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_PHOTOS - latest.current.photos.filter((photo) => photo.status !== "error").length;
    const chosen = Array.from(files).slice(0, Math.max(0, room));
    const added: ProofPhotoDraft[] = chosen.map((file) => {
      photoSequence += 1;
      const previewUrl = URL.createObjectURL(file);
      previews.current.add(previewUrl);
      return { key: `new-${photoSequence}`, path: "", previewUrl, status: "uploading" as const, error: "" };
    });
    if (added.length === 0) return;
    patch({ photos: [...latest.current.photos, ...added] });
    // One after the other: a phone's upload link is the narrow part.
    for (let i = 0; i < added.length; i += 1) {
      const entry = added[i];
      try {
        const path = await uploadPackagePhoto(businessId, chosen[i]);
        if (mounted.current) setPhoto(entry.key, { path, status: "ready" });
      } catch (error) {
        if (mounted.current) setPhoto(entry.key, { status: "error", error: photoUploadError(error) });
      }
    }
  }

  function removePhoto(key: string) {
    patch({ photos: latest.current.photos.filter((photo) => photo.key !== key) });
  }

  function setItem(key: string, change: Partial<ProofDraft["contents"][number]>) {
    patch({ contents: latest.current.contents.map((item) => (item.key === key ? { ...item, ...change } : item)) });
  }

  const photoCount = draft.photos.filter((photo) => photo.status !== "error").length;
  const problemText = (code: Parameters<typeof proofProblemText>[0]) => <small className="lst-field-error">{proofProblemText(code)}</small>;

  return (
    <div className="prf-fields" id={id} tabIndex={-1}>
      <div className="prf-section">
        <div className="prf-section-head">
          <strong>Photos</strong>
          <small className="lst-hint">{photosRequired ? "At least one photo of the package is required." : "Optional. Up to 5 photos of the package as dropped off."}</small>
        </div>
        <div className="pkr-photos prf-photo-list">
          {draft.photos.map((photo) => {
            const src = photo.previewUrl || urls[photo.path] || "";
            return (
              <figure className={`pkr-photo ${photo.status}`} key={photo.key}>
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="Photo of the package" src={src} />
                ) : (
                  <span className="pkr-photo-state"><RefreshCw className="spin" size={14} aria-hidden="true" /></span>
                )}
                {photo.status === "uploading" && <span className="pkr-photo-state"><RefreshCw className="spin" size={14} aria-hidden="true" /></span>}
                {photo.status === "error" && <span className="pkr-photo-state pkr-photo-error">Not uploaded</span>}
                <button aria-label="Remove photo" className="pkr-photo-remove" disabled={disabled} onClick={() => removePhoto(photo.key)} type="button"><X size={12} aria-hidden="true" /></button>
              </figure>
            );
          })}
          {photoCount < MAX_PHOTOS && (
            <button className="pkr-photo-add" disabled={disabled} onClick={() => fileInput.current?.click()} type="button">
              <Camera size={18} aria-hidden="true" />
              <span>Add photo</span>
            </button>
          )}
          <input
            accept="image/*"
            aria-label="Add photo"
            capture="environment"
            className="sr-only"
            multiple
            onChange={(event) => {
              void addPhotos(event.target.files);
              event.target.value = "";
            }}
            ref={fileInput}
            type="file"
          />
        </div>
        {failedPhoto && <small className="lst-field-error" role="alert">{failedPhoto.error || PHOTO_UPLOAD_FAILED}</small>}
        {photoProblem && problemText(photoProblem)}
      </div>

      <div className="prf-section">
        <div className="prf-section-head">
          <strong>What&apos;s inside</strong>
          <small className="lst-hint">Optional. The sender confirms this list and customs read it.</small>
        </div>
        {draft.contents.length > 0 && (
          <ol className="prf-items">
            {draft.contents.map((item, index) => (
              <li className="prf-item" key={item.key}>
                <label className="lst-field prf-item-label">
                  <span>Item</span>
                  <input
                    aria-invalid={rowProblems[index] ? true : undefined}
                    disabled={disabled}
                    maxLength={MAX_CONTENT_LABEL}
                    onChange={(e) => setItem(item.key, { label: e.target.value })}
                    placeholder="e.g. iPhone 13"
                    value={item.label}
                  />
                </label>
                <label className="lst-field prf-item-qty">
                  <span>Qty</span>
                  <input
                    disabled={disabled}
                    inputMode="numeric"
                    max={MAX_CONTENT_QUANTITY}
                    min={1}
                    onChange={(e) => setItem(item.key, { quantity: e.target.value })}
                    type="number"
                    value={item.quantity}
                  />
                </label>
                <label className="lst-field prf-item-serial">
                  <span>Serial / IMEI</span>
                  <input
                    disabled={disabled}
                    maxLength={MAX_SERIAL}
                    onChange={(e) => setItem(item.key, { serial: e.target.value })}
                    placeholder="optional"
                    value={item.serial}
                  />
                </label>
                <button aria-label="Remove item" className="ghost-button prf-item-remove" disabled={disabled} onClick={() => patch({ contents: latest.current.contents.filter((c) => c.key !== item.key) })} title="Remove item" type="button"><X size={14} /></button>
                {rowProblems[index] && <small className="lst-field-error prf-item-error">{proofProblemText("contents_invalid")}</small>}
              </li>
            ))}
          </ol>
        )}
        {draft.contents.length < MAX_CONTENTS && (
          <button className="lst-btn ghost prf-add-item" disabled={disabled} onClick={() => patch({ contents: [...latest.current.contents, newContentDraft()] })} type="button">
            <Plus size={14} /> Add item
          </button>
        )}
      </div>

      <div className="lst-form-grid prf-measures">
        <label className="lst-field">
          <span>Weight (lb)</span>
          <input
            aria-invalid={problems.includes("weight_invalid") ? true : undefined}
            disabled={disabled}
            inputMode="decimal"
            onChange={(e) => patch({ weightLb: e.target.value })}
            placeholder={lang === "fr" ? "0,0" : "0.0"}
            value={draft.weightLb}
          />
          {problems.includes("weight_invalid") && problemText("weight_invalid")}
        </label>
        <label className="lst-field">
          <span>Declared value ($)</span>
          <input
            aria-invalid={problems.includes("declared_value_invalid") ? true : undefined}
            disabled={disabled}
            inputMode="numeric"
            onChange={(e) => patch({ declaredValue: e.target.value })}
            placeholder="0"
            value={draft.declaredValue}
          />
          <small className="lst-hint">Whole dollars. Never printed on the label.</small>
          {problems.includes("declared_value_invalid") && problemText("declared_value_invalid")}
        </label>
      </div>
    </div>
  );
}
