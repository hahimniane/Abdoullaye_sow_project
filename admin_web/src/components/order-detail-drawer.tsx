"use client";

import { type ReactNode, useState } from "react";
import { X } from "lucide-react";

type OrderDetailDrawerProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  cancelLabel?: string;
  onCancelOrder?: () => Promise<void>;
  onClose: () => void;
};

export function OrderDetailDrawer({
  open,
  title,
  children,
  cancelLabel = "Cancel request",
  onCancelOrder,
  onClose,
}: OrderDetailDrawerProps) {
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  if (!open) return null;

  async function cancelOrder() {
    if (!onCancelOrder || cancelling) return;
    setCancelling(true);
    setError("");
    try {
      await onCancelOrder();
      onClose();
    } catch {
      setError("The request could not be cancelled. Try again.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="account-overlay" role="presentation">
      <button
        aria-label="Close order details"
        className="account-backdrop"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-modal="true"
        className="account-drawer customer-order-drawer"
        role="dialog"
      >
        <div className="account-drawer-head">
          <h2>{title}</h2>
          <button
            aria-label="Close order details"
            className="icon-button subtle"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        {error && <div className="error-box">{error}</div>}
        <div className="customer-order-detail">{children}</div>
        <div className="account-drawer-actions">
          {onCancelOrder && (
            <button
              aria-busy={cancelling}
              className="danger-button"
              data-loading={cancelling}
              disabled={cancelling}
              onClick={() => void cancelOrder()}
              type="button"
            >
              {cancelling ? "Cancelling..." : cancelLabel}
            </button>
          )}
          <button className="secondary-button" onClick={onClose} type="button">
            Close
          </button>
        </div>
      </aside>
    </div>
  );
}
