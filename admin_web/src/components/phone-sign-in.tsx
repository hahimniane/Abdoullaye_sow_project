"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, MessageSquareText } from "lucide-react";
import type { ConfirmationResult, RecaptchaVerifier } from "firebase/auth";

import { CustomerPhoneField } from "@/components/customer-phone-field";
import { isValidE164, normalizePhone } from "@/lib/phone";
import { phoneVerificationErrorMessage } from "@/lib/phone-verification";
import {
  phoneRefusalOf,
  phoneRefusalText,
  sanitizeLoginCode,
  secondsUntil,
  withTimeout,
  type PhoneRefusalText,
  type PhoneRole,
} from "@/lib/phone-accounts";
import {
  PHONE_AUTH_TIMEOUT_MS,
  completePhoneSignInOnce,
  invisibleRecaptcha,
  requestPhoneLoginCode,
  sendSignInText,
  signInWithPhoneToken,
  verifyPhoneSignInCode,
} from "@/lib/phone-accounts-client";

/** The masked flow of a tracking page: the server knows the number, the page only its last two digits. */
export type PhoneSignInHint = { trackingCode: string; role: PhoneRole; lastTwo: string };

type Step = "phone" | "code" | "sms-phone" | "sms-code" | "done";
type Busy = "" | "send" | "verify" | "sms-send" | "sms-verify";

const SMS_RESEND_AFTER_MS = 30_000;

/** A refusal or an SMS error, in the console's own words. */
export function PhoneRefusalBox({ refusal }: { refusal: PhoneRefusalText }) {
  return (
    <div className="error-box" role="alert">
      {refusal.message}
      {refusal.detail && (
        <>
          {" "}
          {refusal.detail.label} <span data-no-translate>{refusal.detail.value}</span>
        </>
      )}
      {refusal.hint && <> {refusal.hint}</>}
    </div>
  );
}

/**
 * The 6-digit code step every phone flow shares (sign-in, SMS, profile
 * link): one field, Verify, and a resend that counts down before it opens.
 */
export function LoginCodeEntry({
  id,
  code,
  onCodeChange,
  onVerify,
  verifying,
  disabled,
  verifyLabel,
  verifyingLabel,
  resendSeconds,
  onResend,
  resending,
}: {
  id: string;
  code: string;
  onCodeChange: (code: string) => void;
  onVerify: () => void;
  verifying: boolean;
  disabled: boolean;
  verifyLabel: string;
  verifyingLabel: string;
  resendSeconds: number;
  onResend: () => void;
  resending: boolean;
}) {
  return (
    <div className="customer-phone-code-step">
      <label htmlFor={id}>
        6-digit code
        <input
          autoComplete="one-time-code"
          autoFocus
          disabled={disabled}
          id={id}
          inputMode="numeric"
          maxLength={6}
          onChange={(event) => onCodeChange(sanitizeLoginCode(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && code.length === 6 && !disabled) {
              event.preventDefault();
              onVerify();
            }
          }}
          placeholder="000000"
          value={code}
        />
      </label>
      <div className="customer-phone-code-actions">
        <button
          className="primary-button"
          data-loading={verifying}
          disabled={disabled || code.length !== 6}
          onClick={onVerify}
          type="button"
        >
          {verifying ? verifyingLabel : verifyLabel}
        </button>
        <button
          className="secondary-button"
          data-loading={resending}
          disabled={disabled || resendSeconds > 0}
          onClick={onResend}
          type="button"
        >
          {resending ? (
            "Sending..."
          ) : resendSeconds > 0 ? (
            <>
              Send a new code in <span data-no-translate>{resendSeconds} s</span>
            </>
          ) : (
            "Send a new code"
          )}
        </button>
      </div>
    </div>
  );
}

/** Ticks once a second while a resend is still closed, so the countdown moves. */
export function useResendSeconds(resendAtMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (resendAtMs <= Date.now()) return undefined;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= resendAtMs) window.clearInterval(timer);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [resendAtMs]);
  return secondsUntil(resendAtMs, now);
}

/**
 * "Sign in with your phone" (docs/PHONE_ACCOUNTS.md §5): a WhatsApp code
 * first, "Send it by text instead" always on offer (and taken on its own
 * when WhatsApp is unavailable). Typed-number flow by default; with `hint`
 * it is the tracking page's masked flow, where only the server has the
 * number and the text fallback asks the person to type it.
 */
export function PhoneSignIn({
  hint,
  autoStart = false,
  idPrefix = "phone-sign-in",
  initialCountryCode,
  onSignedIn,
  onBack,
  backLabel = "Use email instead",
}: {
  hint?: PhoneSignInHint;
  /** Masked flow: send the WhatsApp code at once (the tap that opened this asked for it). */
  autoStart?: boolean;
  idPrefix?: string;
  initialCountryCode?: string;
  /** Called once the page's own Auth holds the new session. */
  onSignedIn?: () => void;
  onBack?: () => void;
  backLabel?: string;
}) {
  const [step, setStep] = useState<Step>(hint ? "code" : "phone");
  const [phone, setPhone] = useState("");
  const [lastTwo, setLastTwo] = useState(hint?.lastTwo ?? "");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState<PhoneRefusalText | null>(null);
  const [whatsAppDown, setWhatsAppDown] = useState(false);
  const [resendAtMs, setResendAtMs] = useState(0);
  const resendSeconds = useResendSeconds(resendAtMs);
  const confirmation = useRef<ConfirmationResult | null>(null);
  const recaptcha = useRef<RecaptchaVerifier | null>(null);
  const busyRef = useRef(false);
  const started = useRef(false);
  const recaptchaId = `${idPrefix}-recaptcha`;
  const typedPhone = normalizePhone(phone);
  const phoneReady = isValidE164(typedPhone);

  useEffect(
    () => () => {
      recaptcha.current?.clear();
      recaptcha.current = null;
    },
    [],
  );

  /** One action at a time: a second click while one runs is ignored. */
  async function run(kind: Exclude<Busy, "">, work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setError(null);
    try {
      await work();
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  function sendWhatsApp() {
    return run("send", async () => {
      try {
        const challenge = await requestPhoneLoginCode(
          hint ? { trackingCode: hint.trackingCode, role: hint.role } : { phone: typedPhone },
        );
        setChallengeId(challenge.challengeId);
        if (challenge.lastTwo) setLastTwo(challenge.lastTwo);
        setCode("");
        setResendAtMs(Date.now() + challenge.resendAfterMs);
        setStep("code");
      } catch (caught) {
        const refusal = phoneRefusalOf(caught);
        if (refusal.reason === "whatsapp_unavailable") {
          // WhatsApp cannot carry the code: a text can. A typed number goes
          // straight to it; the masked flow first needs the full number.
          setWhatsAppDown(true);
          setStep(hint ? "sms-phone" : "phone");
          if (!hint) await sendText(typedPhone);
          return;
        }
        setError(phoneRefusalText(refusal));
      }
    });
  }

  async function verifyWhatsApp() {
    await run("verify", async () => {
      try {
        const token = await verifyPhoneSignInCode(challengeId, code);
        await signInWithPhoneToken(token);
        setStep("done");
        onSignedIn?.();
      } catch (caught) {
        const refusal = phoneRefusalOf(caught);
        if (["code_expired", "too_many_attempts", "challenge_not_found"].includes(refusal.reason)) {
          // This code is spent: open the resend now instead of making them wait.
          setCode("");
          setResendAtMs(0);
        }
        setError(phoneRefusalText(refusal));
      }
    });
  }

  /** Firebase SMS to a full number, with the invisible reCAPTCHA. */
  async function sendText(number: string) {
    if (!isValidE164(number)) {
      setStep(hint ? "sms-phone" : "phone");
      setError({ message: "Enter your full number with its country code." });
      return;
    }
    try {
      if (!recaptcha.current) recaptcha.current = invisibleRecaptcha(recaptchaId);
      confirmation.current = await sendSignInText(number, recaptcha.current);
      setCode("");
      setResendAtMs(Date.now() + SMS_RESEND_AFTER_MS);
      setStep("sms-code");
    } catch (caught) {
      recaptcha.current?.clear();
      recaptcha.current = null;
      setError({ message: phoneVerificationErrorMessage(caught, window.location.hostname) });
    }
  }

  function startText() {
    return run("sms-send", () => sendText(typedPhone));
  }

  async function verifyText() {
    await run("sms-verify", async () => {
      const pending = confirmation.current;
      if (!pending) {
        setError({ message: "Ask for a new code." });
        return;
      }
      try {
        const credential = await withTimeout(pending.confirm(code), PHONE_AUTH_TIMEOUT_MS, {
          code: "auth/verification-timeout",
        });
        // The sign-in bookkeeping (§5.3). Signed in either way: when it
        // fails, the console router asks again before opening the account -
        // except for an account phone sign-in is not for, which
        // completePhoneSignInOnce has already signed out.
        const refused = await completePhoneSignInOnce(credential.user.uid).then(
          () => null,
          (failure) => phoneRefusalOf(failure),
        );
        if (refused?.reason === "phone_sign_in_unavailable") {
          setError(phoneRefusalText(refused));
          return;
        }
        setStep("done");
        onSignedIn?.();
      } catch (caught) {
        setError({ message: phoneVerificationErrorMessage(caught, window.location.hostname) });
      }
    });
  }

  // The tap on "Sign in as the number ending in ••35" asked for the code:
  // send it once, even when React mounts this twice in development.
  useEffect(() => {
    if (!autoStart || !hint || started.current) return;
    started.current = true;
    void sendWhatsApp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locked = busy !== "";
  const masked = Boolean(hint);

  return (
    <div className="phone-sign-in" aria-live="polite">
      {whatsAppDown && step !== "done" && (
        <div className="info-band" role="status">
          WhatsApp codes are not available right now, so we use a text message.
        </div>
      )}
      {step === "phone" && (
        <>
          <p className="phone-sign-in-lede">
            We’ll send a 6-digit code to your phone on WhatsApp.
          </p>
          <CustomerPhoneField
            disabled={locked}
            id={`${idPrefix}-number`}
            initialCountryCode={initialCountryCode}
            label="Phone number"
            onChange={(value) => {
              setPhone(value);
              setError(null);
            }}
            value={phone}
          />
          {error && <PhoneRefusalBox refusal={error} />}
          {!whatsAppDown && (
            <button
              className="primary-button"
              data-loading={busy === "send"}
              disabled={locked || !phoneReady}
              onClick={() => void sendWhatsApp()}
              type="button"
            >
              <MessageCircle aria-hidden="true" size={16} />
              {busy === "send" ? "Sending code..." : "Send code on WhatsApp"}
            </button>
          )}
          <button
            className={whatsAppDown ? "primary-button" : "text-button"}
            data-loading={busy === "sms-send" || (busy === "send" && whatsAppDown)}
            disabled={locked || !phoneReady}
            onClick={() => void startText()}
            type="button"
          >
            <MessageSquareText aria-hidden="true" size={16} />
            {busy === "sms-send" || (busy === "send" && whatsAppDown) ? "Sending text..." : "Send it by text instead"}
          </button>
        </>
      )}

      {step === "code" && (
        <>
          {challengeId ? (
            <p className="phone-sign-in-lede">
              We sent a code on WhatsApp to the number ending in{" "}
              <span data-no-translate>••{lastTwo}</span>.
            </p>
          ) : (
            <p className="phone-sign-in-lede">
              {busy === "send" ? "Sending a code on WhatsApp to the number ending in " : "We’ll send a code on WhatsApp to the number ending in "}
              <span data-no-translate>••{lastTwo}</span>.
            </p>
          )}
          {error && <PhoneRefusalBox refusal={error} />}
          {challengeId ? (
            <LoginCodeEntry
              code={code}
              disabled={locked}
              id={`${idPrefix}-code`}
              onCodeChange={(value) => {
                setCode(value);
                setError(null);
              }}
              onResend={() => void sendWhatsApp()}
              onVerify={() => void verifyWhatsApp()}
              resendSeconds={resendSeconds}
              resending={busy === "send"}
              verifyLabel="Verify and sign in"
              verifying={busy === "verify"}
              verifyingLabel="Signing you in..."
            />
          ) : (
            <button
              className="primary-button"
              data-loading={busy === "send"}
              disabled={locked}
              onClick={() => void sendWhatsApp()}
              type="button"
            >
              <MessageCircle aria-hidden="true" size={16} />
              {busy === "send" ? "Sending code..." : "Send code on WhatsApp"}
            </button>
          )}
          <button
            className="text-button"
            data-loading={busy === "sms-send"}
            disabled={locked}
            onClick={() => {
              if (masked) {
                setError(null);
                setCode("");
                setStep("sms-phone");
                return;
              }
              void startText();
            }}
            type="button"
          >
            <MessageSquareText aria-hidden="true" size={16} />
            {busy === "sms-send" ? "Sending text..." : "Send it by text instead"}
          </button>
          {!masked && (
            <button
              className="text-button"
              disabled={locked}
              onClick={() => {
                setError(null);
                setCode("");
                setChallengeId("");
                setStep("phone");
              }}
              type="button"
            >
              Use another number
            </button>
          )}
        </>
      )}

      {step === "sms-phone" && (
        <>
          <p className="phone-sign-in-lede">
            A text needs your full number. Type the number that ends in{" "}
            <span data-no-translate>••{lastTwo}</span>.
          </p>
          <CustomerPhoneField
            disabled={locked}
            id={`${idPrefix}-sms-number`}
            initialCountryCode={initialCountryCode}
            label="Phone number"
            onChange={(value) => {
              setPhone(value);
              setError(null);
            }}
            value={phone}
          />
          {error && <PhoneRefusalBox refusal={error} />}
          <button
            className="primary-button"
            data-loading={busy === "sms-send"}
            disabled={locked || !phoneReady}
            onClick={() => void startText()}
            type="button"
          >
            <MessageSquareText aria-hidden="true" size={16} />
            {busy === "sms-send" ? "Sending text..." : "Text me a code"}
          </button>
          {!whatsAppDown && (
            <button
              className="text-button"
              disabled={locked}
              onClick={() => {
                setError(null);
                setStep("code");
              }}
              type="button"
            >
              Back to the WhatsApp code
            </button>
          )}
        </>
      )}

      {step === "sms-code" && (
        <>
          <p className="phone-sign-in-lede">
            We sent a code by text to <span data-no-translate>{typedPhone}</span>.
          </p>
          {error && <PhoneRefusalBox refusal={error} />}
          <LoginCodeEntry
            code={code}
            disabled={locked}
            id={`${idPrefix}-sms-code`}
            onCodeChange={(value) => {
              setCode(value);
              setError(null);
            }}
            onResend={() => void startText()}
            onVerify={() => void verifyText()}
            resendSeconds={resendSeconds}
            resending={busy === "sms-send"}
            verifyLabel="Verify and sign in"
            verifying={busy === "sms-verify"}
            verifyingLabel="Signing you in..."
          />
          <button
            className="text-button"
            disabled={locked}
            onClick={() => {
              setError(null);
              setCode("");
              setStep(masked ? "sms-phone" : "phone");
            }}
            type="button"
          >
            Use another number
          </button>
        </>
      )}

      {step === "done" && (
        <div className="info-band" role="status">
          You’re signed in. Opening your account...
        </div>
      )}

      {onBack && step !== "done" && (
        <button className="text-button" disabled={locked} onClick={onBack} type="button">
          {backLabel}
        </button>
      )}
      {/* The invisible reCAPTCHA's anchor: mounted for as long as this is. */}
      <div id={recaptchaId} />
    </div>
  );
}
