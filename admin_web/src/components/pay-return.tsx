"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { CheckCircle2, CircleX, Clock3, RefreshCw } from "lucide-react";

import { auth, db, functions } from "@/lib/firebase";
import {
  isCustomerCheckoutOrderType,
  paymentReturnState,
  paymentReturnShouldRedirect,
  type CheckoutReturnConfirmation,
  type CustomerCheckoutOrderType,
  type PaymentReturnState,
} from "@/lib/customer-checkout";
import { SUPPORT_URL } from "@/lib/legal-links";

const PAYMENT_RETURN_TIMEOUT_MS = 60_000;

type ReturnViewState =
  | PaymentReturnState
  | "invalid"
  | "signed-out"
  | "timeout";

function directPaymentPath(
  orderType: CustomerCheckoutOrderType,
  recordId: string,
  uid: string,
): [string, ...string[]] | null {
  switch (orderType) {
    case "parking":
      return ["parkedCars", recordId];
    case "barrelPoolDeposit":
    case "barrelPoolJoin":
      return ["barrelPools", recordId, "participants", uid];
    case "barrelPoolBalance":
      return ["barrelPoolBalanceRequests", recordId];
    case "barrelShipment":
    case "barrelDestinationChange":
      return ["barrelShipments", recordId];
    case "barrelOrder":
      return ["barrelOrders", recordId];
    case "freightShipment":
      return ["freightShipments", recordId];
    case "transportJob":
      return ["transportRequests", recordId];
    case "carDeposit":
    case "carPurchase":
    case "holdExtension":
      return ["carPurchases", recordId];
    case "freightSettlement":
      return null;
  }
}

export function PayReturn() {
  const [state, setState] = useState<ReturnViewState>("pending");
  const [trackingCode, setTrackingCode] = useState("");
  const [params, setParams] = useState<{
    orderType: CustomerCheckoutOrderType;
    recordId: string;
  } | null>(null);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const type = search.get("type") || "";
    const recordId = search.get("id")?.trim() || "";
    const sessionId = search.get("session")?.trim() || "";
    if (!isCustomerCheckoutOrderType(type) || !recordId) {
      setState("invalid");
      return undefined;
    }
    setParams({ orderType: type, recordId });
    if (search.get("status") === "cancel") {
      setState("cancelled");
      return undefined;
    }

    let stopSnapshot: (() => void) | undefined;
    let confirmationStartedFor = "";
    let active = true;
    const timeoutId = setTimeout(
      () => setState((current) => current === "pending" ? "timeout" : current),
      PAYMENT_RETURN_TIMEOUT_MS,
    );
    const stopAuth = onAuthStateChanged(auth, (user) => {
      stopSnapshot?.();
      if (!user) {
        setState("signed-out");
        return;
      }
      setState("pending");
      if (sessionId && confirmationStartedFor !== user.uid) {
        confirmationStartedFor = user.uid;
        // setup=1 is a pay-on-arrival card save: the session verified a
        // card without charging it, and its own completion callable turns
        // that into a booked shipment. Everything else is a payment.
        const isCardSetup = search.get("setup") === "1";
        const confirm = isCardSetup
          ? httpsCallable<
              { shipmentId: string; sessionId: string },
              { success?: boolean }
            >(functions, "completeFreightShipmentCardSave")({
              shipmentId: recordId,
              sessionId,
            }).then((response) => ({
              data: {
                state: response.data?.success ? "success" : "pending",
              } as CheckoutReturnConfirmation,
            }))
          : httpsCallable<
              {
                orderType: CustomerCheckoutOrderType;
                recordId: string;
                sessionId: string;
              },
              CheckoutReturnConfirmation
            >(functions, "confirmCustomerCheckoutSession")({
              orderType: type,
              recordId,
              sessionId,
            });
        void confirm
          .then((response) => {
            if (!active) return;
            const code = String(response.data.trackingCode ?? "").trim();
            if (code) setTrackingCode(code);
            if (response.data.state === "success") setState("success");
          })
          .catch(() => {
            // Keep the authoritative Firestore listener active. A delayed
            // webhook can still complete the order before the safety timeout.
          });
      }
      const path = user.isAnonymous
        ? null
        : directPaymentPath(type, recordId, user.uid);
      if (path) {
        stopSnapshot = onSnapshot(
          doc(db, ...path),
          (snapshot) => {
            if (!snapshot.exists()) {
              setState("invalid");
              return;
            }
            setState(paymentReturnState(type, snapshot.data()));
          },
          () => setState("failed"),
        );
      } else {
        const attemptQuery = query(
          collection(
            db,
            "freightSettlements",
            recordId,
            "paymentAttempts",
          ),
          where("customerUid", "==", user.uid),
          limit(5),
        );
        stopSnapshot = onSnapshot(
          attemptQuery,
          (snapshot) => {
            if (snapshot.empty) return;
            const states = snapshot.docs.map((item) =>
              paymentReturnState(type, item.data()),
            );
            if (states.includes("success")) setState("success");
            else if (states.includes("failed")) setState("failed");
            else if (states.includes("cancelled")) setState("cancelled");
          },
          () => setState("failed"),
        );
      }
    });
    return () => {
      active = false;
      stopAuth();
      stopSnapshot?.();
      clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (!paymentReturnShouldRedirect(state)) return undefined;
    const redirectId = setTimeout(() => {
      window.location.replace("/");
    }, 1_200);
    return () => clearTimeout(redirectId);
  }, [state]);

  const content = returnContent(state);
  // A guest has no workspace, so the success screen hands them the tracking
  // code and points at the public lookup instead of a console they cannot
  // open.
  const guestSuccess = state === "success" && Boolean(trackingCode);
  const Icon = content.icon;
  return (
    <main className="payment-return-screen">
      <section className="login-card payment-return-card" aria-live="polite">
        <div className={`payment-return-icon ${state}`}>
          <Icon className={state === "pending" ? "spin" : ""} size={30} />
        </div>
        <h1>{content.title}</h1>
        <p>{content.body}</p>
        {guestSuccess ? (
          <p className="payment-return-tracking">
            <span>Your tracking number</span>
            <strong>{trackingCode}</strong>
          </p>
        ) : (
          params && <small>Reference: {params.recordId}</small>
        )}
        <div className="button-row">
          {guestSuccess ? (
            <a
              className="primary-button"
              href={`/?service=tracking&code=${encodeURIComponent(
                trackingCode ?? "",
              )}`}
            >
              Track this shipment
            </a>
          ) : (
            <a className="primary-button" href="/">
              Return to customer workspace
            </a>
          )}
          {(state === "failed" || state === "timeout") && (
            <a className="secondary-button" href={SUPPORT_URL}>
              Contact support
            </a>
          )}
        </div>
      </section>
    </main>
  );
}

function returnContent(state: ReturnViewState) {
  switch (state) {
    case "success":
      return {
        icon: CheckCircle2,
        title: "Payment confirmed",
        body: "Your payment was confirmed and your order is up to date.",
      };
    case "failed":
      return {
        icon: CircleX,
        title: "Payment was not completed",
        body: "The payment failed or expired. You can safely try again.",
      };
    case "cancelled":
      return {
        icon: CircleX,
        title: "Payment cancelled",
        body: "You left the secure payment page before completing payment.",
      };
    case "invalid":
      return {
        icon: CircleX,
        title: "Payment link is invalid",
        body: "Open your customer workspace to review your orders.",
      };
    case "signed-out":
      return {
        icon: CircleX,
        title: "Sign in to check payment",
        body: "Use the same Laawol account that started this payment.",
      };
    case "timeout":
      return {
        icon: Clock3,
        title: "Payment confirmation is taking longer",
        body: "Your order is safe. Check it again from your customer workspace.",
      };
    case "pending":
      return {
        icon: RefreshCw,
        title: "Confirming your payment",
        body: "Stripe is securely confirming the payment with Laawol.",
      };
  }
}
