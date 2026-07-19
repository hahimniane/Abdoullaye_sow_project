function normalizeWebsite(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isValidWebsite(value) {
  const normalized = normalizeWebsite(value);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    return Boolean(parsed.hostname && parsed.hostname.includes("."));
  } catch {
    return false;
  }
}

function coerceReviewWebsite(value) {
  const normalized = normalizeWebsite(value);
  return normalized && isValidWebsite(normalized) ? normalized : "";
}

module.exports = {
  coerceReviewWebsite,
  isValidWebsite,
  normalizeWebsite,
};
