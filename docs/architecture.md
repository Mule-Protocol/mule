# Architecture · local CI only

[Current scope](spec/M1_LOCAL_ONLY_UPDATE.md) overrides hosting/deployment in the originals. [Check-in 1b](checkins/CHECKIN-1b.md) records the subsequent owner-approved protocol corrections.

- programs/mule_escrow: Anchor 0.32.2, classic SPL Token escrow, optional designated agent, 14-day dispute fallback, and two-step admin transfer.
- packages/sdk: IDL-driven TypeScript instructions, PDAs, account decoding, scoped event parsing and program/client/mission-ID history guard with a durable Node file adapter. No RPC/wallet/transaction sender.
- tests: compiled SBF in LiteSVM 0.8.0, signature verification enabled, ephemeral keys and clock control. Each scenario runs once in a separate Node process; evidence is aggregated without retries.
- scripts/instruction-coverage.mjs: executed assertion matrix requiring positive and negative coverage for each of 14 instructions.
- Public CI on pull requests and pushes to main: build, formatting, clippy, TypeScript/lint, SDK tests, anchor test invoking LiteSVM, public evidence artifacts.
- Step 3 reserves validator, agent and runner. No placeholder implementations are presented as complete.

CI Node runtime: 24.21.0 (ABI 137). SDK is also checked locally on Node 22.

Build pins: Anchor 0.32.2, Solana CLI 2.3.0, platform-tools v1.56 (Rust 1.89.0).
Anchor TypeScript is 0.32.1; no 0.32.2 npm package exists. Compatibility is validated against the generated IDL.

The Anchor CLI is obtained from the versioned release in the official otter-sec/anchor repository. CI verifies its pinned SHA-256 before executing it. Solana CLI is obtained as a versioned release archive, verified against its pinned SHA-256 before extraction and execution; CI does not pipe a downloaded installer into a shell. The checked-in workflow is the authoritative record of asset URLs and expected hashes; [build-tool sources and checksum verification](testing/BUILD-TOOLS.md) records their provenance.

Primary sources: [Anchor release](https://github.com/otter-sec/anchor/releases/tag/v0.32.2), [platform-tools](https://github.com/anza-xyz/platform-tools/releases/tag/v1.56), [LiteSVM](https://github.com/LiteSVM/litesvm), [account constraints](https://www.anchor-lang.com/docs/references/account-constraints).

CI downloads open-source dependencies. It does not contact a Solana RPC, use a faucet, mint on devnet or deploy a program. solana-verify remains deferred until the first deployment.
