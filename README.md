# MULE · acceptance-gated escrow

[![CI](https://github.com/Mule-Protocol/mule/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Mule-Protocol/mule/actions/workflows/ci.yml)

**Development and disposable local-network tests only. No public deployment.** Apache-2.0.

MULE holds a client's tokens and pays the accepted agent after a signed passing verdict and dispute window, or an admin ruling. Failed, expired and stale missions refund the client. A client may designate the only agent allowed to accept. Unresolved disputes become permissionlessly finalizable after fourteen days using the original validator verdict; the admin role transfers in two steps. The current validator cannot create or accept a mission or be its designated agent.

- Public-cluster program ID: **none**.
- Test-only identity: Fg6PaFpoGXkYsidMpWxTWqkZ7FEfcYkgMQHGho8KDXgL.
- Settlement fixture: **local dUSDC, six decimals, no value**.
- [Merged step 1 PR](https://github.com/Mule-Protocol/mule/pull/6) · [Milestone](https://github.com/Mule-Protocol/mule/milestone/1).
- [Check-in 1b](docs/checkins/CHECKIN-1b.md) · [Historical check-in 1](docs/checkins/CHECKIN-1.md).
- [CI runs and evidence](https://github.com/Mule-Protocol/mule/actions/workflows/ci.yml).
- Step 3 uses an **agent de référence scripté**, with honest/dishonest modes and a deterministic validator. No AI API is called.

## Scope and sources

The [owner's local-only update](docs/spec/M1_LOCAL_ONLY_UPDATE.md) supersedes deployment in the [free architecture request](docs/spec/M1_FREE_ARCHITECTURE.md). Original [v2](docs/spec/SPEC_M-1_devnet_v2.md) and [v1](docs/spec/PROMPT_M-1_devnet.md) remain byte-for-byte preserved. Check-in 1b and the authorized step 3 correct and extend the protocol.

No public deployment, devnet mint, external faucet, devnet-run workflow, GitHub secrets, paid provider, mainnet, $MULE or site modification. Only the owner merges. Development stops at CHECKIN-3. `solana-verify` is deferred until the first deployment. The mandated Agave test binary has an unavoidable internal faucet service: [the runbook](docs/runbook-local.md) documents the accepted cost-free local case with zero funding/caps and no calls; no airdrop is used.

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
```

The program suite runs compiled SBF in LiteSVM with synthetic clock/ProgramData fixtures and ephemeral keys. It tests seven-day stale and fourteen-day dispute timeouts without real-time waits. The [versioned IDL](idl/mule_escrow.json) is compared byte-for-byte with a fresh build in CI. Anchor may create an unused disposable build keypair under ignored target/deploy; it is neither uploaded nor cached.

## Ten local missions

The [one-command local runbook](docs/runbook-local.md) covers setup, explicit RPC URL, ephemeral genesis-funded wallets and the Agave internal-service limitation. CI's `local-missions` job uses the compiled program from `verify` and executes:

- three models × honest/dishonest, with honest payments and dishonest refunds;
- a designated-agent invoice;
- a client dispute resolved by the admin;
- an unaccepted expiry and an accepted-but-undelivered expiry.

The campaign checks balances, returned rent, closed accounts, terminal events and signatures. It injects failures at both verdict persistence boundaries and verifies safe recovery. Content-addressed criteria, deliveries and reports live in `data/`; generated reference tables live in `runs/`. Local signatures have meaning only on that disposable test network.

## SDK mission IDs

The SDK refuses to build `create_mission` without a MissionIdHistory store and permanently reserves each program/client/ID tuple before returning the instruction. Use FileMissionIdHistory from @mule/sdk/file-history for durable Node history, and retain/share that directory across instances. Reservations remain after failed transactions and closed missions. The runner uses this durable adapter throughout each network run. InMemoryMissionIdHistory is only a test adapter. Deleting or rolling back history, using separate directories or bypassing the SDK defeats this off-chain guard; on-chain reuse after closure remains intentionally allowed.

[State machine](docs/state-machine.md) · [Threat model](docs/threat-model.md) · [Architecture](docs/architecture.md)

Schema checks prove encoded criteria, not truth. M-1 trusts its validator and dispute admin. No independent security audit has been performed.
