"use strict";

/**
 * A business's main work (docs/APP_NEW_LOOK.md, H2): the one work its app
 * home leads with. Stored as `businesses/{id}.mainWork`, chosen by the owner
 * on Business profile; never guessed from activity. Pure: no Firebase.
 */

/** The stored values, the same strings the app's `HomeWork` enum uses. */
const MAIN_WORKS = Object.freeze(
    ["parking", "shipping", "shop", "carSales", "transport"]);

/**
 * What a profile save does to `mainWork`.
 *
 * @param {*} raw The value the client sent (`request.data.mainWork`).
 * @return {{kind: string, value: (string|undefined)}} `keep` when nothing
 *   was sent (an older app or console: the stored choice stays), `set` with
 *   the value, `clear` for an empty string, `invalid` for anything else.
 */
function mainWorkChange(raw) {
  if (raw === undefined || raw === null) return {kind: "keep"};
  if (typeof raw !== "string") return {kind: "invalid"};
  const value = raw.trim();
  if (!value) return {kind: "clear"};
  return MAIN_WORKS.includes(value) ? {kind: "set", value} : {kind: "invalid"};
}

module.exports = {MAIN_WORKS, mainWorkChange};
