import { CALLING_CODE_BY_COUNTRY } from "./calling-code-catalog.ts";
import { isValidPhone, normalizePhone } from "./phone.ts";

export type ReceiverPhoneValidation =
  | { valid: true; differentCountry: boolean }
  | {
      valid: false;
      reason:
        | "required"
        | "invalid"
        | "invalid-international"
        | "destination-mismatch"
        | "whatsapp-country-code";
      expectedDialCode?: string;
    };

export function validateReceiverPhone({
  allowDifferentCountry = false,
  destinationCountryCode,
  value,
}: {
  allowDifferentCountry?: boolean;
  destinationCountryCode?: string;
  value: string;
}): ReceiverPhoneValidation {
  const raw = value.trim();
  if (!raw) return { valid: false, reason: "required" };
  if (!isValidPhone(raw)) return { valid: false, reason: "invalid" };

  const normalized = normalizePhone(raw);
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return { valid: false, reason: "invalid-international" };
  }

  const callingCode = destinationCountryCode
    ? CALLING_CODE_BY_COUNTRY[destinationCountryCode.trim().toUpperCase()]
    : undefined;
  if (!callingCode) return { valid: true, differentCountry: false };

  const expectedDialCode = `+${callingCode}`;
  const matchesDestination = digits.startsWith(callingCode);
  if (matchesDestination) return { valid: true, differentCountry: false };
  if (allowDifferentCountry) {
    return normalized.startsWith("+")
      ? { valid: true, differentCountry: true }
      : {
          valid: false,
          reason: "whatsapp-country-code",
          expectedDialCode,
        };
  }
  return {
    valid: false,
    reason: "destination-mismatch",
    expectedDialCode,
  };
}

export function receiverPhoneIsDifferentCountry({
  destinationCountryCode,
  value,
}: {
  destinationCountryCode?: string;
  value: string;
}) {
  if (!isValidPhone(value)) return false;
  const digits = normalizePhone(value).replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return false;
  const callingCode = destinationCountryCode
    ? CALLING_CODE_BY_COUNTRY[destinationCountryCode.trim().toUpperCase()]
    : undefined;
  return Boolean(callingCode && !digits.startsWith(callingCode));
}
