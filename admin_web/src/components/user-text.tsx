/**
 * A value someone typed - a name, a phone number, a note, a business name -
 * shown exactly as typed. The console's French pass (lib/french-dom.ts) skips
 * anything marked `data-no-translate`, so a customer called "Pickup" or a note
 * reading "Cancelled" is never rewritten. When there is no value, `fallback`
 * is ordinary console copy and is translated as usual.
 */
export function UserText({
  value,
  fallback = "",
}: {
  value: unknown;
  fallback?: string;
}) {
  const shown = String(value ?? "").trim();
  if (!shown) return <>{fallback}</>;
  return <span data-no-translate>{shown}</span>;
}
