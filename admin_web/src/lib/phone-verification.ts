const LOCAL_WEB_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function phoneVerificationErrorMessage(
  error: unknown,
  hostname = "",
) {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";

  switch (code) {
    case "auth/invalid-phone-number":
      return "Enter a valid international phone number and try again.";
    case "auth/unauthorized-domain":
      return LOCAL_WEB_HOSTS.has(hostname)
        ? "Phone verification is not configured for this local address. Add it to Firebase Authorized domains."
        : "Phone verification is not configured for this website. Contact Laawol support.";
    case "auth/captcha-check-failed":
    case "auth/invalid-app-credential":
    case "auth/missing-app-credential":
      return "The phone security check could not start. Refresh the page and try again.";
    case "auth/operation-not-allowed":
      return "Phone verification is not enabled. Contact Laawol support.";
    case "auth/too-many-requests":
      return "Too many verification attempts. Wait a few minutes and try again.";
    case "auth/quota-exceeded":
      return "SMS verification is temporarily unavailable. Try again later.";
    case "auth/credential-already-in-use":
      return "This phone number is already linked to another Laawol account.";
    case "auth/code-expired":
    case "auth/invalid-verification-code":
      return "The code is invalid or expired. Request a new code.";
    case "auth/verification-timeout":
      return "Phone verification is taking longer than expected. Try again.";
    default:
      return "The verification code could not be sent. Check the phone number and try again.";
  }
}
