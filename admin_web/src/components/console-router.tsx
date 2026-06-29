"use client";

import { FormEvent, useEffect, useState } from "react";
import { User, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { RefreshCw } from "lucide-react";

import { AdminConsole } from "@/components/admin-console";
import { BusinessConsole } from "@/components/business-console";
import { auth, db } from "@/lib/firebase";
import { useFrenchDomTranslation } from "@/lib/french-dom";
import type { UserProfile } from "@/types/admin";

export function ConsoleRouter() {
  useFrenchDomTranslation();
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [booting, setBooting] = useState(true);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setProfile(null);
      setAuthError("");
      if (!user) {
        setBooting(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!snap.exists()) {
          setAuthError("Your account profile is missing. Contact platform support.");
          return;
        }
        setProfile({id: snap.id, ...snap.data()} as UserProfile);
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : String(error));
      } finally {
        setBooting(false);
      }
    });
  }, []);

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
