"use client";

import { useEffect, useState } from "react";
import { collectionGroup, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Star, X } from "lucide-react";

import { db, functions } from "@/lib/firebase";

// The `relatedCollection_relatedId` key of every order the current customer
// has already reviewed, so a completed-order card can tell "leave a review"
// from "reviewed" without a per-order read. Mirrors the mobile app's
// BusinessReviewService.reviewedOrderKeysForCurrentUser().
export function useReviewedOrderKeys(uid: string) {
  const [keys, setKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!uid) {
      setKeys(new Set());
      return;
    }
    const unsubscribe = onSnapshot(
      query(collectionGroup(db, "reviews"), where("customerUid", "==", uid)),
      (snapshot) => setKeys(new Set(snapshot.docs.map((doc) => doc.id))),
      () => setKeys(new Set()),
    );
    return unsubscribe;
  }, [uid]);

  return keys;
}

export function ReviewComposerDrawer({
  open,
  businessName,
  orderTitle,
  relatedCollection,
  relatedId,
  businessId,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  businessName: string;
  orderTitle: string;
  relatedCollection: string;
  relatedId: string;
  businessId: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  async function submit() {
    if (rating < 1) {
      setError("Choose a star rating.");
      return;
    }
    if (!comment.trim()) {
      setError("Add a short comment.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await httpsCallable(functions, "submitBusinessReview")({
        relatedCollection,
        relatedId,
        businessId,
        rating,
        comment: comment.trim(),
      });
      onSubmitted();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not submit your review.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-overlay" role="presentation">
      <button
        aria-label="Close review form"
        className="account-backdrop"
        onClick={onClose}
        type="button"
      />
      <aside aria-modal="true" className="account-drawer" role="dialog">
        <div className="account-drawer-head">
          <h2>Leave a review</h2>
          <button
            aria-label="Close review form"
            className="icon-button subtle"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        {businessName && (
          <p style={{ fontWeight: 800, margin: "4px 0 0" }}>{businessName}</p>
        )}
        {orderTitle && (
          <p style={{ color: "var(--muted)", fontSize: 13, margin: "2px 0 0" }}>
            {orderTitle}
          </p>
        )}
        <div style={{ display: "flex", gap: 6, margin: "18px 0" }}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              aria-label={`${value} star${value === 1 ? "" : "s"}`}
              key={value}
              onClick={() => setRating(value)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 2,
              }}
              type="button"
            >
              <Star
                color="#f5a524"
                fill={value <= rating ? "#f5a524" : "none"}
                size={30}
              />
            </button>
          ))}
        </div>
        <textarea
          maxLength={1000}
          onChange={(event) => setComment(event.target.value)}
          placeholder="How was your experience with this business?"
          rows={5}
          value={comment}
        />
        {error && <div className="error-box">{error}</div>}
        <div className="account-drawer-actions">
          <button
            aria-busy={busy}
            className="primary-button"
            data-loading={busy}
            disabled={busy}
            onClick={() => void submit()}
            type="button"
          >
            {busy ? "Submitting..." : "Submit review"}
          </button>
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </aside>
    </div>
  );
}
