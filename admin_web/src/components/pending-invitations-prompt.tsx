"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, UserPlus } from "lucide-react";

import { auth } from "@/lib/firebase";
import { withTimeout } from "@/lib/phone-accounts";
import { acceptInvitationById, listPendingInvitations } from "@/lib/phone-accounts-client";
import {
  PENDING_INVITE_COPY,
  STAFF_INVITE_PAGE_COPY,
  acceptRefusalMessage,
  dismissedInvitationsKey,
  pendingInvitationTarget,
  readDismissedInvitations,
  visiblePendingInvitations,
  withDismissedInvitation,
  type PendingInvitation,
} from "@/lib/staff-phone-invite";

/** No button here spins longer than this (guardrails §3). */
const CALL_TIMEOUT_MS = 35_000;

function readDismissed(uid: string): string[] {
  try {
    return readDismissedInvitations(window.sessionStorage.getItem(dismissedInvitationsKey(uid)));
  } catch {
    return [];
  }
}

function writeDismissed(uid: string, ids: string[]) {
  try {
    window.sessionStorage.setItem(dismissedInvitationsKey(uid), JSON.stringify(ids));
  } catch {
    // Storage blocked: "Not now" still hides it until the page reloads.
  }
}

/**
 * "Join <business>" after a normal sign-in (docs/STAFF_PHONE_INVITES.md
 * §4.1): someone invited by phone or email who signed in without tapping
 * the link sees what waits for them. Listing accepts nothing; Join is the
 * same acceptance as the link, then the page reloads so the router opens
 * the business console. "Not now" hides an invitation until the next sign-in.
 */
export function PendingInvitationsPrompt({ uid }: { uid: string }) {
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [joining, setJoining] = useState("");
  const joiningRef = useRef(false);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    setDismissed(readDismissed(uid));
    // Quiet on failure: the prompt is an offer, never a blocker.
    withTimeout(listPendingInvitations(), CALL_TIMEOUT_MS, null)
      .then((rows) => {
        if (active) setInvitations(rows);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [uid]);

  async function join(invitation: PendingInvitation) {
    if (joiningRef.current) return;
    joiningRef.current = true;
    setJoining(invitation.invitationId);
    setError(null);
    try {
      await withTimeout(acceptInvitationById(invitation.invitationId), CALL_TIMEOUT_MS, { code: "deadline-exceeded" });
      // The claims follow the profile: a fresh token carries the new role.
      await withTimeout(auth.currentUser?.getIdToken(true) ?? Promise.resolve(""), CALL_TIMEOUT_MS, null)
        .catch(() => undefined);
      window.location.replace("/");
    } catch (caught) {
      setError({ id: invitation.invitationId, message: acceptRefusalMessage(caught) });
    } finally {
      joiningRef.current = false;
      setJoining("");
    }
  }

  function notNow(invitation: PendingInvitation) {
    const next = withDismissedInvitation(dismissed, invitation.invitationId);
    setDismissed(next);
    writeDismissed(uid, next);
  }

  const visible = visiblePendingInvitations(invitations, dismissed);
  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((invitation) => {
        const target = pendingInvitationTarget(invitation);
        const name = target.userData ? <strong data-no-translate>{target.name}</strong> : <strong>{target.name}</strong>;
        const busy = joining === invitation.invitationId;
        return (
          <div className="info-band pending-invite-prompt" key={invitation.invitationId} role="status">
            <span className="pending-invite-text">
              {invitation.invitedByName ? (
                <>
                  <strong data-no-translate>{invitation.invitedByName}</strong>{" "}
                  {STAFF_INVITE_PAGE_COPY.invitedYouToJoin}
                </>
              ) : (
                STAFF_INVITE_PAGE_COPY.youAreInvitedToJoin
              )}{" "}
              {name}{" "}
              {invitation.kind === "platform" ? PENDING_INVITE_COPY.asAdmin : PENDING_INVITE_COPY.asStaff}
            </span>
            {error?.id === invitation.invitationId && (
              <small className="pending-invite-error" role="alert">{error.message}</small>
            )}
            <div className="pending-invite-actions">
              <button
                className="primary-button"
                data-loading={busy}
                disabled={joining !== ""}
                onClick={() => void join(invitation)}
                type="button"
              >
                {busy ? <RefreshCw aria-hidden="true" className="spin" size={16} /> : <UserPlus aria-hidden="true" size={16} />}
                {busy ? (
                  PENDING_INVITE_COPY.joining
                ) : (
                  <span>
                    {PENDING_INVITE_COPY.join}{" "}
                    {target.userData ? <span data-no-translate>{target.name}</span> : <span>{target.name}</span>}
                  </span>
                )}
              </button>
              <button
                className="text-button"
                disabled={joining !== ""}
                onClick={() => notNow(invitation)}
                type="button"
              >
                {PENDING_INVITE_COPY.notNow}
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
