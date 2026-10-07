# MULE · devnet escrow

Acceptance-gated settlement on Solana **devnet only**. Apache-2.0.

## Status

M-1, step 1: program and SDK implementation is pending. No deployed program.

- Program ID (devnet): **not deployed**.
- Latest public run: **none yet** (step 4).
- CI: **not configured yet** (step 1 draft PR).
- Settlement asset: **dUSDC (devnet, no value)**.
- Reference agent: **agent de référence scripté ; le branchement d'un agent IA réel est prévu plus tard**.

## Authoritative specifications

Original specifications are copied without modification into `docs/spec/`:

- [v2](docs/spec/SPEC_M-1_devnet_v2.md), including v1 program details;
- [v1](docs/spec/PROMPT_M-1_devnet.md), particularly sections 2.4 and 2.5;
- [Current owner request](docs/spec/M1_FREE_ARCHITECTURE.md), which overrides hosting, console, agent implementation and delivery order with the free CLI/GitHub Actions architecture.

Only free tools and the public devnet RPC are permitted. No mainnet, real funds, $MULE token operations, paid providers, or new owner accounts. The separate `mule-site` remains a simulation and is outside this milestone.

Each stage ends at a documented check-in and an independent review. All implementation goes through draft pull requests. Only the owner merges.
