# Task for Astra: milestone M-1 — devnet escrow and live console

## Goal

Ship the first working version of MULE on Solana **devnet**: an escrow program that pays an agent only when its delivery passes criteria fixed in advance, a validator that checks deliveries, a reference agent, and the site's mission console running on it instead of the simulation.

**Exit criteria (from the public mission log):**

1. 100 missions created on devnet from the public console, each settled or refunded, every transaction visible on Solana Explorer.
2. Every mission run with a dishonest agent ends refunded. Zero exceptions.
3. Source code public on GitHub under `github.com/mule-protocol/mule`, Apache-2.0.

**Hard limits:** devnet only. No mainnet deployment, no real funds, nothing that touches the $MULE token. Stop and ask before anything outside this document.

Read first: the dossier (`mule-dossier.html`, sections 04 to 06 and 10), the site brief (`MULE_site_prompt.md`, section 5.4 console) and the prototype (`mule-site.html`, console simulator and `runMission`).

---

## 1. Repository layout

One monorepo, `pnpm` workspaces:

```
programs/mule_escrow/     Anchor program (Rust)
packages/sdk/             TypeScript client: PDAs, instructions, account decoding, events
services/validator/       Validator service (TypeScript, Node 22)
services/agent/           Reference agent (TypeScript)
services/console-api/     API used by the site console (Cloudflare Pages Functions / Workers)
fixtures/                 Criteria schemas and sample inputs (invoices, contracts, address lists)
scripts/                  Devnet setup: dUSDC mint, config init, faucet wallet funding
docs/                     Architecture, state machine, runbook
```

CI (GitHub Actions): build, `anchor test`, lint, type-check on every pull request. `main` protected.

---

## 2. The escrow program

### 2.1 Accounts

**`Config`** — PDA seeds `["config"]`
| Field | Type | Notes |
|---|---|---|
| admin | Pubkey | Resolves disputes on M-1. Use a Squads multisig on devnet too, to rehearse. |
| validator | Pubkey | The only key allowed to record verdicts. |
| mint | Pubkey | The settlement token (dUSDC on devnet). |
| min_dispute_window | i64 | Seconds. Default 3600 on devnet. |
| max_amount | u64 | Per-mission cap, base units. Default 100 dUSDC. |
| paused | bool | Blocks `create_mission` only; funds can always leave. |
| bump | u8 | |

**`Mission`** — PDA seeds `["mission", client, mission_id (u64 LE)]`
| Field | Type | Notes |
|---|---|---|
| client | Pubkey | |
| agent | Option<Pubkey> | Set on accept. |
| mission_id | u64 | Chosen by the client, unique per client. |
| amount | u64 | Locked in the vault. |
| criteria_hash | [u8; 32] | sha256 of the criteria JSON. |
| criteria_uri | String (≤ 200) | Where the criteria live. |
| delivery_hash | Option<[u8; 32]> | sha256 of the delivery. |
| delivery_uri | Option<String> (≤ 200) | |
| report_hash | Option<[u8; 32]> | sha256 of the validator report. |
| deadline | i64 | Unix time; no delivery by then = refundable. |
| dispute_window | i64 | Seconds, ≥ `min_dispute_window`. |
| verdict_at | Option<i64> | |
| status | enum | See 2.3. |
| bump, vault_bump | u8 | |

**Vault** — token account PDA seeds `["vault", mission]`, authority = the mission PDA.

### 2.2 Instructions

| Instruction | Signer | Effect |
|---|---|---|
| `initialize_config` | deployer | Creates `Config`. Once. |
| `update_config` | admin | Validator, caps, window, pause. |
| `create_mission(mission_id, amount, criteria_hash, criteria_uri, deadline, dispute_window)` | client | Creates mission and vault, transfers `amount` client → vault. Checks mint, cap, deadline in the future, not paused. |
| `cancel_mission` | client | Only while `Open` (no agent yet). Vault → client, close accounts. |
| `accept_mission` | agent | `Open` → `Accepted`, stores agent. Agent ≠ client. |
| `submit_delivery(delivery_hash, delivery_uri)` | agent | `Accepted` → `Submitted`, before deadline. |
| `record_verdict(pass, report_hash)` | config.validator | `Submitted` → `Passed` or `Failed`, sets `verdict_at`. |
| `open_dispute` | client or agent | Only `Passed`/`Failed` and within `verdict_at + dispute_window`. → `Disputed`. |
| `resolve_dispute(pay_agent)` | config.admin | `Disputed` → `Settled` (pay agent) or `Refunded`. Transfers and closes. |
| `finalize` | anyone | After the window: `Passed` → vault → agent, `Settled`; `Failed` → vault → client, `Refunded`. Closes vault and mission, rent to client. |
| `refund_expired` | anyone | `Open`/`Accepted` past `deadline` → vault → client, `Refunded`. |
| `refund_stale` | anyone | `Submitted` with no verdict 7 days after `deadline` → vault → client, `Refunded`. Funds never stay stuck if the validator is down. |

Every instruction emits an Anchor event (`MissionCreated`, `MissionAccepted`, `DeliverySubmitted`, `VerdictRecorded`, `DisputeOpened`, `MissionSettled`, `MissionRefunded`, `MissionCancelled`) carrying mission, amount and status. The console and telemetry read these.

### 2.3 State machine

```
Open ──accept──▶ Accepted ──submit──▶ Submitted ──verdict──▶ Passed ─┬─(window ends) finalize──▶ Settled
  │                 │                                         Failed ─┤─(window ends) finalize──▶ Refunded
  │                 │                                                 └─open_dispute──▶ Disputed ──resolve──▶ Settled | Refunded
  ├─cancel──▶ Cancelled
  └─(deadline, no delivery) refund_expired──▶ Refunded   (also from Accepted)
Submitted ──(deadline + 7 days, no verdict) refund_stale──▶ Refunded
```

Any transition not drawn here must fail with a named error.

### 2.4 Security requirements

- Every account constrained with Anchor `has_one` / `seeds` / `constraint`; mint of every token account equals `config.mint`.
- Checked arithmetic everywhere; no `unwrap()` on user input.
- Funds can only move to the mission's own client or agent. No instruction takes a destination address as an argument.
- `paused` never traps funds: cancel, finalize, refund and resolve keep working.
- Upgrade authority: the devnet deployer for now, written down in `docs/runbook.md`, moved to a Squads multisig before M-3.
- No admin power to take funds. The admin can only choose between the mission's client and agent in a dispute.

### 2.5 Tests (`anchor test`)

Cover every row of 2.2 and every arrow of 2.3, plus at least these negative cases:

- wrong signer on each restricted instruction;
- verdict recorded twice; finalize twice; finalize before the window ends;
- dispute after the window; dispute by a third party;
- delivery after the deadline; accept by the client;
- wrong mint; amount above the cap; create while paused (but cancel/finalize/refund still work while paused);
- refund_expired before the deadline; refund_stale before deadline + 7 days or after a verdict.

Report coverage per instruction in the pull request.

---

## 3. Settlement token on devnet

Create a devnet SPL mint **dUSDC** (6 decimals) with `scripts/`. Mint authority: a devnet-only key held by the console API faucet wallet. Never call it USDC in the UI; always "dUSDC (devnet, no value)".

---

## 4. Storage for criteria, deliveries and reports

Content-addressed JSON in Cloudflare R2 (bucket `mule-devnet`, public read through a custom domain or r2.dev). The key is the sha256 hex of the bytes; the URI is stored on-chain with the hash. Anything fetched is re-hashed and rejected if the hash differs. Public read, write only from the services.

---

## 5. Validator service (`services/validator`)

- Runs as a Cloudflare Worker consuming a Cloudflare Queue: the console API (or the agent, after `submit_delivery`) enqueues the mission address. A Cron Trigger every minute also sweeps for any mission left in `Submitted` without a verdict.
- Fetches criteria and delivery, checks both hashes.
- Criteria format, version 1: a JSON Schema (draft 2020-12) plus a list of named cross-checks. For `invoice.v1`: required fields `supplier, date, number, currency, total_amount, line_items`; cross-check: `total_amount` equals the sum of `line_items[].amount` to 2 decimals.
- Validates with Ajv, runs the cross-checks, builds a report `{mission, schema, results: [{check, pass, detail}], pass}`, stores it, calls `record_verdict(pass, report_hash)`.
- Idempotent: a restart never records two verdicts (the program also forbids it).
- Deterministic: no LLM in the validator. Same inputs, same verdict.
- Its key is devnet-only, stored as an encrypted environment variable, never in the repository.
- The same cron sweep runs `finalize`, `refund_expired` and `refund_stale` for missions whose time has come, so nothing stays stuck.

---

## 6. Reference agent (`services/agent`)

- Accepts missions from the console's faucet client only (no open marketplace on M-1).
- Three templates, matching the console: invoice to JSON, contract summary in 5 fields, address list normalization. Sample inputs in `fixtures/`.
- Uses an LLM API of your choice to produce the JSON; the prompt and model are configurable.
- `honest` mode: returns its best output. `dishonest` mode: removes or corrupts exactly one required value (for invoices, drops `total_amount`), so the validator must refuse it.
- Stores the delivery, calls `submit_delivery`.
- LLM spend capped per day; when the cap is hit the console says so instead of failing silently.

---

## 7. Console API and site integration (`services/console-api`)

- `POST /api/missions {template, behavior}` → creates a mission with the faucet wallet as client (5 dUSDC), triggers the agent, returns `{missionId}`.
- `GET /api/missions/:id/stream` → Server-Sent Events, one event per program event, with the transaction signature.
- `GET /api/telemetry` → counts of missions created, settled, refunded (read from program accounts/events), cached 30 s.
- Rate limit: 3 missions per IP per hour and a global daily cap, with a clear "Console is busy, try again later" state. Add a bot check (Cloudflare Turnstile) before launching a mission.
- In the site, replace the simulator behind the same interface (`runMission(template, behavior) → AsyncIterable<Step>`). Steps now show real transaction signatures linking to `https://explorer.solana.com/tx/<sig>?cluster=devnet`.
- Console labels change from `SIMULATION` to `DEVNET · dUSDC HAS NO VALUE`. The ticker label changes from `SIMULATED FEED` to `DEVNET FEED` and reads real events.
- Mission patches use the real on-chain mission ID.
- RPC: a dedicated devnet RPC provider (Helius or similar), key server-side only.

---

## 8. Hosting on Cloudflare

Everything runs in the project's Cloudflare account, next to the site:

- **Console API**: Pages Functions in the `mule-site` project (same domain, no CORS).
- **Agent and validator**: Workers, triggered by a Cloudflare Queue, plus a Cron Trigger (every minute) for sweeps.
- **Storage**: R2 bucket `mule-devnet`.
- **Secrets** (validator key, faucet wallet key, RPC key, LLM key): Worker secrets, never in the repository.
- **Credentials**: the owner extends your API token with **Account › Workers Scripts › Edit**, **Account › Workers R2 Storage › Edit** and **Account › Queues › Edit** when M-1 starts.

If a Workers limit blocks something (CPU time, a library that needs Node APIs), describe it and propose an alternative host; ask before using it.

## 9. Order of work and check-ins

Stop at each check-in and send a short report (what's done, links, open questions) before continuing.

1. **Program and tests.** Accounts, instructions, events, full test suite green. → *Check-in 1: repo link, test report, the state machine as implemented.*
2. **Devnet deploy and scripts.** dUSDC mint, config, program deployed, one mission run end to end by script (honest and dishonest). → *Check-in 2: program ID, explorer links for both runs.*
3. **Validator, agent, storage.** Running as services, idempotency tested by killing and restarting them mid-mission. → *Check-in 3: 10 missions by script, all correct.*
4. **Console integration on a preview URL.** → *Check-in 4: preview link, video of an honest and a dishonest run.*
5. **Public run.** Merge to production after the owner's go. Count missions until 100 meet the exit criteria. → *Final report: program ID, the list of 100 mission addresses with outcomes, every dishonest run refunded, incidents if any.*

---

## 10. Rules

- Devnet only. Never deploy to mainnet, never handle mainnet keys, never touch $MULE.
- No secrets in the repository or in client code. All keys in encrypted environment variables.
- Nothing in the UI may suggest real money: dUSDC is labelled "no value" everywhere.
- Don't add features outside this document (no token staking, no bonds, no marketplace). They belong to later milestones.
- If a requirement here is unclear or conflicts with the dossier, stop and ask.
