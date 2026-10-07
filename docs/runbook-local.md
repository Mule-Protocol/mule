# Run the ten local missions

This is the authorized M-1 step 3, extended by [M-1.1 hardening](spec/M1_1_HARDENING.md): a disposable local Solana network, a deterministic validator and an **agent de référence scripté**. It does not exercise a public Solana network, an AI API, a paid service or a real wallet.

## Prerequisites and one command

Use Linux x86-64 (or an equivalent Linux environment) with Node 24.21.0, pnpm 10.18.3, the verified Agave 2.3.0 release tools, and Anchor 0.32.2 plus platform-tools v1.56 for the developer build. Follow [the pinned download URLs and checksums](testing/BUILD-TOOLS.md), then install dependencies with `pnpm install --frozen-lockfile`.

The launcher is `pnpm local:missions --rpc-url http://127.0.0.1:8899`. The RPC URL is explicit: select a free local port; the following port is used for WebSocket. The launcher restricts itself to loopback HTTP. The runner receives the URL as a parameter and does not bake this address into its transaction logic.

**Agave's internal service:** the unmodified, SHA-256-verified Agave 2.3.0 binary starts an internal faucet thread unconditionally. There is no off switch in its CLI. The owner accepted this local, cost-free case with no external account/wallet/API connection, zero funding/caps and no calls to the service. Run:

```sh
pnpm local:missions --rpc-url http://127.0.0.1:8899
```

The faucet has zero genesis balance, zero per-request cap and zero per-time cap, on an automatically assigned port. The implementation never requests an airdrop or uses that service; all six test wallets are funded directly at genesis. These limits prevent funding, but do **not** remove the internal service. Source: [unconditional startup](https://github.com/anza-xyz/agave/blob/v2.3.0/validator/src/bin/solana-test-validator.rs#L315-L361), [available CLI switches](https://github.com/anza-xyz/agave/blob/v2.3.0/validator/src/cli.rs#L949-L985), [zero-cap behavior and automatic port](https://github.com/anza-xyz/agave/blob/v2.3.0/faucet/src/faucet.rs#L170-L219).

## What happens

1. The launcher checks the Agave version, builds the TypeScript packages and compiles fresh SBF/IDL with pinned Anchor/platform-tools, then compares the IDL with the versioned file. CI alone supplies MULE_REUSE_VERIFIED_BUILD=1 to reuse its verified same-run artifact.
2. It creates fresh admin, validator, client, agent, mint-authority and upgrade-authority keys in a private OS temporary directory. Each wallet receives local SOL in genesis. The loaded program uses the upgradeable loader and the ephemeral upgrade authority via `--upgradeable-program PROGRAM_ID PROGRAM_SO AUTHORITY_PUBKEY`.
3. It starts `solana-test-validator` with a fresh temporary ledger and waits for the explicit RPC URL to become healthy. It does not clone accounts or features from an external network.
4. The runner creates a six-decimal local dUSDC mint, initializes the config and lowers only this local config's dispute window to 60 seconds. The program default remains unchanged.
5. The campaign executes the six model/mode combinations, a designated-agent mission, a client dispute resolved by the admin, an unaccepted expiry and an accepted-but-undelivered expiry. It waits on the real local chain clock for short deadlines and the 60-second window.
6. Assertions verify recipients and token balances, vault/mission closure, rent returned, terminal events and transaction signatures. The failed deliveries must be refunded. Four process-fault injections exercise report persistence, confirmed verdict before local journal confirmation, ID reservation before signed-journal persistence, and closure before manifest persistence.
7. Reports are written to `runs/local-<UTC-date>-<run-id>.md` and the matching JSON. Criteria, deliveries and reports remain as `data/<sha256>.json`. The launcher stops its child processes and deletes its temporary wallet/ledger/state directory.

A new launcher invocation creates a new network. Persistent per-mission recovery is tested inside the campaign against the same live network and key set, not by replacing the ledger. The runner journal and SDK mission-ID history are kept in that run's private state directory throughout recovery.

## Storage, hashes and reproducibility

The URI stored on-chain is `https://raw.githubusercontent.com/Mule-Protocol/mule/main/data/<sha256>.json`, checked against the program's 200-byte limit. During the campaign the resolver reads local `data/`; every read is re-hashed. The URI is a future public reference and may not exist on main until the owner merges the report and its data files. No claim of present remote availability is made.

The public report includes model, honest/dishonest mode, exact validator message, outcome, client/agent token balances, returned rent and signatures. It also records consumed IDs and the before/after evidence for reservation and closure recovery. There are still ten created business missions: four paid and six refunded, including all three dishonest deliveries. The consumed-never-created ID is additional history, not an eleventh mission. Reconstructed settlement balances and rent use the original transaction's pre/post metadata. Evidence is useful only with its originating local genesis/run; local signatures are not links to a public explorer. Local dUSDC has no monetary value.

CI's `local-missions` job downloads the compiled SBF and IDL from the successful `verify` job, avoiding a second program compilation. It uses `permissions: contents: read`, has no repository secrets and never pushes. Its public artifact allowlist is the generated Markdown/JSON reports and content-addressed data JSON. Wallets, private journal/history, ledger and validator logs are excluded.

## Sweep and simulated time

`packages/runner/src/cli.ts sweep` uses the same RPC/key/state/data settings as the campaign and settles all due missions with `finalize`, `refund_expired` or `refund_stale`. It rereads chain state before selecting an operation. In a development integration, retain the same protected state directory and SDK history when restarting against the same ledger.

The seven-day stale refund and fourteen-day disputed fallback are **not** tested by waiting on this local network. LiteSVM exercises their exact clock boundaries and the sweep selection/execution with a simulated chain clock. The reference report and CHECKIN-3 separate these assertions from the ten actual local-network missions.

The process exits nonzero if any assertion or child process fails. The test tools never retry an invalid mission into a passing result. A failed campaign is not a successful check-in.

## Automatic recovery and limits

Use one campaign driver per private journal directory. The campaign injects real child-process exits and restarts with the same keys, history, journal and live ledger:

| Fault | Campaign row | Recovery and evidence |
| --- | --- | --- |
| `after-report` | 1 | Re-hash the stored report and submit the missing verdict once. |
| `after-verdict` | 2 | Recover the already-confirmed verdict by its original signature; no second verdict submission. |
| `after-reserve` | 3 | Check the derived PDA and retained history; mark the reserved ID `consumed-never-created`, retain its reservation and allocate a fresh ID. The consumed PDA remains absent with no signatures. |
| `after-close` | 4 | Recover the original terminal event and transaction metadata, then complete the manifest. Mission and vault stay closed; terminal signature and history count are unchanged. |

The row number is the campaign scenario, not necessarily its mission ID after recovery. Signed bytes, blockhash expiry, signing slot and broadcast intent are persisted before transmission. The runner attempts to broadcast each signature only once. An ambiguous transport error does not trigger a resend. A confirmed transaction is recovered as soon as its receipt is available. If the outcome remains unknown, the runner waits until the finalized block height exceeds the stored last-valid height, then consults signature status, the finalized transaction, PDA and full retained mission history. If the transaction landed, its original receipt is used. Only proven absence allows a replacement with a new blockhash; an expired creation consumes its old ID and obtains a fresh ID/deadline through the SDK.

The bounded wait retains state when the RPC cannot yet establish a definitive outcome. Disagreeing views, pruned required history, missing terminal evidence or a transition under another signature prevent replacement. Restart the runner against the same retained environment; its `create <row>`, `settle <row>` and `sweep` commands perform the corresponding reconciliation automatically. Starting the outer launcher again intentionally creates a different disposable network and cannot recover a deleted ledger or keys.

These four scenarios do not prove recovery from arbitrary disk corruption, lost keys/history, concurrent drivers, a dishonest RPC or distributed forks. [The threat model](threat-model.md) records these limits. Property tests exercise the actual SBF separately; use the [one-command seed reproducer](testing/FUZZING.md) for a counterexample. The [audit policy](testing/SUPPLY-CHAIN.md) documents the conditional, time-limited bigint-buffer mitigation; a passing audit policy does not mean zero findings.
