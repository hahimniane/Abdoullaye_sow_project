"use client";

import { httpsCallable } from "firebase/functions";

import {
  buildCheckoutRequest,
  checkoutRedirectUrl,
  type CheckoutResult,
  type CustomerCheckoutOrderType,
} from "./customer-checkout.ts";
import { functions } from "./firebase.ts";

const CHECKOUT_START_TIMEOUT_MS = 30_000;

export async function startCheckout(
  orderType: CustomerCheckoutOrderType,
  payload: Record<string, unknown>,
) {
  const callable = httpsCallable<
    ReturnType<typeof buildCheckoutRequest>,
    CheckoutResult
  >(functions, "createCustomerCheckoutSession");
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      callable(buildCheckoutRequest(orderType, payload)),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("The payment request timed out. Try again.")),
          CHECKOUT_START_TIMEOUT_MS,
        );
      }),
    ]);
    const url = checkoutRedirectUrl(
      response.data,
      orderType,
      window.location.origin,
    );
    window.location.assign(url);
    return response.data;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
