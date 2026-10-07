# Architecture · local CI only

[Current scope](spec/M1_LOCAL_ONLY_UPDATE.md) overrides hosting/deployment in the originals.

- programs/mule_escrow: Anchor 0.32.2, classic SPL Token escrow.
- packages/sdk: IDL-driven TypeScript instructions, PDAs, account decoding and scoped event parsing. No RPC/wallet/transaction sender.
- tests: compiled SBF in LiteSVM 0.8.0, signature verification enabled, ephemeral keys and clock control. Each scenario runs once in a separate Node process; evidence is aggregated without retries.
- scripts/instruction-coverage.mjs: executed assertion matrix requiring positive and negative coverage for each of 12 instructions.
- Public CI: build, formatting, clippy, TypeScript/lint, SDK tests, anchor test invoking LiteSVM, public evidence artifacts.
- Step 3 reserves validator, agent and runner. No placeholder implementations are presented as complete.

CI Node runtime: 24.21.0 (ABI 137). SDK is also checked locally on Node 22.

Build pins: Anchor 0.32.2, Solana CLI 2.3.0, platform-tools v1.56 (Rust 1.89.0).
Anchor TypeScript is 0.32.1; no 0.32.2 npm package exists. Compatibility is validated against the generated IDL.

Primary sources: [Anchor release](https://github.com/otter-sec/anchor/releases/tag/v0.32.2), [platform-tools](https://github.com/anza-xyz/platform-tools/releases/tag/v1.56), [LiteSVM](https://github.com/LiteSVM/litesvm), [account constraints](https://www.anchor-lang.com/docs/references/account-constraints).

CI downloads open-source dependencies. It does not contact a Solana RPC, use a faucet, mint on devnet or deploy a program.
