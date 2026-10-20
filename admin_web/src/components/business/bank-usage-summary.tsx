"use client";

import { currentLanguage } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import { TEAM_MEMBER, USAGE_TEXT, staffName, type BankUsage } from "@/lib/bank-check";

/**
 * A month of Check bank (docs/ZELLE_BANK_CHECK.md, "Usage and the monthly
 * limit"): checks people started, paid bank refreshes, their estimated cost
 * and the same by team member. One view for the owner's bank card and the
 * admin's bill (`getBusinessBill.bankUsage`). Names are user data; a person
 * with no name on their profile reads "Team member", never an id.
 */
export function BankUsageSummary({ usage, showLimit = true }: { usage: BankUsage; showLimit?: boolean }) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const count = (value: number) => new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US").format(value);
  return (
    <div className="bank-usage">
      <dl className="bank-usage-figures">
        <div>
          <dt>{USAGE_TEXT.checks}</dt>
          <dd data-no-translate>{count(usage.checks)}</dd>
        </div>
        <div>
          <dt>{USAGE_TEXT.refreshes}</dt>
          <dd data-no-translate>{showLimit ? `${count(usage.refreshes)} / ${count(usage.refreshLimit)}` : count(usage.refreshes)}</dd>
        </div>
        <div>
          <dt>{USAGE_TEXT.cost}</dt>
          <dd data-no-translate>{moneyText(usage.estimatedCostCents, lang)}</dd>
        </div>
      </dl>
      {usage.limitReached && <p className="ctn-wa-warn">{USAGE_TEXT.limitReached}</p>}
      {usage.checks === 0 && usage.refreshes === 0 ? (
        <p className="bank-usage-none">{USAGE_TEXT.none}</p>
      ) : (
        usage.byStaff.length > 0 && (
          <div className="bank-usage-staff">
            <h4>{USAGE_TEXT.byStaff}</h4>
            <ul>
              {usage.byStaff.map((entry) => (
                <li key={entry.uid}>
                  {staffName(entry) ? <span data-no-translate>{staffName(entry)}</span> : <span>{TEAM_MEMBER}</span>}
                  <span className="bank-usage-staff-figures">
                    <span>{USAGE_TEXT.checks}</span> <b data-no-translate>{count(entry.checks)}</b>
                    {" · "}
                    <span>{USAGE_TEXT.refreshes}</span> <b data-no-translate>{count(entry.refreshes)}</b>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </div>
  );
}
