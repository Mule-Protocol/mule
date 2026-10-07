# MULE · acceptance-gated escrow

[![CI](https://github.com/Mule-Protocol/mule/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Mule-Protocol/mule/actions/workflows/ci.yml)

**Development and disposable local-network tests only. No public deployment.** Apache-2.0.

MULE holds a client's tokens and pays the accepted agent after a signed passing verdict and dispute window, or an admin ruling. Failed, expired and stale missions refund the client. A client may designate the only agent allowed to accept. Unresolved disputes become permissionlessly finalizable after fourteen days using the original validator verdict; the admin role transfers in two steps, with cancellation available to the current admin before acceptance. The current validator cannot create or accept a mission or be its designated agent.

- Public-cluster program ID: **none**.
- Test-only identity: Fg6PaFpoGXkYsidMpWxTWqkZ7FEfcYkgMQHGho8KDXgL.
- Settlement fixture: **local dUSDC, six decimals, no value**.
- [Merged step 1 PR](https://github.com/Mule-Protocol/mule/pull/6) · [Milestone](https://github.com/Mule-Protocol/mule/milestone/1).
- [Merged M-1.1 PR](https://github.com/Mule-Protocol/mule/pull/21) · [Hardening milestone](https://github.com/Mule-Protocol/mule/milestone/2).
- [M-1.2 A draft PR](https://github.com/Mule-Protocol/mule/pull/31) · [Real-logic console milestone](https://github.com/Mule-Protocol/mule/milestone/3).
- [Check-in 5a — console-core](docs/checkins/CHECKIN-5a-console-core.md) · [Browser module and rebuild instructions](packages/console-core/README.md).
- [Check-in 4 — hardening](docs/checkins/CHECKIN-4-hardening.md) · [15-instruction coverage](docs/testing/INSTRUCTION-COVERAGE-4.md).
- [Check-in 3](docs/checkins/CHECKIN-3.md) · [Check-in 1b](docs/checkins/CHECKIN-1b.md) · [Historical check-in 1](docs/checkins/CHECKIN-1.md).
- [CI runs and evidence](https://github.com/Mule-Protocol/mule/actions/workflows/ci.yml).
- Step 3 uses an **agent de référence scripté**, with honest/dishonest modes and a deterministic validator. No AI API is called.

## Scope and sources

The [owner's local-only update](docs/spec/M1_LOCAL_ONLY_UPDATE.md) supersedes deployment in the [free architecture request](docs/spec/M1_FREE_ARCHITECTURE.md). Original [v2](docs/spec/SPEC_M-1_devnet_v2.md) and [v1](docs/spec/PROMPT_M-1_devnet.md) remain byte-for-byte preserved. Check-in 3 completes that scope. The completed [M-1.1 hardening request](docs/spec/M1_1_HARDENING.md) adds property testing, automatic crash reconciliation, supply-chain checks and admin-proposal cancellation.

No public deployment, devnet mint, external faucet, devnet-run workflow, GitHub secrets, paid provider, mainnet, $MULE or site modification. Only the owner merges. The current [M-1.2 request](docs/spec/M1_2_REAL_LOGIC_CONSOLE.md) authorizes only part A in this repository and stops at CHECKIN-5a. Site integration (part B) requires the owner’s explicit go-ahead and merged part-A commit. `solana-verify` is deferred until the first deployment. The mandated Agave test binary has an unavoidable internal faucet service: [the runbook](docs/runbook-local.md) documents the accepted cost-free local case with zero funding/caps and no calls; no airdrop is used.

## Build and test

Linux CI installs the exact tools in [architecture](docs/architecture.md), verifying downloaded Anchor/Agave tools against [pinned SHA-256 checksums](docs/testing/BUILD-TOOLS.md) before execution. Then:

```sh
pnpm install --frozen-lockfile
anchor build --no-idl -- --tools-version v1.56
mkdir -p target/idl
anchor idl build --out target/idl/mule_escrow.json
diff -u idl/mule_escrow.json target/idl/mule_escrow.json
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
pnpm build && pnpm typecheck && pnpm lint && pnpm test
anchor test --skip-build --skip-deploy --skip-local-validator
pnpm coverage:instructions
pnpm fuzz:program --seed 20261007 --runs 64 --steps 80
```

The program suite runs compiled SBF in LiteSVM with synthetic clock/ProgramData fixtures and ephemeral keys. It tests seven-day stale and fourteen-day dispute timeouts without real-time waits. Instruction coverage requires success and rejection assertions for all **15 instructions**, including `cancel_admin_proposal`. The [versioned IDL](idl/mule_escrow.json) is compared byte-for-byte with a fresh build in CI. Anchor may create an unused disposable build keypair under ignored target/deploy; it is neither uploaded nor cached.

[Property tests](docs/testing/FUZZING.md) compare real SBF transitions with an independent state model and check seven invariants after each instruction. PR/main CI requests 64 sequences with fixed seed 20261007; the weekly configuration requests 512 sequences with a logged random seed. Executed counts, seeds and minimized failures are public artifacts. These finite tests do not establish line/branch coverage or distributed-network behavior. The long scheduled campaign becomes active on the default branch after the owner's merge; a workflow definition is not execution evidence.

The [supply-chain policy](docs/testing/SUPPLY-CHAIN.md) pins GitHub Actions to full commits and verifies cargo-audit 0.22.2 before running `pnpm audit:dependencies`. npm high/critical findings and RustSec vulnerabilities block unless an explicit, unexpired exception passes its mitigation checks. The temporary `bigint-buffer@1.1.5` exception requires its native binding to be absent and its reviewed JavaScript fallback to match the pinned bytes; the raw high finding remains visible. Managed Dependabot confirmation requires a run against the merged default-branch configuration.

## Browser console core

[@mule/console-core](packages/console-core/README.md) shares the actual fixtures, scripted producer, validation rules/messages and canonical JSON with the Node packages. WebCrypto hashes exact UTF-8 bytes. Ajv standalone validators are generated at build time, then bundled into one versioned [ES module](packages/console-core/dist/console-core.mjs) with its [SHA-256](packages/console-core/dist/console-core.mjs.sha256). CI checks byte-identical reconstruction, the absence of dynamic compilation/Node/network APIs, and a maximum of 40,000 gzip bytes.

The module uses a scoped TypeScript escrow model, not the Anchor program or a chain. CI compares all six template/behavior cases and a designated-agent case with real SBF in LiteSVM: successive states, exact SPL deltas, terminal status, validator message and stored report hash. Real Chromium compares Node/browser canonical bytes and hashes under a strict CSP, offline after loading the local test assets. Finite scenario parity is not a universal equivalence proof. The package cannot send transactions or hold real funds; the site remains unchanged in part A.

## Ten local missions

The [one-command local runbook](docs/runbook-local.md) covers setup, explicit RPC URL, ephemeral genesis-funded wallets and the Agave internal-service limitation. CI's `local-missions` job uses the compiled program from `verify` and executes:

- three models × honest/dishonest, with honest payments and dishonest refunds;
- a designated-agent invoice;
- a client dispute resolved by the admin;
- an unaccepted expiry and an accepted-but-undelivered expiry.

The campaign checks balances, returned rent, closed accounts, terminal events and signatures. It injects four failures: `after-report`, `after-verdict`, `after-reserve` and `after-close`. Recovery consumes an ID reserved without creation, allocates a fresh ID, and reconstructs an already-closed mission from its original terminal transaction without settling twice. The extra consumed ID is not an eleventh created mission. An uncertain transaction is never blindly resent: replacement requires finalized blockhash expiry and retained chain evidence of non-execution. Content-addressed criteria, deliveries and reports live in `data/`; generated reference tables live in `runs/`. Local signatures have meaning only on that disposable test network.

## SDK mission IDs

The SDK refuses to build `create_mission` without a MissionIdHistory store and permanently reserves each program/client/ID tuple before returning the instruction. Use FileMissionIdHistory from @mule/sdk/file-history for durable Node history, and retain that directory across restarts. Its `isReserved` query supports recovery without releasing a reservation. Reservations remain after failed transactions, consumed-but-never-created attempts and closed missions. The runner uses this durable adapter throughout each network run; only one campaign driver may own a journal directory. InMemoryMissionIdHistory is only a test adapter. Deleting or rolling back history, using separate directories or bypassing the SDK defeats this off-chain guard; on-chain reuse after closure remains intentionally allowed.

[State machine](docs/state-machine.md) · [Threat model](docs/threat-model.md) · [Architecture](docs/architecture.md)

Schema checks prove encoded criteria, not truth. M-1 trusts its validator and dispute admin. No independent security audit has been performed.
