"use client";

import { type ReactNode, useEffect, useState } from "react";
import { ArrowLeft, LogIn, ShieldCheck, X } from "lucide-react";
import type { User } from "firebase/auth";

import { CustomerCars } from "@/components/customer-cars";
import { usePublicCars } from "@/components/customer-console";
import { CustomerParkingPools } from "@/components/customer-parking-pools";
import { CustomerShippingServices } from "@/components/customer-shipping-services";
import type { CustomerService } from "@/lib/customer-service-intent";
import type { UserProfile } from "@/types/admin";

type CustomerServiceEntryProps = {
  authenticated: boolean;
  authenticating: boolean;
  authPanel: (initialMode: "sign-in" | "sign-up") => ReactNode;
  firebaseUser?: User | null;
  initialService: CustomerService;
  profile: UserProfile;
};

export function CustomerServiceEntry({
  authenticated,
  authenticating,
  authPanel,
  firebaseUser,
  initialService,
  profile,
}: CustomerServiceEntryProps) {
  const [authIntent, setAuthIntent] = useState<
    "account-access" | "service-continuation" | null
  >(null);
  const [continuedAfterAuth, setContinuedAfterAuth] = useState(false);
  const authOpen = authIntent !== null;
  const cars = usePublicCars(initialService === "cars");
  const shippingService:
    | "barrel"
    | "freight"
    | "transport"
    | null =
    initialService === "barrel" || initialService === "freight"
      ? initialService
      : initialService === "car-transport"
        ? "transport"
        : null;
  const authLabel =
    initialService === "cars"
      ? "Save your car request"
      : initialService === "parking"
        ? "Save your parking request"
        : initialService === "shared-barrels"
          ? "Save your shared-barrel request"
          : initialService === "car-transport"
            ? "Save your car transport request"
            : initialService === "barrel"
              ? "Save your barrel request"
              : "Save your freight request";

  useEffect(() => {
    if (!authenticated || !authOpen) return;
    setAuthIntent(null);
    setContinuedAfterAuth(true);
  }, [authOpen, authenticated]);

  return (
    <div className="customer-entry-shell">
      <header className="customer-entry-header">
        <a className="customer-entry-brand" href="https://laawoldigital.com">
          <span className="brand-badge">Laawol Digital</span>
          <span>
            <strong>Prepare your service request</strong>
            <small>Compare first. Create an account only when you continue.</small>
          </span>
        </a>
        <div className="customer-entry-header-actions">
          <a className="text-button" href="https://laawoldigital.com/services.html">
            <ArrowLeft aria-hidden="true" size={16} />
            Explore services
          </a>
          {authenticated ? (
            <a className="secondary-button" href="/">
              Open my workspace
            </a>
          ) : (
            <button
              className="secondary-button"
              onClick={() => setAuthIntent("account-access")}
              type="button"
            >
              <LogIn aria-hidden="true" size={16} />
              Sign in
            </button>
          )}
        </div>
      </header>

      <main className="customer-entry-main">
        <div className="customer-entry-assurance">
          <ShieldCheck aria-hidden="true" size={20} />
          <div>
            <strong>No account needed to compare options and prepare your request.</strong>
            <span>
              Sign in or create a free account only when you are ready to save
              and continue.
            </span>
          </div>
        </div>
        {continuedAfterAuth && (
          <div className="info-band" role="status">
            Your request is ready to continue.
          </div>
        )}
        {shippingService && (
          <CustomerShippingServices
            authenticated={authenticated}
            initialService={shippingService}
            onAuthenticationRequired={() =>
              setAuthIntent("service-continuation")
            }
            profile={profile}
          />
        )}
        {["parking", "shared-barrels"].includes(initialService) && (
          <CustomerParkingPools
            authenticated={authenticated}
            firebaseUser={firebaseUser}
            initialArea={
              initialService === "shared-barrels" ? "pools" : "parking"
            }
            onAuthenticationRequired={() =>
              setAuthIntent("service-continuation")
            }
            profile={profile}
          />
        )}
        {initialService === "cars" && (
          <CustomerCars
            authenticated={authenticated}
            firebaseUser={firebaseUser}
            onAuthenticationRequired={() =>
              setAuthIntent("service-continuation")
            }
            profile={profile}
            state={cars}
          />
        )}
      </main>

      {authOpen && (
        <div
          aria-labelledby="customer-auth-title"
          aria-modal="true"
          className="customer-auth-overlay"
          role="dialog"
        >
          <div className="customer-auth-sheet">
            <div className="customer-auth-context">
              <div>
                <span className="customer-service-kicker">Almost there</span>
                <h2 id="customer-auth-title">
                  {authIntent === "account-access"
                    ? "Access your Laawol account"
                    : authLabel}
                </h2>
                {authIntent === "account-access" ? (
                  <p>
                    Sign in to open your workspace, or create an account if you
                    are new to Laawol.
                  </p>
                ) : (
                  <p>
                    Sign in or create a free account to save this request and
                    continue. Your details will stay here.
                  </p>
                )}
              </div>
              <button
                aria-label="Close account access"
                className="icon-button"
                disabled={authenticating}
                onClick={() => setAuthIntent(null)}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            {authenticating ? (
              <div className="customer-auth-progress" role="status">
                <span className="loading-spinner" />
                Securing your account and restoring the request...
              </div>
            ) : (
              authPanel(
                authIntent === "account-access" ? "sign-in" : "sign-up",
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
