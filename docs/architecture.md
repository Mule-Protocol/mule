# Architecture · local CI only

[Current scope](spec/M1_LOCAL_ONLY_UPDATE.md) excludes public deployments. [Check-in 1b](checkins/CHECKIN-1b.md) records the approved protocol corrections; step 3 adds the deterministic acceptance pipeline and a disposable local-network campaign.

- `programs/mule_escrow`: Anchor 0.32.2, classic SPL Token escrow, designated agents, fourteen-day disputed fallback, two-step admin transfer and validator/participant separation at creation and acceptance.
- `packages/sdk`: IDL-driven instructions, PDAs, decoding, scoped event parsing and permanent program/client/mission-ID reservations with a durable Node adapter.
- `packages/validator`: deterministic Ajv JSON Schema 2020-12 and cross-field checks for `invoice.v1`, `contract.v1` and `address.v1`. No AI call. Reports are content-addressed; their byte hash is the on-chain report hash.
- `packages/agent`: **agent de référence scripté**, behind a delivery-production interface. Honest mode returns the fixture data. Dishonest mode corrupts exactly the specified required field or row-7 postcode.
- `fixtures/`: the three test models and their criteria/input examples.
- `packages/runner`: parameterized RPC orchestration, mint/config setup, ten-mission campaign, settlement sweep, durable transaction journal and SDK mission-ID history. Chain state is checked before verdict submission or settlement so crash recovery does not invent a second verdict.
- `data/`: JSON objects named by SHA-256; the local resolver re-hashes every read. On-chain URIs point to the public main-branch raw URL, with a 200-byte maximum. Remote retrieval is not used during local tests.
- `scripts/run-local-missions.mjs`: generates private temporary keys/genesis accounts, starts the verified Agave test validator with the upgradeable program loaded at genesis, invokes the runner, then tears down its own processes and temporary files.
- `tests/`: compiled SBF in LiteSVM 0.8.0, real signature checks, ephemeral keys and controlled time. Each program scenario runs once in an isolated process. Seven-day stale and fourteen-day dispute timeouts and sweep are tested with simulated time, separately from the live local campaign.
- `scripts/instruction-coverage.mjs`: executed assertion matrix requiring success and rejection coverage for all fourteen instructions.
- Public CI on pull requests and pushes to main: the `verify` job builds and tests once; `local-missions` downloads that SBF/IDL, starts its own local node, runs the campaign and uploads only public report/data evidence. No secrets or CI pushes.

## Local runtime boundaries

The application runner receives `MULE_RPC_URL`; it is not tied to a hardcoded host. The one-command development launcher permits loopback HTTP only. No public RPC, feature/account cloning, AI API or paid service is used. Local dUSDC is a six-decimal fixture mint with no value. The default on-chain minimum dispute window remains 3600 seconds; only the disposable local config is changed to 60 seconds.

Six role keys are freshly generated per run. Genesis supplies local SOL without an airdrop. The program is inserted as an upgradeable genesis program with a fresh authority, satisfying the loader ProgramData authority check. This is a local test fixture, not a deployment transaction. Private keys, CLI config, ledger, logs, transaction journal and mission-ID history live under a private temporary directory, outside repository and artifact paths.

The unchanged Agave 2.3.0 executable unconditionally starts a built-in faucet thread. Setting its balance and caps to zero prevents funding but does not remove that thread. The owner accepted this cost-free local case with no service calls or external account/wallet/API connection. This upstream limitation and source references are recorded in the [runbook](runbook-local.md); no airdrop call exists in the campaign.

## Build tools and evidence

CI Node runtime: 24.21.0 (ABI 137). Tool pins: Anchor CLI 0.32.2, Agave/Solana CLI 2.3.0, platform-tools v1.56 (Rust 1.89.0). Anchor TypeScript is 0.32.1; compatibility is checked against the generated and versioned IDL.

CI obtains Anchor from the official `otter-sec/anchor` versioned release and verifies its pinned SHA-256 before execution. It verifies the Agave archive before extraction; no downloaded installer is piped into a shell. [Build-tool sources and checksum procedure](testing/BUILD-TOOLS.md) records provenance. The local job verifies the same Agave archive.

Artifacts contain coverage, IDL, compiled SBF and content-addressed campaign evidence, never keys. `solana-verify` remains deferred until the first deployment. See the [local runbook](runbook-local.md), [state machine](state-machine.md) and [threat model](threat-model.md).

Primary sources: [Anchor release](https://github.com/otter-sec/anchor/releases/tag/v0.32.2), [Agave upgradeable genesis and account arguments](https://github.com/anza-xyz/agave/blob/v2.3.0/validator/src/cli.rs#L737-L765), [Agave account loader](https://github.com/anza-xyz/agave/blob/v2.3.0/test-validator/src/lib.rs#L504-L539), [platform-tools](https://github.com/anza-xyz/platform-tools/releases/tag/v1.56), [LiteSVM](https://github.com/LiteSVM/litesvm).
