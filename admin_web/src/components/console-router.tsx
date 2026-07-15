"use client";

import { FormEvent, useEffect, useState } from "react";
import { User, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { RefreshCw } from "lucide-react";

import { AdminConsole } from "@/components/admin-console";
import { BusinessConsole } from "@/components/business-console";
import { auth, db } from "@/lib/firebase";
import { useFrenchDomTranslation } from "@/lib/french-dom";
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
  const [booting, setBooting] = useState(true);
  const [authError, setAuthError] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [previewConsole, setPreviewConsole] = useState<"admin" | "business">("admin");
  const [previewStripeState, setPreviewStripeState] = useState<PreviewStripeState>("none");
  const [profileRetry, setProfileRetry] = useState(0);

  useEffect(() => {
    const url = new URL(window.location.href);
    const localPreview =
      url.searchParams.get("preview") === "1" &&
      ["localhost", "127.0.0.1"].includes(window.location.hostname);
    if (localPreview) {
      setPreviewMode(true);
      setPreviewConsole(url.searchParams.get("console") === "business" ? "business" : "admin");
      setPreviewStripeState(resolvePreviewStripeState(url.searchParams.get("stripe")));
      setBooting(false);
      return undefined;
    }
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      setFirebaseUser(user);
      setProfile(null);
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
          setAuthError("Your account profile is missing. Contact Laawol support.");
          return;
        }
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

  if (!firebaseUser || !profile) {
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

  if (profile.role === "admin") {
    return <AdminConsole />;
  }

  if (profile.role === "businessOwner" || profile.role === "staff") {
    return (
      <BusinessConsole
        firebaseUser={firebaseUser}
        profile={profile}
        onSignOut={() => signOut(auth)}
      />
    );
  }

  return (
    <div className="app-shell">
      <RoleSignInCard authError="Cette console est réservée aux administrateurs de la plateforme, aux propriétaires d’entreprise et au personnel d’entreprise." />
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

function RoleSignInCard({authError}: {authError: string}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (signInError) {
      setError(readableAuthError(signInError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="login-screen">
        <div className="login-header">
          <div className="brand-mark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Laawol" width={34} height={34} style={{ borderRadius: 8, display: "block" }} />
          </div>
          <div>
            <h1>Console Laawol Digital</h1>
            <p>Connectez-vous pour gérer la plateforme ou l’espace de votre entreprise.</p>
          </div>
        </div>
        <form className="login-card" onSubmit={submit}>
          <h2>Connexion</h2>
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
          <label>
            Mot de passe
            <input
              autoComplete="current-password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {(error || authError) && <div className="error-box">{error || authError}</div>}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? "Connexion..." : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
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
  return message;
}
