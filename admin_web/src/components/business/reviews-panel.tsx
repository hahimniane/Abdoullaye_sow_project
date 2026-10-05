"use client";

import { useMemo } from "react";
import { RefreshCw, Star } from "lucide-react";

import { LoadMoreButton } from "@/components/show-more";
import { useBusinessReviews } from "@/lib/business-data";
import { formatDate, text } from "@/lib/format";

type ReviewsPanelProps = {
  businessId: string;
  /** The business record: its stored review count and average cover every
   * review, where the list below is paged. */
  business?: Record<string, unknown> | null;
  previewMode?: boolean;
};

function LoadingState() {
  return (
    <div className="empty-state">
      <RefreshCw className="spin" size={16} /> Loading…
    </div>
  );
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          size={14}
          fill={value <= rating ? "#f59e0b" : "none"}
          color="#f59e0b"
        />
      ))}
    </span>
  );
}

function moderationLabel(status: string) {
  if (status === "flagged") return "Flagged";
  if (status === "removed") return "Removed";
  return "Published";
}

export function ReviewsPanel({ businessId, business = null, previewMode = false }: ReviewsPanelProps) {
  const reviews = useBusinessReviews(businessId, Boolean(businessId && !previewMode));

  const visibleRows = useMemo(
    () => reviews.rows.filter((row) => text(row.moderationStatus, "published") !== "removed"),
    [reviews.rows],
  );

  // The server keeps the business's count and average over every published
  // review; the list is paged, so averaging the loaded rows would only
  // describe the newest page. Rows are the fallback for a record that
  // predates the stored aggregate.
  const stats = useMemo(() => {
    const storedCount = Number(business?.reviewCount);
    const storedAverage = Number(business?.reviewAverage);
    if (Number.isFinite(storedCount) && storedCount >= 0 && business?.reviewCount !== undefined) {
      return { count: storedCount, average: Number.isFinite(storedAverage) ? storedAverage : 0 };
    }
    const count = visibleRows.length;
    const sum = visibleRows.reduce((total, row) => total + (Number(row.rating) || 0), 0);
    return { count, average: count > 0 ? sum / count : 0 };
  }, [business?.reviewAverage, business?.reviewCount, visibleRows]);

  return (
    <section className="lst">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>Reviews</h2>
          <p>
            {stats.count === 0
              ? "Customer ratings and comments for completed orders appear here."
              : `${stats.average.toFixed(1)} average · ${stats.count} review${stats.count === 1 ? "" : "s"}`}
          </p>
        </div>
      </header>

      {reviews.error && <div className="error-box">{reviews.error}</div>}
      {reviews.loading && <LoadingState />}
      {!reviews.loading && visibleRows.length === 0 && (
        <div className="lst-empty">
          <div className="lst-empty-icon">
            <Star size={30} />
          </div>
          <h3>No reviews yet</h3>
          <p>Customers can leave a review once you mark their order completed.</p>
        </div>
      )}

      <div className="pur-grid">
        {visibleRows.map((row) => (
          <article key={row.id} className="pur-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <StarRow rating={Number(row.rating) || 0} />
              <span className="status-pill compact">{moderationLabel(text(row.moderationStatus, "published"))}</span>
            </div>
            {text(row.comment) && <p style={{ marginTop: 8 }}>{text(row.comment)}</p>}
            <p style={{ marginTop: 4, color: "var(--muted)", fontSize: 13 }}>
              {text(row.customerDisplayName, "Customer")} · {text(row.orderType)} · {formatDate(row.createdAt)}
              {Number(row.flagCount) > 0 ? ` · ${row.flagCount} flag${row.flagCount === 1 ? "" : "s"}` : ""}
            </p>
          </article>
        ))}
      </div>
      <LoadMoreButton hasMore={reviews.hasMore} loading={reviews.loadingMore} onLoadMore={reviews.loadMore} />
    </section>
  );
}
