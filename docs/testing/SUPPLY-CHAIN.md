# CI supply chain and dependency audits

Scope: public GitHub development, local tests only. All workflow permissions remain `contents: read`; there are no repository secrets, CI pushes or automatic merges.

## Action pins

Verified on 2026-10-07 by resolving each exact version tag through the official repository's Git refs API. Tags are comments for humans; execution uses the full immutable commit. Both cache sub-actions share the same repository commit.

| Action | Version comment | Full commit | Official source |
|---|---|---|---|
| actions/checkout | v4.4.0 | 11d5960a326750d5838078e36cf38b85af677262 | [tag](https://github.com/actions/checkout/tree/v4.4.0) |
| actions/setup-node | v4.4.0 | 49933ea5288caeca8642d1e84afbd3f7d6820020 | [tag](https://github.com/actions/setup-node/tree/v4.4.0) |
| actions/cache/restore and save | v4.3.0 | 0057852bfaa89a56745cba8c7296529d2fc39830 | [tag](https://github.com/actions/cache/tree/v4.3.0) |
| actions/upload-artifact | v4.6.2 | ea165f8d65b6e75b540449e92b4886f43607fa02 | [tag](https://github.com/actions/upload-artifact/tree/v4.6.2) |
| actions/download-artifact | v4.3.0 | d3f86a106a0bac45b974a628896c90dbdf5c8093 | [tag](https://github.com/actions/download-artifact/tree/v4.3.0) |

The scheduled workflow calls `./.github/workflows/ci.yml` from its own repository revision. That local reusable workflow is not a floating third-party action.

## Verified audit tool

CI downloads cargo-audit **0.22.2** directly from [RustSec's official release](https://github.com/rustsec/rustsec/releases/tag/cargo-audit/v0.22.2):

- Asset: `cargo-audit-x86_64-unknown-linux-gnu-v0.22.2.tgz`.
- SHA-256: `ab28a1bdb54db4d5d8ad5981cf1f959410370b3d28250dbd35f6a44248620e39`.
- The hash was checked against GitHub's release-asset digest and independently against the downloaded bytes before this pin was written. CI repeats the check before extraction and execution and checks the executable's reported version.
- Local Windows verification used the same release's `cargo-audit-x86_64-pc-windows-msvc-v0.22.2.zip`, SHA-256 `0a7316540862c13d954f648917ceacca593747baed6eec180fafa590be2710ab`.

The existing [Anchor and Agave checksum verification](BUILD-TOOLS.md) remains in place. No downloaded installer is piped into a shell.

## Audit policy and exceptions

`node scripts/audit-dependencies.mjs` runs `pnpm audit --prod --json` and `cargo-audit audit --no-yanked --json`. The RustSec advisory database is fetched afresh; its commit is recorded with the results. The optional yanked-release check is excluded because yanking is not a vulnerability classification. All RustSec vulnerabilities still block.

The policy blocks npm high, critical and unknown severities, and every RustSec vulnerability. Lower npm severities and RustSec informational warnings remain in the public JSON report. Scanner failures, malformed output, an unavailable registry/database, expired exceptions or unmet mitigations fail the job. The CI tests that behavior explicitly.

Every exception is in [audit-exceptions.json](audit-exceptions.json), matched by ecosystem, advisory, package and exact installed version. It includes a concrete reason and review date. Exceptions do not hide findings in the raw scanner artifacts. Expired entries fail even if the dependency disappears, forcing a deliberate cleanup/review.

The only initial exception is [GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg), `bigint-buffer@1.1.5`, due for review **2026-11-06**:

1. npm has no published patched version as of 2026-10-07; the registry's suggested future range is not an installable fix.
2. `ignoredBuiltDependencies` explicitly disables that package's build scripts.
3. The guard checks the exact installed version and SHA-256 of its audited JavaScript entrypoint: `6882e3d44987bbb7c47580928fd5e3be126bdae26a448f8a31228cf879a85210`.
4. It resolves every native-binding candidate with `bindings({ path: true })`, which never executes the native converter, and fails if any candidate exists.
5. With native code absent, it tests the verified JavaScript fallback at buffer lengths 0, 1, 7, 8, 31, 32, 33 and 128.

The [versioned upstream source](https://github.com/no2chem/bigint-buffer/blob/v1.1.5/src/index.ts) falls back to JavaScript when the binding is absent. This condition removes the vulnerable native converter from the tested runtime; it does not declare the package generally safe. Native compilation, a dependency/source change, an expired review date or a move beyond the local test scope requires a new assessment.

An initial verified scan found no RustSec vulnerabilities, with one retained informational warning: [RUSTSEC-2025-0141](https://rustsec.org/advisories/RUSTSEC-2025-0141.html), `bincode@1.3.3` unmaintained. This warning is not presented as a fixed dependency. The successful policy result still reports the one high npm finding under its narrowly verified temporary exception.

## Dependabot: observed failures and correction

There were two distinct failures; they were read from actual public update-job logs.

- [Version-update run 37679332632](https://github.com/Mule-Protocol/mule/actions/runs/37679332632) failed with `ERR_PNPM_NO_MATCHING_VERSION`: its pnpm command imposed `minimum-release-age=4320`, but the lockfile already selected `acorn@8.19.0`, published on 2026-10-05, inside the three-day cooldown. `acorn@8.18.0`, published on 2026-07-28, is the explicit eligible override. The three-day protection is retained in both the workspace and Dependabot.
- Security-update jobs for [stream-json](https://github.com/Mule-Protocol/mule/actions/runs/37684914031), [uuid](https://github.com/Mule-Protocol/mule/actions/runs/37684912889) and [toml](https://github.com/Mule-Protocol/mule/actions/runs/37684903778) reported `security_update_not_possible`. Parent constraints kept vulnerable major versions in place. Grouping YAML alone cannot solve that dependency graph.

The checked-in dependency corrections use the compatible CommonJS `jayson@5.0.0` under `@solana/web3.js@1.98.4`, removing the old uuid/stream-json dependencies; `toml@4.2.0` under `@coral-xyz/anchor@0.32.1`; and Ajv 8.20.0. Their correctness is verified by the locked install, package tests, audits and local campaign. Do not merge unrelated Dependabot PRs to apply these corrections.

`.github/dependabot.yml` covers the root pnpm workspace, Cargo workspace and GitHub Actions. Weekly minor/patch groups reduce PR volume, while security updates remain enabled. npm explicitly permits transitive dependencies. The three-day cooldown remains; major upgrades are still reviewed separately. [GitHub's option reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#cooldown) documents cooldown and grouping.

The managed Dependabot service reads the default branch. A successful local resolver/audit check is not proof that its future managed update job has run against this draft PR. Full managed confirmation can only occur after the owner merges the configuration; no automatic merge or reconfiguration of branch protection is performed.

## Fuzz CI and public evidence

Each PR/main run executes 64 sequences of up to 80 generated operations with fixed seed 20261007, in a job bounded to ten minutes. The weekly workflow runs on Mondays at 03:23 UTC and calls the same build/audit/fuzz workflow with 512 sequences of up to 160 operations and a generated random seed. The long fuzz job is bounded to sixty minutes. The unrelated local-network campaign is not repeated by the weekly call.

Fuzzing uses the SBF/IDL artifact from the successful verify job, avoiding a second program compilation. The weekly schedule only activates on the default branch after the owner's merge. It uses standard public-repository Linux runners and requires no paid service or secrets. See [FUZZING.md](FUZZING.md) for reproduction and invariant coverage.

Public artifact allowlists:

- `coverage/audit/`: raw pnpm/RustSec output, database revision, exceptions, mitigation evidence and final policy result.
- `coverage/fuzz/`: seeds, operation counts, worker evidence and minimized counterexamples on failure.
- Existing build and local-mission evidence remain separately scoped; no wallet, key, ledger or private recovery journal is uploaded.

A green audit policy is not an assertion of zero findings. A scheduled workflow definition is not evidence that the long random campaign has already completed. CHECKIN-4-hardening distinguishes code/configuration, local checks, current CI execution and future scheduled execution.
