# Mobile release artifact policy

Mobile store binaries are outputs of a reviewed release build. They are not a
source-of-truth input and must not be committed under `release_artifacts/`.
Legacy binaries were removed from the current tree; prior Git history remains
available until a separate repository-history migration is approved.

For every Android or iOS release, retain the following together in the release
system or CI artifact store:

- app version and build number;
- full Git commit SHA and a clean-tree assertion;
- pinned Flutter version and runner operating system;
- build command and non-secret build configuration names;
- SHA-256 checksum for every AAB, APK, IPA, symbols file, and mapping file;
- CI run URL and the required-check result;
- signing identity/key alias name, never the private key or password.

Use immutable names such as
`laawol-1.2.0+42-76e782ced3ed-android.aab`. Do not use ambiguous names such as
`app-release.aab`, and never replace an artifact in place after publishing its
checksum.

Before store submission, rebuild from the tagged commit, compare the generated
checksum with the release manifest, install the candidate on a real device, and
exercise sign-in plus one non-charging end-to-end workflow.
