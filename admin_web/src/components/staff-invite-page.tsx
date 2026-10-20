"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { signOut, type User } from "firebase/auth";
import { LogIn, LogOut, RefreshCw, UserPlus } from "lucide-react";

import { PhoneSignIn } from "@/components/phone-sign-in";
import { auth } from "@/lib/firebase";
import { phoneRefusalOf, withTimeout } from "@/lib/phone-accounts";
import { acceptStaffInvitation, getStaffInvitePreview } from "@/lib/phone-accounts-client";
import {
  STAFF_INVITE_CLOSED_COPY,
  STAFF_INVITE_PAGE_COPY as COPY,
  acceptRefusalMessage,
  staffInviteTokenFromLocation,
  staffInviteView,
  type StaffInvitePreview,
} from "@/lib/staff-phone-invite";

/** No spinner on this page waits longer than this (guardrails §3). */
const LOAD_TIMEOUT_MS = 35_000;

type Load = "loading" | "ready" | "not-found" | "failed";

/**
 * The page behind a staff invitation's WhatsApp Accept button
 * (`/j/<token>`, docs/STAFF_PHONE_INVITES.md §6). It reads the invitation
 * without a sign-in, then: signed out, the person signs in with a code sent
 * to the invited number (masked: only its last two digits are ever shown)
 * and the invitation is accepted straight after; signed in with that number,
 * one tap accepts; signed in as anyone else, they sign out first. Once
 * accepted the token is refreshed and the page leaves for "/", where the
 * router opens the business console by role.
 */
export function StaffInvitePage({ firebaseUser }: { firebaseUser: User | null }) {
  const [token] = useState(() =>
    typeof window === "undefined" ? "" : staffInviteTokenFromLocation(window.location.pathname, window.location.search),
  );
  const [preview, setPreview] = useState<StaffInvitePreview | null>(null);
  const [load, setLoad] = useState<Load>(token ? "loading" : "not-found");
  const [reloadKey, setReloadKey] = useState(0);
  const [signingIn, setSigningIn] = useState(false);
  const [busy, setBusy] = useState<"" | "accept" | "sign-out">("");
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    setLoad("loading");
    withTimeout(getStaffInvitePreview(token), LOAD_TIMEOUT_MS, { code: "deadline-exceeded" })
      .then((answer) => {
        if (!active) return;
        setPreview(answer);
        setLoad("ready");
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setLoad(phoneRefusalOf(caught).reason === "invite_not_found" ? "not-found" : "failed");
      });
    return () => {
      active = false;
    };
  }, [token, reloadKey]);

  async function accept() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("accept");
    setError("");
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("not-signed-in");
      await withTimeout(acceptStaffInvitation(token), LOAD_TIMEOUT_MS, { code: "deadline-exceeded" });
      setJoined(true);
      // The claims follow the profile (syncUserCustomClaims): a fresh token
      // carries the staff role before the console opens.
      await withTimeout(user.getIdToken(true), LOAD_TIMEOUT_MS, null).catch(() => undefined);
      window.location.replace("/");
    } catch (caught) {
      setError(acceptRefusalMessage(caught));
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  async function signOutToContinue() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("sign-out");
    setError("");
    try {
      await withTimeout(signOut(auth), LOAD_TIMEOUT_MS, null);
      setSigningIn(false);
    } catch {
      setError(COPY.loadFailed);
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  const viewer = firebaseUser && !firebaseUser.isAnonymous
    ? { signedIn: true, phoneNumber: firebaseUser.phoneNumber ?? "" }
    : null;
  const lastTwo = preview?.phoneLastTwo ?? "";

  let body: ReactNode;
  if (load === "loading") {
    body = (
      <p className="staff-invite-status" role="status">
        <RefreshCw aria-hidden="true" className="spin" size={16} /> {COPY.loading}
      </p>
    );
  } else if (load === "not-found") {
    body = (
      <>
        <p role="alert">{COPY.notFound}</p>
        <a className="secondary-button" href="/">{COPY.openLaawol}</a>
      </>
    );
  } else if (load === "failed" || !preview) {
    body = (
      <>
        <div className="error-box" role="alert">{COPY.loadFailed}</div>
        <button className="primary-button" onClick={() => setReloadKey((value) => value + 1)} type="button">
          <RefreshCw aria-hidden="true" size={16} /> {COPY.retry}
        </button>
      </>
    );
  } else if (joined) {
    body = (
      <>
        <div className="info-band" role="status">{COPY.joined}</div>
        <a className="secondary-button" href="/">{COPY.openLaawol}</a>
      </>
    );
  } else {
    const view = staffInviteView(preview, viewer);
    body = (
      <>
        <p className="staff-invite-lede">
          {preview.invitedByName ? (
            <>
              <strong data-no-translate>{preview.invitedByName}</strong>{" "}
              {COPY.invitedYouToJoin}
            </>
          ) : (
            COPY.youAreInvitedToJoin
          )}{" "}
          {preview.businessName ? (
            <strong data-no-translate>{preview.businessName}</strong>
          ) : (
            <strong>A Laawol business</strong>
          )}{" "}
          {COPY.onLaawolAsStaff}
        </p>
        {error && <div className="error-box" role="alert">{error}</div>}
        {view.kind === "closed" && (
          <>
            <p role="status">{STAFF_INVITE_CLOSED_COPY[view.status]}</p>
            <a className="secondary-button" href="/">{COPY.openLaawol}</a>
          </>
        )}
        {busy === "accept" && view.kind !== "closed" && (
          <p className="staff-invite-status" role="status">
            <RefreshCw aria-hidden="true" className="spin" size={16} /> {COPY.accepting}
          </p>
        )}
        {view.kind === "sign-in" && busy !== "accept" && (
          signingIn ? (
            <PhoneSignIn
              autoStart
              backLabel="Cancel"
              hint={{ inviteToken: token, lastTwo }}
              idPrefix="staff-invite-sign-in"
              onBack={() => setSigningIn(false)}
              onSignedIn={() => void accept()}
            />
          ) : (
            <>
              <button className="primary-button" onClick={() => setSigningIn(true)} type="button">
                <LogIn aria-hidden="true" size={16} />
                <span>
                  {COPY.acceptWithNumber} <span data-no-translate>••{lastTwo}</span>
                </span>
              </button>
              <p>{COPY.acceptHint}</p>
            </>
          )
        )}
        {view.kind === "accept" && busy !== "accept" && (
          <button className="primary-button" disabled={busy !== ""} onClick={() => void accept()} type="button">
            <UserPlus aria-hidden="true" size={16} /> {COPY.accept}
          </button>
        )}
        {view.kind === "other-account" && busy !== "accept" && (
          <>
            <p>
              {COPY.otherAccount} <span data-no-translate>••{lastTwo}</span>
            </p>
            <button
              className="secondary-button"
              data-loading={busy === "sign-out"}
              disabled={busy !== ""}
              onClick={() => void signOutToContinue()}
              type="button"
            >
              {busy === "sign-out" ? (
                <RefreshCw aria-hidden="true" className="spin" size={16} />
              ) : (
                <LogOut aria-hidden="true" size={16} />
              )}{" "}
              {busy === "sign-out" ? COPY.signingOut : COPY.signOutToContinue}
            </button>
          </>
        )}
      </>
    );
  }

  return (
    <div className="customer-entry-shell">
      <header className="customer-entry-header">
        <a className="customer-entry-brand" href="https://laawoldigital.com">
          <span className="brand-badge" data-no-translate>Laawol Digital</span>
        </a>
      </header>
      <main className="customer-entry-main">
        <section aria-labelledby="staff-invite-title" className="panel staff-invite-page">
          <h1 id="staff-invite-title">{COPY.title}</h1>
          {body}
        </section>
      </main>
    </div>
  );
}
