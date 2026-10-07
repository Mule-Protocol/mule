# MULE · Milestone M-1 spec (v2): devnet escrow and live console

v2 supersedes `PROMPT_M-1_devnet.md` (v1). It keeps v1's program design and updates everything around it to the site as it exists today (Astro static + Pages Functions on Cloudflare, strict CSP, the `runMission` interface, the `/m/[id]` patch routes).

## Goal

Ship the first working version of MULE on Solana **devnet**:
- an escrow program that pays an agent only when its delivery passes criteria fixed in advance;
- a deterministic validator that checks deliveries;
- a reference agent;
- the site's mission console running on it instead of the simulation.

**Exit criteria (public mission log):**
1. 100 missions created on devnet from the public console, each settled or refunded, every transaction visible on Solana Explorer.
2. Every mission run with a dishonest agent ends refunded. Zero exceptions.
3. Source code public at `github.com/Mule-Protocol/mule`, Apache-2.0.

**Hard limits:**
- Devnet only.
- No mainnet deployment, no mainnet keys, no real funds.
- Nothing that touches the $MULE token.
- Stop and ask before anything outside this document.

**Read first:**
- the dossier at `/dossier/` on the site: sections 04 to 06 and 10;
- in the `mule-site` repository:
  - `reference/MULE_site_prompt.md`, section 5.4;
  - `src/lib/run-mission.ts`, the interface to replace;
  - `src/scripts/console.ts`;
  - `src/data/mission.mjs`, the strict patch ID parser;
  - `functions/`, `src/server/` and `public/_routes.json`.

---

## 1. Repositories

There are two repositories.

**`Mule-Protocol/mule`** is new, public, Apache-2.0. It is a monorepo with `pnpm` workspaces:

```
programs/mule_escrow/     Anchor program (Rust)
packages/sdk/             TypeScript client: PDAs, instructions, account decoding, events
services/validator/       Cloudflare Worker: queue consumer + cron sweeper
services/agent/           Cloudflare Worker: reference agent
services/console-api/     Cloudflare Worker: the API used by the site console
fixtures/                 Criteria schemas and sample inputs (invoices, contracts, address lists)
scripts/                  Devnet setup: dUSDC mint, config init, wallet funding
docs/                     Architecture, state machine, runbook, threat model
```

CI (GitHub Actions) runs on every pull request: build, `anchor test`, lint, type-check, and Worker unit tests. The `main` branch is protected; the owner sets up the protection.

**`Mule-Protocol/mule-site`** is the existing site. It only receives:
- a thin same-origin proxy, `functions/api/[[path]].ts`, that forwards to the `console-api` Worker through a **Pages Service binding** (`CONSOLE_API`) ;
- the console integration (section 7).

The site never holds a Solana key or an RPC key.

---

## 2. The escrow program

Unchanged from v1. In summary:

| Element | Content |
| --- | --- |
| Accounts | `Config` (PDA `["config"]`), `Mission` (PDA `["mission", client, mission_id u64 LE]`), and a vault token account (PDA `["vault", mission]`) whose authority is the mission PDA |
| Instructions | `initialize_config`, `update_config`, `create_mission`, `cancel_mission`, `accept_mission`, `submit_delivery`, `record_verdict`, `open_dispute`, `resolve_dispute`, `finalize`, `refund_expired`, `refund_stale` |
| Events | one Anchor event per transition, carrying the mission, the amount and the status |

State machine (any transition not drawn here fails with a named error):

```
Open ──accept──▶ Accepted ──submit──▶ Submitted ──verdict──▶ Passed ─┬─(window ends) finalize──▶ Settled
  │                 │                                         Failed ─┤─(window ends) finalize──▶ Refunded
  │                 │                                                 └─open_dispute──▶ Disputed ──resolve──▶ Settled | Refunded
  ├─cancel──▶ Cancelled
  └─(deadline, no delivery) refund_expired──▶ Refunded   (also from Accepted)
Submitted ──(deadline + 7 days, no verdict) refund_stale──▶ Refunded
```

Security requirements:
- every account is constrained with Anchor `has_one`, `seeds` or `constraint`, and every token account's mint equals `config.mint`;
- checked arithmetic everywhere, and no `unwrap()` on input;
- funds only ever move to the mission's own client or agent: no instruction takes a destination address;
- `paused` never traps funds;
- the admin can only choose between the client and the agent in a dispute;
- upgrade authority stays with the devnet deployer, written down in `docs/runbook.md`, and moves to a Squads multisig before M-3.

Tests: every instruction and every arrow, plus the negative cases listed in v1 §2.5. Report coverage per instruction.

**Console timing.** For the public console, `dispute_window` is the devnet `min_dispute_window`. Set it to **60 seconds** for console missions, so a visitor sees the final settlement within about 2 minutes. Keep 3600 seconds as the default for any other caller. Document this in the runbook.

---

## 3. Settlement token

- Devnet SPL mint **dUSDC**, 6 decimals.
- Mint authority: a devnet-only key.
- The UI always labels it **"dUSDC (devnet, no value)"**, never "USDC".

## 4. Storage

Content-addressed JSON in Cloudflare R2, bucket `mule-devnet`:
- the key is the sha256 hex of the bytes;
- the URI is stored on-chain with the hash;
- public read through an `r2.dev` URL or a path served by `console-api`, write only from the Workers;
- anything fetched is re-hashed and rejected if the hash differs.

## 5. Validator (`services/validator`)

As in v1:
- a Queue consumer, plus a Cron Trigger every minute;
- **deterministic**, with Ajv (JSON Schema draft 2020-12) and named cross-checks;
- idempotent, with no LLM;
- the cron also runs `finalize`, `refund_expired` and `refund_stale` when they are due.

Criteria `invoice.v1`:
- required fields: `supplier, date, number, currency, total_amount, line_items` ;
- cross-check: `total_amount` equals the sum of `line_items[].amount`, to 2 decimals.

Write `contract.v1` (5 fields, including `governing_law`) and `address.v1` (12 rows with normalised postcodes) the same way. Their failure messages must match the console's: `5/6 · MISSING: total_amount`, `4/5 · MISSING: governing_law`, `11/12 · INVALID POSTCODE, ROW 7`.

## 6. Reference agent (`services/agent`)

As in v1:
- three templates;
- `honest` and `dishonest` modes. `dishonest` corrupts exactly one required value: for invoices, it drops `total_amount`.

LLM:
- Anthropic API by default, with model `claude-haiku-4-5-20251001`;
- model and prompt configurable;
- the key is a Worker secret provided by the owner;
- a hard daily spend cap. When the cap is reached, the console shows "Agent resting until tomorrow (daily budget reached)".

If no LLM key is configured, the agent returns the deterministic fixture output for the template, and the report says so. This keeps the development and test runs free.

## 7. Console API and site integration

### 7.1 `console-api` Worker

| Route | Effect |
| --- | --- |
| `POST /api/missions {template, behavior, turnstileToken}` | Verifies Turnstile server-side, applies the rate limits, creates the mission with the faucet wallet as client (5 dUSDC), enqueues the agent, returns `{mission}` (the mission PDA, base58) |
| `GET /api/missions/:mission/events` | Returns the program events for that mission since a cursor, with transaction signatures |
| `GET /api/telemetry` | Missions created, settled and refunded, cached 30 s |

- **Polling**: the client polls `/events` every 1.5 s (no SSE). This keeps Worker CPU and wall time small. Stop polling on a final status or after 3 minutes.
- **Rate limits**: 3 missions per IP per hour, and a global daily cap, configurable and starting at 300. When either is reached, the console shows "Console is busy, try again later".
- **IP handling**: IPs are used only for rate limiting, in memory or in a short-lived counter. They are never stored with mission data and never logged.
- **RPC**: a dedicated devnet RPC key is a server-side secret. Until the owner provides one, use the public devnet endpoint, and document its limits.
- **Inputs**: strict validation, an allowlist for `template` and `behavior`, and a constant error message. No user-supplied text ever reaches the chain, storage or HTML.

### 7.2 Site (`mule-site`)

- **Service binding.** Add the `CONSOLE_API` binding to the Pages project. `functions/api/[[path]].ts` only forwards to it, adds no CORS header, and keeps the security headers and the `noindex` on `/api/*`.
- **Same interface.** Replace the simulator behind `runMission(template, behavior) → AsyncIterable<Step>`, and keep the simulator as a fallback. A build setting, `CONSOLE_MODE: 'simulation' | 'devnet'`, chooses the mode.
  - In `devnet` mode, if the API is unreachable or busy, the console says so clearly. It never silently falls back to the simulation.
  - `Step` gains an optional `signature`. The console renders it as a link to `https://explorer.solana.com/tx/<sig>?cluster=devnet`, with `rel="noopener"`.
- **CSP.** Add only what Turnstile needs: `https://challenges.cloudflare.com` in `script-src` and `frame-src`. Nothing else, and never `unsafe-inline`. Load Turnstile only when the visitor opens the console form, not on page load. Mobile LCP must stay below 2 s.
- **Copy in `devnet` mode.** Change only these labels:
  - `SIMULATION · NO REAL FUNDS · DEVNET VERSION IN DEVELOPMENT` → `DEVNET · dUSDC HAS NO VALUE`
  - `FAKE HASHES · NO ON-CHAIN TRANSACTIONS` → `REAL DEVNET TRANSACTIONS · NO REAL FUNDS`
  - Hero ticker `SIMULATED FEED` → `DEVNET FEED`. It reads real events through `/api/telemetry` or a recent-events route. If none are available, it shows the last known events, labelled.

  Leave every other text as it is: the owner will provide the FAQ and mission log updates at the public run.
- **Patches.**
  - Add a second strict ID format for real missions: `/m/d-<mission PDA base58>`, 32 to 44 characters, base58 alphabet only, anything else 404.
  - The page and the OG image **read the mission account (or its final event) on devnet server-side** and show the true status. They must never trust the URL for the outcome.
  - Cache the result once the status is final.
  - The simulation format `/m/0042-s-inv-YYYYMMDD` stays valid and keeps its "SIMULATION" label.

## 8. Hosting and credentials

| Part | Where it runs |
| --- | --- |
| Validator, agent, console API | Workers deployed from the `mule` repository by GitHub Actions (`wrangler deploy`) |
| Messages | Queue `mule-devnet-missions` |
| Scheduled sweeps | Cron Trigger, every minute |
| Storage | R2 bucket `mule-devnet` |
| Site | the `mule-site` Pages project, with the `CONSOLE_API` binding |

Secrets are Worker secrets, never in a repository and never in client code:
- the faucet wallet key and the validator key, both devnet-only, generated by you ;
- the dUSDC mint authority;
- the RPC key and the LLM key, provided by the owner;
- the Turnstile secret.

Credentials: the owner has extended your existing Cloudflare API token with:
- **Account › Workers Scripts › Edit** ;
- **Account › Workers R2 Storage › Edit** ;
- **Account › Queues › Edit** ;
- **Account › Turnstile › Edit**.

You never receive other credentials.

Plan limits:
- check the Workers Free plan limits (CPU per request, Queues, daily requests) against this design **before Check-in 3** ;
- if something does not fit, report it with numbers and the smallest fix. The owner may move to the Workers Paid plan ($5/month); do not change the plan yourself.

## 9. Order of work, pull requests and check-ins

Every change goes through a **draft pull request**. You never merge into `main` and never deploy to production: the owner merges after an independent review. Stop at each check-in and write a report in `docs/checkins/CHECKIN-N.md`, covering what is done, links, evidence, open questions and what you could not verify.

1. **Program and tests.** Accounts, instructions, events and the full test suite green in CI.
   → *Check-in 1: repository link, test and coverage report, the state machine as implemented.*
2. **Devnet deploy and scripts.** dUSDC mint, config, program deployed, and one mission run end to end by script, honest and dishonest.
   → *Check-in 2: program ID, explorer links for both runs, the runbook.*
3. **Validator, agent and storage as Workers.** Idempotency tested by forcing failures and retries mid-mission.
   → *Check-in 3: 10 missions by script, all correct (3 templates × 2 behaviours, plus 4 more), the plan-limit analysis, the threat model.*
4. **Console integration on a preview URL** of `mule-site`, in `devnet` mode, with Turnstile, rate limits and patches.
   → *Check-in 4: the immutable preview URL, a video of an honest and a dishonest run, Lighthouse mobile (3 passes per page, median LCP below 2 s), CSP diff.*
5. **Public run**, after the owner's go and merge. Count missions until 100 meet the exit criteria.
   → *Final report: program ID, the 100 mission addresses with their outcomes, every dishonest run refunded, incidents if any.*

## 10. Rules

- Devnet only. Never deploy to mainnet, never handle mainnet keys, never touch $MULE.
- No secret in a repository, a log, a report or client code.
- Nothing in the UI may suggest real money: dUSDC is labelled "no value" everywhere.
- No wallet connection in the site. Visitors never sign anything; the faucet wallet is the client.
- `LAUNCHED` stays `false` and `CONTRACT_ADDRESS` stays `null` in `mule-site`.
- No feature outside this document: no staking, bonds or marketplace.
- If a requirement is unclear or conflicts with the dossier, stop and ask.
