"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  User,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { doc, getDoc } from "firebase/firestore";
import { MailCheck, RefreshCw, Send, ShieldCheck } from "lucide-react";

import { AdminConsole } from "@/components/admin-console";
import { BusinessConsole } from "@/components/business-console";
import { CustomerConsole } from "@/components/customer-console";
import { CustomerServiceEntry } from "@/components/customer-service-entry";
import { DisclosureCheckbox } from "@/components/disclosure-checkbox";
import { CustomerPhoneField } from "@/components/customer-phone-field";
import { resolveConsoleKind } from "@/lib/console-routing";
import { customerServiceFromSearch } from "@/lib/customer-service-intent";
import { legalAcceptance } from "@/lib/disclosures";
import { auth, db, functions } from "@/lib/firebase";
import { useFrenchDomTranslation } from "@/lib/french-dom";
import { isValidPhone } from "@/lib/phone";
import type { FirestoreRow, UserProfile } from "@/types/admin";

const previewBusinessUser = {
  uid: "business-preview",
  email: "owner@atlanticexports.com",
} as User;

const previewBusinessProfile: UserProfile = {
  id: "business-preview",
  role: "businessOwner",
  fullName: "Atlantic Owner",
  email: "owner@atlanticexports.com",
  businessId: "atlantic_exports",
  businessName: "Atlantic Exports",
  businessServices: [
    "barrelShipping",
    "sharedBarrels",
    "freight",
    "carSales",
    "carTransport",
    "carParking",
  ],
};

const previewBusiness: FirestoreRow = {
  id: "atlantic_exports",
  name: "Atlantic Exports",
  phone: "+1 201 555 0120",
  email: "owner@atlanticexports.com",
  website: "https://atlanticexports.example.com",
  serviceNote: "Vehicle and shipping services for West Africa.",
  status: "changes_requested",
  enabledServices: [
    "barrelShipping",
    "sharedBarrels",
    "freight",
    "carSales",
    "carTransport",
    "carParking",
  ],
  addressLine1: "410 East 138th Street",
  city: "Bronx",
  country: "United States",
  state: "NY",
  carHoldPricingMode: "flat",
  carHoldFlatFee: 500,
  carHoldDailyRate: 100,
  carHoldMaxDays: 14,
  freightPickupAvailable: true,
  freightPickupModel: "borough",
  freightPickupBoroughPrices: {
    Bronx: 40,
    Brooklyn: 55,
    Manhattan: 50,
    Queens: 55,
    "Staten Island": 65,
  },
  parkingAddressLine1: "410 East 138th Street",
  parkingCity: "Bronx",
  parkingCountry: "United States",
  parkingState: "NY",
  parkingTotalSpaces: 48,
  parkingBlockedSpaces: 4,
  parkingDailyRate: 25,
  parkingWeeklyRate: 150,
  parkingMonthlyRate: 525,
  parkingMinimumDays: 2,
  parkingPickupAvailable: true,
  parkingPickupFee: 45,
  parkingInstructions: "Use the freight entrance on 139th Street.",
  stripeAccountId: "acct_atlantic_pending",
  chargesEnabled: false,
  payoutsEnabled: false,
  stripeRequirements: {
    currentlyDue: ["external_account", "business_profile.url"],
    pastDue: [],
    pendingVerification: [],
    disabledReason: "requirements.pending_verification",
  },
  verificationDocuments: {
    shippingAuthority: {
      fileName: "Warehouse agreement.pdf",
      url: "https://example.com/warehouse.pdf",
      status: "needs_changes",
    },
  },
  verificationReview: {
    note: "Complete Stripe updates in Stripe. Laawol only needs current freight or warehouse authority here.",
    documents: {
      shippingAuthority: {
        status: "needs_changes",
        note: "Upload a current agreement or freight-forwarder authority.",
      },
    },
  },
};

const PROFILE_LOAD_TIMEOUT_MS = 15_000;

async function loadProfile(uid: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getDoc(doc(db, "users", uid)),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("profile-load-timeout")),
          PROFILE_LOAD_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

type PreviewStripeState = "none" | "pending" | "ready";

function resolvePreviewStripeState(value: string | null): PreviewStripeState {
  if (value === "pending" || value === "ready") return value;
  return "none";
}

function businessForPreviewStripeState(state: PreviewStripeState): FirestoreRow {
  if (state === "ready") {
    return {
      ...previewBusiness,
      status: "approved",
      stripeAccountId: "acct_atlantic_ready",
      chargesEnabled: true,
      payoutsEnabled: true,
      stripeRequirements: {
        currentlyDue: [],
        pastDue: [],
        pendingVerification: [],
        disabledReason: "",
      },
    };
  }

  if (state === "pending") return previewBusiness;

  return {
    ...previewBusiness,
    stripeAccountId: "",
    chargesEnabled: false,
    payoutsEnabled: false,
    stripeRequirements: {
      currentlyDue: [],
      pastDue: [],
      pendingVerification: [],
      disabledReason: "requirements.pending_verification",
    },
  };
}

export function ConsoleRouter() {
  useFrenchDomTranslation();
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileMissing, setProfileMissing] = useState(false);
  const [booting, setBooting] = useState(true);
  const [authError, setAuthError] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [previewConsole, setPreviewConsole] = useState<"admin" | "business">("admin");
  const [previewStripeState, setPreviewStripeState] = useState<PreviewStripeState>("none");
  const [profileRetry, setProfileRetry] = useState(0);
  const [serviceIntent, setServiceIntent] = useState(
    null as ReturnType<typeof customerServiceFromSearch>,
  );

  useEffect(() => {
    setServiceIntent(customerServiceFromSearch(window.location.search));
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const localPreview =
      url.searchParams.get("preview") === "1" &&
      ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (localPreview) {
      setPreviewMode(true);
      const requestedConsole = url.searchParams.get("console");
      setPreviewConsole(requestedConsole === "business" ? "business" : "admin");
      setPreviewStripeState(resolvePreviewStripeState(url.searchParams.get("stripe")));
      setBooting(false);
      return undefined;
    }
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      setFirebaseUser(user);
      setProfile(null);
      setProfileMissing(false);
      setAuthError("");
      if (!user) {
        setBooting(false);
        return;
      }
      setBooting(true);
      try {
        const snap = await loadProfile(user.uid);
        if (!active) return;
        if (!snap.exists()) {
          setProfileMissing(true);
          return;
        }
        setProfileMissing(false);
        setProfile({id: snap.id, ...snap.data()} as UserProfile);
      } catch {
        if (!active) return;
        setAuthError("The connection is slow. We could not safely load your account role.");
      } finally {
        if (active) setBooting(false);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [profileRetry]);

  if (previewMode) {
    if (previewConsole === "business") {
      return (
        <BusinessConsole
          firebaseUser={previewBusinessUser}
          profile={previewBusinessProfile}
          previewBusiness={businessForPreviewStripeState(previewStripeState)}
          onSignOut={() => setPreviewMode(false)}
        />
      );
    }
    return <AdminConsole />;
  }

  const resolvedKind = profile ? resolveConsoleKind(profile.role) : null;
  if (
    serviceIntent &&
    (!profile || resolvedKind === "customer")
  ) {
    return (
      <CustomerServiceEntry
        authenticated={Boolean(firebaseUser && profile)}
        authenticating={booting && Boolean(firebaseUser)}
        authPanel={(initialMode) => (
          <RoleSignInCard
            authError={authError}
            embedded
            initialMode={initialMode}
            key={initialMode}
          />
        )}
        firebaseUser={firebaseUser}
        initialService={serviceIntent}
        profile={
          profile ?? {
            id: "guest",
            role: "customer",
          }
        }
      />
    );
  }

  if (booting) {
    return (
      <div className="app-shell">
        <div className="center-panel">
          <RefreshCw className="spin" size={28} />
          <p>Ouverture de la console...</p>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !profile) {
    if (firebaseUser && profileMissing) {
      return (
        <AccessInvitationSetup
          firebaseUser={firebaseUser}
          onActivated={() => setProfileRetry((value) => value + 1)}
          onSignOut={() => signOut(auth)}
        />
      );
    }
    if (firebaseUser && authError) {
      return (
        <ConsoleLoadError
          message={authError}
          onRetry={() => setProfileRetry((value) => value + 1)}
          onSignOut={() => signOut(auth)}
        />
      );
    }
    return <RoleSignInCard authError={authError} />;
  }

  const consoleKind = resolveConsoleKind(profile.role);

  if (consoleKind === "admin") {
    return <AdminConsole />;
  }

  if (consoleKind === "business") {
    return (
      <BusinessConsole
        firebaseUser={firebaseUser}
        profile={profile}
        onSignOut={() => signOut(auth)}
      />
    );
  }

  if (consoleKind === "customer") {
    return (
      <CustomerConsole
        firebaseUser={firebaseUser}
        profile={profile}
        onSignOut={() => signOut(auth)}
      />
    );
  }

  return (
    <div className="app-shell">
      <RoleSignInCard authError="This account role is not supported. Contact Laawol support." />
    </div>
  );
}

function accessActivationError(error: unknown) {
  const record =
    error && typeof error === "object"
      ? (error as {
          code?: unknown;
          details?: {reason?: unknown};
        })
      : {};
  const value = String(record.code ?? "");
  const reason = String(record.details?.reason ?? "");
  if (value === "auth/too-many-requests") {
    return "Too many verification emails were requested. Wait a few minutes and try again.";
  }
  if (value === "auth/network-request-failed" || value === "functions/unavailable") {
    return "The access service could not be reached. Check your connection and try again.";
  }
  if (
    value === "functions/not-found" ||
    reason === "active-invitation-not-found"
  ) {
    return "No active invitation was found for this account. Ask the sender to resend it.";
  }
  if (reason === "invitation-selection-required") {
    return "More than one active invitation was found. Ask Laawol support to choose the correct access.";
  }
  if (
    reason === "invitation-expired" ||
    reason === "invitation-not-pending"
  ) {
    return "This invitation has expired or was cancelled. Ask the sender to resend it.";
  }
  if (
    value === "functions/failed-precondition" ||
    reason === "verified-email-required"
  ) {
    return "This invitation cannot be activated yet. Ask the sender to resend it.";
  }
  return "We could not activate this invitation. Try again or ask the sender to resend it.";
}

function AccessInvitationSetup({
  firebaseUser,
  onActivated,
  onSignOut,
}: {
  firebaseUser: User;
  onActivated: () => void;
  onSignOut: () => void;
}) {
  const [emailVerified, setEmailVerified] = useState(
    firebaseUser.emailVerified,
  );
  const [busy, setBusy] = useState<"" | "sending" | "activating">("");
  const [verificationCooldown, setVerificationCooldown] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const activationInFlight = useRef(false);

  useEffect(() => {
    if (!verificationCooldown) return undefined;
    const timer = window.setTimeout(
      () => setVerificationCooldown(false),
      60_000,
    );
    return () => window.clearTimeout(timer);
  }, [verificationCooldown]);

  async function sendVerification() {
    if (busy || verificationCooldown) return;
    setBusy("sending");
    setNotice("");
    setError("");
    try {
      auth.languageCode = document.documentElement.lang.startsWith("fr")
        ? "fr"
        : "en";
      await sendEmailVerification(auth.currentUser ?? firebaseUser);
      setVerificationCooldown(true);
      setNotice(
        "Verification email sent. Open the link, then return here to continue.",
      );
    } catch (sendError) {
      setError(accessActivationError(sendError));
    } finally {
      setBusy("");
    }
  }

  async function activateInvitation() {
    if (busy || activationInFlight.current) return;
    activationInFlight.current = true;
    setBusy("activating");
    setNotice("");
    setError("");
    try {
      const currentUser = auth.currentUser ?? firebaseUser;
      await currentUser.reload();
      const refreshedUser = auth.currentUser ?? currentUser;
      if (refreshedUser.uid !== firebaseUser.uid) {
        throw new Error("invitation-auth-user-changed");
      }
      const verified = refreshedUser.emailVerified === true;
      setEmailVerified(verified);
      if (!verified) {
        setNotice(
          "Firebase has not confirmed the email yet. Open the verification link, then try again.",
        );
        return;
      }
      await refreshedUser.getIdToken(true);
      await httpsCallable(functions, "acceptAccessInvitation")({});
      onActivated();
    } catch (activationError) {
      try {
        const recoveredProfile = await loadProfile(firebaseUser.uid);
        if (recoveredProfile.exists()) {
          onActivated();
          return;
        }
      } catch {
        // Preserve the original activation error when recovery cannot confirm
        // that a concurrent attempt already created the profile.
      }
      setError(accessActivationError(activationError));
    } finally {
      activationInFlight.current = false;
      setBusy("");
    }
  }

  return (
    <div className="app-shell">
      <main className="access-activation-screen">
        <section
          aria-labelledby="access-activation-title"
          className="access-activation-card"
        >
          <div className="access-activation-mark" aria-hidden="true">
            {emailVerified ? <ShieldCheck size={28} /> : <MailCheck size={28} />}
          </div>
          <div className="access-activation-copy">
            <span>Invitation security</span>
            <h1 id="access-activation-title">Finish setting up your access</h1>
            <p>
              Your password is ready. Verify the invited email, then Laawol
              will activate the platform or business role assigned to you.
            </p>
            <strong>{firebaseUser.email}</strong>
          </div>
          <ol className="access-activation-steps">
            <li className="complete">
              <span>1</span>
              <div>
                <strong>Password created</strong>
                <small>Your password is never shared with the inviter.</small>
              </div>
            </li>
            <li className={emailVerified ? "complete" : ""}>
              <span>2</span>
              <div>
                <strong>Verify invited email</strong>
                <small>
                  This confirms the invitation belongs to the signed-in person.
                </small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Activate assigned access</strong>
                <small>Laawol opens the correct workspace and permissions.</small>
              </div>
            </li>
          </ol>
          {notice && <div className="info-band" role="status">{notice}</div>}
          {error && <div className="error-box" role="alert">{error}</div>}
          <div className="access-activation-actions">
            {!emailVerified && (
              <button
                className="secondary-button"
                disabled={Boolean(busy) || verificationCooldown}
                onClick={sendVerification}
                type="button"
              >
                {busy === "sending" ? (
                  <RefreshCw className="spin" size={16} />
                ) : (
                  <Send size={16} />
                )}
                {busy === "sending"
                  ? "Sending verification email..."
                  : verificationCooldown
                    ? "Verification email sent"
                    : "Send verification email"}
              </button>
            )}
            <button
              className="primary-button"
              disabled={Boolean(busy)}
              onClick={activateInvitation}
              type="button"
            >
              {busy === "activating" && (
                <RefreshCw className="spin" size={16} />
              )}
              {busy === "activating"
                ? "Activating access..."
                : emailVerified
                  ? "Activate my access"
                  : "I verified — continue"}
            </button>
          </div>
          <button className="text-button" onClick={onSignOut} type="button">
            Sign out and use another account
          </button>
        </section>
      </main>
    </div>
  );
}

function ConsoleLoadError({
  message,
  onRetry,
  onSignOut,
}: {
  message: string;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="app-shell">
      <div className="center-panel">
        <h2>We could not open your console</h2>
        <p>{message}</p>
        <p>Retry without signing out or losing your session.</p>
        <div className="button-row">
          <button className="primary-button" type="button" onClick={onRetry}>
            <RefreshCw size={16} /> Retry
          </button>
          <button className="secondary-button" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function RoleSignInCard({
  authError,
  embedded = false,
  initialMode = "sign-in",
}: {
  authError: string;
  embedded?: boolean;
  initialMode?: "sign-in" | "sign-up";
}) {
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "forgot">(
    initialMode,
  );
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      if (mode === "forgot") {
        await sendPasswordResetEmail(auth, email.trim());
        setNotice("Password reset email sent. Check your inbox.");
        return;
      }
      if (mode === "sign-up") {
        if (!isValidPhone(phone)) {
          throw new Error("Enter a valid phone number with 7 to 15 digits.");
        }
        if (!accepted) {
          throw new Error("Accept the terms and privacy policy to continue.");
        }
        await httpsCallable(functions, "createCustomerUser")({
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          phone: phone.trim(),
          legalAcceptance: legalAcceptance(),
        });
        const credential = await signInWithEmailAndPassword(
          auth,
          email.trim(),
          password,
        );
        if (!credential.user.emailVerified) {
          await sendEmailVerification(credential.user);
        }
        return;
      }
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (authActionError) {
      setError(readableAuthError(authActionError));
    } finally {
      setSubmitting(false);
    }
  }

  const screen = (
      <div className={`login-screen ${embedded ? "login-screen-embedded" : ""}`}>
        <div className="login-header">
          <div className="brand-mark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Laawol" width={34} height={34} style={{ borderRadius: 8, display: "block" }} />
          </div>
          <div>
            <h1>Laawol Digital</h1>
            <p>Sign in to open your customer, business, or platform workspace.</p>
          </div>
        </div>
        <form className="login-card" onSubmit={submit}>
          <div className="auth-mode-tabs" aria-label="Account access">
            <button
              className={mode === "sign-in" ? "active" : ""}
              onClick={() => {
                setMode("sign-in");
                setError("");
                setNotice("");
              }}
              type="button"
            >
              Sign in
            </button>
            <button
              className={mode === "sign-up" ? "active" : ""}
              onClick={() => {
                setMode("sign-up");
                setError("");
                setNotice("");
              }}
              type="button"
            >
              Create account
            </button>
          </div>
          <h2>
            {mode === "sign-up"
              ? "Create your customer account"
              : mode === "forgot"
                ? "Reset your password"
                : "Sign in"}
          </h2>
          {mode === "sign-up" && (
            <label>
              Full name
              <input
                autoComplete="name"
                required
                type="text"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
            </label>
          )}
          <label>
            Email
            <input
              autoComplete="email"
              inputMode="email"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {mode !== "forgot" && (
            <label>
              Password
              <input
                autoComplete={
                  mode === "sign-up" ? "new-password" : "current-password"
                }
                minLength={6}
                required
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          )}
          {mode === "sign-up" && (
            <>
              <CustomerPhoneField
                id="signup-phone"
                label="Phone number"
                onChange={setPhone}
                required
                value={phone}
              />
              <DisclosureCheckbox
                accepted={accepted}
                onChange={setAccepted}
                variant="legal"
              />
            </>
          )}
          {(error || authError) && <div className="error-box">{error || authError}</div>}
          {notice && <div className="info-band">{notice}</div>}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting
              ? "Please wait..."
              : mode === "sign-up"
                ? "Create account"
                : mode === "forgot"
                  ? "Send reset email"
                  : "Sign in"}
          </button>
          {mode === "sign-in" && (
            <button
              className="text-button"
              onClick={() => {
                setMode("forgot");
                setError("");
                setNotice("");
              }}
              type="button"
            >
              Forgot password?
            </button>
          )}
          {mode === "forgot" && (
            <button
              className="text-button"
              onClick={() => {
                setMode("sign-in");
                setError("");
                setNotice("");
              }}
              type="button"
            >
              Back to sign in
            </button>
          )}
        </form>
      </div>
  );
  return embedded ? screen : <div className="app-shell">{screen}</div>;
}

function readableAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("auth/invalid-credential") ||
    message.includes("auth/wrong-password") ||
    message.includes("auth/user-not-found")
  ) {
    return "Email or password is incorrect.";
  }
  if (message.includes("auth/too-many-requests")) {
    return "Too many attempts. Try again later.";
  }
  if (message.includes("auth/network-request-failed")) {
    return "Network error. Check your connection and try again.";
  }
  if (
    message.includes("already-exists") ||
    message.includes("email-already-exists")
  ) {
    return "An account already exists with this email. Sign in instead.";
  }
  if (
    message.includes("invalid-argument") ||
    message.includes("invalid-email")
  ) {
    return "Check the information you entered and try again.";
  }
  if (message.includes("resource-exhausted")) {
    return "Too many attempts. Wait a moment and try again.";
  }
  if (error instanceof Error && !message.includes("Firebase")) return message;
  return "We could not complete this request. Try again.";
}
