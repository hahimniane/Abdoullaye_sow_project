import { BUSINESS_ACCOUNT_LABEL, BUSINESS_ACCOUNT_RECEIVER } from "@/lib/staff-balances";

/**
 * The options of every "Received by" picker (docs/STAFF_BALANCES.md §4): the
 * Business account first - money paid straight to the business by Zelle,
 * transfer, card or a payment link, which no person holds - then the
 * business's people. `placeholder` is the empty prompt of a required picker
 * ("Choose staff"); it stays above the choices. Put it inside a <select>.
 */
export function ReceivedByOptions({
  staffOptions,
  placeholder,
}: {
  staffOptions: readonly { id: string; name: string }[];
  placeholder?: string;
}) {
  return (
    <>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      <option value={BUSINESS_ACCOUNT_RECEIVER}>{BUSINESS_ACCOUNT_LABEL}</option>
      {staffOptions.map((s) => (
        <option key={s.id} value={s.id} data-no-translate>{s.name}</option>
      ))}
    </>
  );
}

/**
 * "Received by" where the money has always been the signed-in person's own
 * (an invoice payment, cash collected at a handover): the Business account
 * first, then "Me" - the default, and what the server records when nothing
 * else is said. The value is "" for Me and "business_account" for the
 * Business account.
 */
export function ReceivedByMeOptions() {
  return (
    <>
      <option value={BUSINESS_ACCOUNT_RECEIVER}>{BUSINESS_ACCOUNT_LABEL}</option>
      <option value="">Me (I hold the money)</option>
    </>
  );
}
