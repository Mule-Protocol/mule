# Pinned build tools

The public CI runs on pull requests and on pushes to `main`. It builds and tests locally; it does not deploy to any Solana network.

## Release provenance

The following exact Linux x86_64 assets are pinned in [ci.yml](../../.github/workflows/ci.yml). On 2026-10-07, each asset was downloaded and its locally calculated SHA-256 matched the `digest` returned by GitHub's release API.

| Tool | Official release / asset API | SHA-256 |
| --- | --- | --- |
| Anchor CLI 0.32.2 | [otter-sec/anchor v0.32.2](https://github.com/otter-sec/anchor/releases/tag/v0.32.2); [asset 563831715](https://api.github.com/repos/otter-sec/anchor/releases/assets/563831715) | `b3cdc15f3db924c2b11a7c16ceff21ad3da239ddde4e53f33df18e52e0461645` |
| Solana CLI / Agave 2.3.0 | [anza-xyz/agave v2.3.0](https://github.com/anza-xyz/agave/releases/tag/v2.3.0); [asset 263512119](https://api.github.com/repos/anza-xyz/agave/releases/assets/263512119) | `56241fbe862495ff01b2b875195e44f94c22e9f2a504591a3ade1b9d82862730` |

`otter-sec/anchor` is the official Anchor source: the [Anchor installation documentation](https://www.anchor-lang.com/docs/installation#install-anchor-cli) points to that repository. These are the same tool versions used at check-in 1; this change pins their bytes instead of upgrading them.

Exact download URLs:

- [Anchor CLI binary](https://github.com/otter-sec/anchor/releases/download/v0.32.2/anchor-0.32.2-x86_64-unknown-linux-gnu) — 12,882,384 bytes.
- [Solana archive](https://github.com/anza-xyz/agave/releases/download/v2.3.0/solana-release-x86_64-unknown-linux-gnu.tar.bz2) — 271,324,885 bytes.

## Verification and installation

CI downloads the binary and archive over HTTPS into `$RUNNER_TEMP/mule-build-tools`. Bash runs with `set -euo pipefail`. Each download must pass `sha256sum --check --strict` against its committed digest before the binary is installed or the archive is extracted. Only the resulting local `bin` directories are added to `GITHUB_PATH`; no downloaded installer script is executed. A changed or corrupt download stops the job.

The archive contains `solana-release/bin` and the adjacent SDK resources needed by `cargo-build-sbf`. Installation does not create a wallet or contact a Solana RPC. The downloaded CLI installation is not restored from the build cache; caches contain compiler/dependency work and exclude `target/deploy` and wallet configuration. Test keypairs are generated within CI.

To update a tool, review the official release, obtain its asset digest from the GitHub release API, download that exact asset, independently calculate its SHA-256, and commit the new version, URL and digest together. CI must then pass with those reviewed values. Do not fetch the expected checksum dynamically during the CI run.

These checks establish byte integrity against the pinned release assets. They are not a source-to-binary reproducibility proof or a `solana-verify` attestation; `solana-verify` remains deferred until the first deployment.
