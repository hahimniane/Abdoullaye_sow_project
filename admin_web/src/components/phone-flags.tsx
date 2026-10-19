import { recordPhoneWarnings, type RecordPhoneField } from "@/lib/phone-accounts";

/**
 * The server's flags on a record's phone (docs/PHONE_ACCOUNTS.md §3), shown
 * right next to that phone in staff views: "Add the country code" and "The
 * person says this number isn't theirs - check it". Nothing when clean.
 */
export function RecordPhoneFlags({ row, field }: { row: unknown; field: RecordPhoneField }) {
  const warnings = recordPhoneWarnings(row, field);
  if (!warnings.length) return null;
  return (
    <>
      {warnings.map((warning) => (
        <small className="phone-flag" key={warning} role="note">
          {warning}
        </small>
      ))}
    </>
  );
}
