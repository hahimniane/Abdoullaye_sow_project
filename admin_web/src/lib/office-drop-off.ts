const GENERIC_OFFICE_ADDRESSES = new Set([
  "the business office",
  "drop-off office",
  "drop off office",
]);

export function isGenericOfficeDropOffAddress(address?: string): boolean {
  const trimmed = (address ?? "").trim();
  if (!trimmed) return true;
  return GENERIC_OFFICE_ADDRESSES.has(trimmed.toLowerCase());
}
