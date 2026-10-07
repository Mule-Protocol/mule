# MULE · acceptance-gated escrow

[![CI](https://github.com/Mule-Protocol/mule/actions/workflows/ci.yml/badge.svg?branch=codex%2Fm1-escrow-sdk)](https://github.com/Mule-Protocol/mule/actions/workflows/ci.yml)

**Development and local CI tests only. No deployed program.** Apache-2.0.

MULE holds a client's tokens and pays the accepted agent after a signed passing verdict and dispute window, or an admin ruling. Failed, expired and stale missions refund the client. A client may designate the only agent allowed to accept. Unresolved disputes become permissionlessly finalizable after 14 days, using the original validator verdict; the admin role can be transferred in two steps.

- Public-cluster program ID: **none**.
- Test-only identity: Fg6PaFpoGXkYsidMpWxTWqkZ7FEfcYkgMQHGho8KDXgL.
- Settlement denomination: **dUSDC (devnet, no value)**; tests use a local six-decimal SPL mint.
- [Step 1 draft PR](https://github.com/Mule-Protocol/mule/pull/6) · [Milestone](https://github.com/Mule-Protocol/mule/milestone/1).
- [Check-in 1b: corrections, results and limits](docs/checkins/CHECKIN-1b.md) · [Historical check-in 1](docs/checkins/CHECKIN-1.md).
- [Latest CI runs/evidence](https://github.com/Mule-Protocol/mule/actions/workflows/ci.yml).
- Step 3: **agent de référence scripté ; le branchement d'un agent IA réel est prévu plus tard**. Not implemented in step 1 or 1b.

## Scope and sources

The [2026-10-07 owner update](docs/spec/M1_LOCAL_ONLY_UPDATE.md) supersedes deployment in the [free architecture request](docs/spec/M1_FREE_ARCHITECTURE.md).
Original [v2](docs/spec/SPEC_M-1_devnet_v2.md) and [v1](docs/spec/PROMPT_M-1_devnet.md) are preserved byte-for-byte. [Check-in 1b](docs/checkins/CHECKIN-1b.md) records the subsequent approved protocol corrections.

No public deployment, devnet mint/faucet, devnet-run workflow, GitHub secrets, paid provider, mainnet, $MULE or site modification. Only the owner merges. Stop at CHECKIN-1b; step 3 requires later authorization and stops at CHECKIN-3. solana-verify is deferred until the first deployment.

## Build and test

Linux CI installs the exact tools in [architecture](docs/architecture.md), verifying downloaded Anchor/Solana tools against [pinned SHA-256 checksums](docs/testing/BUILD-TOOLS.md) before execution. Then:

    pnpm install --frozen-lockfile
    anchor build --no-idl -- --tools-version v1.56
    anchor idl build --out target/idl/mule_escrow.json
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets -- -D warnings
    pnpm build && pnpm typecheck && pnpm lint && pnpm test
    anchor test --skip-build --skip-deploy --skip-local-validator
    pnpm coverage:instructions

Tests run compiled SBF in LiteSVM; no node deployment or RPC is required. Keys used by the scenarios are generated in memory. Anchor may create a disposable build keypair under ignored target/deploy; it is never used, uploaded or cached. ProgramData/time are synthetic fixtures. Artifacts contain coverage, IDL, binary and lockfile, never wallet files.

## SDK mission IDs

The SDK refuses to build create_mission without a MissionIdHistory store and reserves each program/client/ID tuple before returning the instruction. Use FileMissionIdHistory from @mule/sdk/file-history for durable Node history, and retain/share the same directory across all instances. Reservations are permanent, including after a failed transaction or a closed mission. InMemoryMissionIdHistory is only an ephemeral test adapter. The future runner must use persistent history too. Deleting/rolling back history, using separate directories or bypassing the SDK defeats this off-chain guard; on-chain reuse after closure remains intentionally allowed.

[State machine](docs/state-machine.md) · [Threat model](docs/threat-model.md) · [Architecture](docs/architecture.md)

Schema checks prove encoded criteria, not truth. M-1 trusts its validator and dispute admin. No independent security audit has been performed.
