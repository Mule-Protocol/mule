# MULE threat model · M-1.1

Sources: [v1 §2.4–2.5](spec/PROMPT_M-1_devnet.md), [v2 §2](spec/SPEC_M-1_devnet_v2.md), [current scope](spec/M1_LOCAL_ONLY_UPDATE.md), owner-approved [check-in 1b corrections](checkins/CHECKIN-1b.md), and [M-1.1 hardening](spec/M1_1_HARDENING.md).
This is a design/test review, not an independent security audit.

## Assets and trust

Assets are escrow tokens and account rent. All current balances are local test data with no value. Actors: client, designated/accepted agent, validator, current/pending admin, upgrade authority and arbitrary sender. Client/agent can be malicious; validator can be wrong or unavailable. Validator, dispute admin and upgrade authority remain trust assumptions.

The program enforces signers and the recorded verdict. It cannot read HTTP or verify an external document hash/truth. Step 3 validates local content deterministically against curated Ajv 2020-12 schemas and named cross-checks; this establishes only those encoded rules.

## Controls and tests

| Threat | Control | Tests |
| --- | --- | --- |
| Config takeover | Canonical ProgramData and upgrade-authority signature | Wrong initializer / forged account |
| Account substitution | PDA seeds, owners, has_one, mint and authority constraints | Wrong mission/vault/mint/client/recipient |
| Agent impersonation | Agent bound once; signature on submission | Wrong agent, reaccept, resubmit |
| Third party accepts then withholds delivery | Optional immutable designated_agent restricts acceptance | Designated signer accepted; other agent rejected; None retains open acceptance |
| Self-dealing | Client cannot accept its own mission or designate itself | Self-accept and self-designation rejected |
| Validator takes a party role | create_mission excludes current validator as client/designated agent; accept_mission reads canonical Config and excludes current validator | Three refusals plus old/new validator after rotation |
| Unauthorized verdict/ruling | Config validator/current-admin signature | Wrong signers and rotation |
| Lost or inactive dispute admin | Permissionless finalize after 14 days from disputed_at applies the preserved original verdict | Too early rejected; exact threshold pays agent for Passed and client for Failed |
| Admin transfer hijack | Current admin proposes non-default key; only pending admin accepts; acceptance clears pending and revokes old admin | Wrong proposer/accepter, default key, old admin after transfer |
| Pending admin proposal is no longer trusted | Current admin can cancel; absence of a proposal is an error; cancelled signer cannot accept | Cancellation, wrong signer, empty proposal and post-cancellation acceptance |
| Double payout/verdict | State guards and account closure | Double verdict/finalize; finalize after resolution; forbidden-state matrix |
| Early payout/late contest | Clock sysvar and exact boundaries | Before/at deadline/window/dispute timeout; admin ruling before timeout |
| Validator outage | Permissionless stale refund after 7 days | Before/at stale threshold |
| Pause freezes exits | Pause affects creation only | Every exit while paused |
| Overflow/serialization | Checked arithmetic; cap; bounded UTF-8; fixed allocation | Zero, overcap, overflow, 200-byte/multibyte URI |
| Donation prevents closure | Sweep full balance to legitimate recipient | Extra deposit then closure |
| Rent theft | Both account rents return to stored client | Exact balance/rent assertions |
| ID reuse confuses history | SDK requires history and reserves each program/client/ID tuple; durable file adapter retains reservations forever | Duplicate create attempt rejected, including across restored history; after-reserve recovery keeps the consumed ID reserved |
| Crash after on-chain closure | Recover the original terminal event, signature and transaction balance metadata before updating the manifest | after-close injection; no additional settlement signature; original rent/payment evidence |
| Unknown transaction outcome | Persist signed bytes and broadcast intent; wait for finalized expiry, then reconcile signature, PDA and retained history before any replacement | Transport/expiry policy tests; conflicting or pruned history prevents replacement |
| Unexpected instruction sequences | Independent model predicts acceptance/rejection; seven invariants checked against real SBF | Generated actor/config/clock sequences and reduced counterexamples; see [fuzz scope](testing/FUZZING.md) |
| Credential leakage | No real keys; ephemeral tests; secret scanning/push protection | Repository settings and limited artifacts |
| CI privilege abuse | PR and main-push workflow, contents:read, no secrets | No pull_request_target or deployment job |
| Altered downloaded tool binary or action | Versioned Anchor/Agave/cargo-audit downloads checked against pinned SHA-256; actions pinned to verified full commits | CI checksum checks fail on mismatch; official tag provenance in [supply-chain policy](testing/SUPPLY-CHAIN.md) |
| Known vulnerable dependency | Production npm and RustSec audits; explicit dated exceptions with executable mitigation guards | Unknown/error/expired cases fail closed; raw findings remain public |

## Residual risks

- A dishonest validator can approve bad work. Parties must dispute in time; admin may override the verdict. If no ruling succeeds within 14 days, anyone may apply that same original verdict. The timeout improves recovery from admin inactivity; it does not establish content truth.
- The timeout requires a transaction and valid recipient token accounts. It does not automatically settle a mission. Admin resolution remains possible after the timeout until the mission closes; the first successful serialized resolution/finalization wins.
- With designated_agent = None, any non-client signer can still accept and withhold delivery until the expiry refund. Designation removes acceptance by outsiders but cannot force the selected agent to deliver.
- Entry guards use the current Config validator. They do not retroactively remove an existing client/accepted agent if an admin later rotates the validator to that party; administrators must avoid this conflict on existing missions. No additional record_verdict rule was added beyond the requested creation/acceptance guards.
- Validator rotation affects already-submitted missions. Admin transfer affects existing disputes. Mint cannot be changed. If the current admin key is lost before a proposal, admin transfer is unavailable, while the dispute timeout remains callable.
- A mint freeze authority could halt transfers. Tests create a mint without one; no real mint policy is exercised.
- A recipient needs a valid token account. A future keeper could recreate an ATA; no keeper is implemented now.
- Closing accounts removes live history. The protocol deliberately permits a client to reuse a mission ID/PDA after closure. SDK history is an off-chain guard, not on-chain replay protection: bypassing the SDK or deleting, rolling back or concurrently mismanaging its persisted history can permit reuse. The runner uses durable SDK reservations and retains signed transaction bytes/signatures in its private journal. One driver must own each journal directory.
- Surplus vault deposits go to the legitimate payout recipient; no third-party donation recovery exists.
- Events currently use emit!, which is accepted for this stage. RPC log truncation or incomplete ingestion can hide events; event decoding must exclude failed transactions and must not be treated as durable history by itself. emit_cpi! will be evaluated before the indexer is implemented.
- The program does not identify its network. The deployment prohibition is enforced by scope/workflow, not a fictional program-level cluster check.
- Upgrade authority can replace code. No deployment or multisig is created. Original multisig requirements for later milestones remain outside this stage.
- Pinned download hashes verify the downloaded bytes against reviewed pins, not the integrity of upstream build systems. Dependency/source compromise remains possible. solana-verify is deferred to the first deployment and has not been executed here.
- LiteSVM executes real SBF/SPL with synthetic ProgramData/time. These simulated-time tests do not prove distributed-network behavior, live upgrade control, Squads CPI, or production security. The separate ten-mission campaign exercises a real, isolated local RPC validator.
- The 15-instruction assertion matrix measures instruction/scenario coverage. Property tests add generated sequences and shrinking; neither is Rust line/branch coverage, formal verification or an independent audit.
- SDK builds instructions/decodes data and requires mission-ID history. FileMissionIdHistory provides durable Node storage; InMemoryMissionIdHistory is only for ephemeral tests. It holds no keys and sends no transactions.

The historical [CHECKIN-3](checkins/CHECKIN-3.md) records validator/schema correctness, rehashed local storage, the scripted agent, two injected recovery points and ten local CI missions. M-1.1 adds two recovery points, property testing, supply-chain enforcement and admin-proposal cancellation. Current execution evidence belongs in CHECKIN-4; the configured weekly campaign and future managed Dependabot run must not be represented as already executed. No public deployment, paid service, $MULE, staking, bonds, marketplace or site changes.

## Property-testing boundaries

The [fuzz harness](testing/FUZZING.md) executes actual SBF in isolated LiteSVM workers. Its independent model checks token conservation, exact live vault amounts, legitimate recipients, one settlement, allowed/refused state transitions, current-validator entry guards and rent returned to the client after every instruction and clock jump. Actors, amounts, deadlines, config changes and exact time boundaries vary. Seeds, actual operation counts and reduced failures are retained as public evidence.

Three scopes are deliberate: external vault donations are excluded from the generated alphabet because they legitimately increase vault balances (deterministic sweep tests cover them); settlement finality assumes the SDK's no-ID-reuse history because the protocol permits recreation after closure; validator separation is checked at creation/acceptance, not retroactively after rotation. Fuzzing does not cover consensus, forks, distributed RPC, concurrent drivers, Squads CPI, an indexer, document truth or a compromised host. A finite campaign can miss defects.

The temporary [bigint-buffer exception](testing/SUPPLY-CHAIN.md#audit-policy-and-exceptions) leaves its high advisory visible. It applies only to version 1.1.5, the pinned JavaScript entrypoint, disabled build scripts and verified absence of every native-binding candidate, with fallback checks. Review is due 2026-11-06; a failed guard or expired entry blocks CI. This is a conditional mitigation for the local test runtime, not a claim that the dependency is patched or generally safe.

## Local pipeline boundaries

- Curated criteria must match their reviewed fixture version exactly. Monetary strings are compared as integer cents; address.v1 currently uses twelve French rows with five-digit postcodes. These choices do not validate document authenticity, governing-law suitability or physical addresses.
- Stored JSON uses sorted object keys, UTF-8 and a trailing newline, not a claim of RFC 8785 conformance. Every read verifies the SHA-256 of the actual bytes, including on recovery. Main-branch raw URIs are future public references until the owner merges; local validation never fetches them.
- Four injected faults cover report persistence, verdict confirmation before journal confirmation, ID reservation before signed-journal persistence, and closure before campaign-manifest persistence. Recovery checks hashes and signatures, marks a reserved identity with no creation as consumed-never-created, and reconstructs a closed mission from its original terminal transaction. The original ID is never released; token and rent evidence comes from that transaction's pre/post metadata.
- A confirmed transaction is recovered as soon as its receipt is available. An outcome that remains unknown is treated as non-execution only after finalized blockhash expiry and checks of signature status, transaction lookup, PDA state and full retained mission history. A signature is broadcast at most once by the runner. A replacement is signed only when non-execution is established; expired creations consume their ID and receive a fresh ID/deadline. Inconsistent RPC views, missing evidence or pruned required history stop replacement and retain state. These checks assume an honest local RPC and preserved keys/history/journal on the same ledger; they do not prove recovery from arbitrary storage loss or distributed forks.
- The standard public CI runner uses an ephemeral local ledger and genesis-funded test keys. Artifact paths allow only public reports/data plus build/coverage evidence. The unavoidable Agave internal faucet has zero balance and caps and is never called; see the sourced local runbook. No paid/external account or wallet is connected.
