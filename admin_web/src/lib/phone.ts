const NORMALIZATION_PATTERN = /[\s().-]/g;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const GENERAL_PHONE_PATTERN = /^\+?\d{7,15}$/;

export function normalizePhone(value: string) {
  return value.trim().replace(NORMALIZATION_PATTERN, "");
}

export function isValidE164(value: string) {
  return E164_PATTERN.test(normalizePhone(value));
}

export function isValidPhone(value: string) {
  const normalized = normalizePhone(value);
  return !/[A-Za-z]/.test(value) && GENERAL_PHONE_PATTERN.test(normalized);
}
