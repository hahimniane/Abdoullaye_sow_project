#!/usr/bin/env node

// One-time launch backfill for phone accounts (docs/PHONE_ACCOUNTS.md §11).
// Writes customerPhoneE164 / receiverPhoneE164 / phoneCountryCodeMissing on
// existing records and makes the account of every sender and receiver
// number on them. Nothing is sent to anyone.
//
// Dry run unless --commit. Bounded per run (--limit records, ~9 minutes) and
// resumable: it prints the --cursor to pass to the next run. Idempotent: a
// second run changes nothing.
//
//   node scripts/backfill-phone-accounts.js --project <id> --confirm <id> \
//     --business throwaway_test_business              # dry run, one business
//   node scripts/backfill-phone-accounts.js --project <id> --confirm <id> \
//     --business throwaway_test_business --commit
//   node scripts/backfill-phone-accounts.js --project <id> --confirm <id> \
//     --limit 2000 --commit [--cursor <printed cursor>]  # everything
//
// Credentials: Application Default Credentials of an account allowed to
// write Firestore and manage Firebase Auth users. Deploy the indexes and
// functions first (the triggers keep new records right from then on).

const admin = require("firebase-admin");
const {FieldPath, FieldValue, Timestamp} =
  require("firebase-admin/firestore");
const {ALL_COUNTRIES} = require("../country_catalog");
const {defaultNotificationPreferences} = require("../notification_settings");
const {createPhoneAccounts} = require("../phone_accounts");
const {backfillPhoneAccounts} = require("../phone_backfill");

function parseArgs(argv) {
  const values = {};
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      flags.add(key);
      continue;
    }
    values[key] = value.trim();
    index += 1;
  }
  const projectId = values.project || "";
  if (!projectId) throw new Error("--project is required");
  if ((values.confirm || "") !== projectId) {
    throw new Error("--confirm must exactly match --project");
  }
  if (flags.has("commit") && flags.has("dry-run")) {
    throw new Error("Pass --commit or --dry-run, not both");
  }
  return {
    projectId,
    commit: flags.has("commit"),
    businessId: values.business || "",
    limit: Number(values.limit || 500),
    cursor: values.cursor || "",
  };
}

async function run(options, sdk = admin) {
  if (sdk.apps.length === 0) {
    sdk.initializeApp(process.env.FIRESTORE_EMULATOR_HOST ?
      {projectId: options.projectId} :
      {credential: sdk.credential.applicationDefault(),
        projectId: options.projectId});
  }
  const db = sdk.firestore();
  const auth = sdk.auth();
  const accounts = createPhoneAccounts({
    db: () => db,
    auth: () => auth,
    FieldValue,
    Timestamp,
    logger: console,
    countries: ALL_COUNTRIES,
    defaultNotificationPreferences,
  });
  return backfillPhoneAccounts({db, auth, accounts, FieldPath,
    businessId: options.businessId, commit: options.commit,
    limit: options.limit, cursor: options.cursor});
}

if (require.main === module) {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  console.log(`${options.commit ? "COMMIT" : "DRY RUN"} on ${
    options.projectId}${options.businessId ?
    `, business ${options.businessId}` : ", every business"}`);
  run(options).then((result) => {
    console.log(JSON.stringify(result.report, null, 2));
    if (result.done) {
      console.log("Done: every record was visited.");
    } else {
      console.log(`Stopped at the limit. Resume with --cursor ${
        result.cursor}`);
    }
  }, (error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {parseArgs, run};
