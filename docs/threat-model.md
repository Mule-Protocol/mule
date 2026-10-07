# MULE threat model · check-in 1b

Sources: [v1 §2.4–2.5](spec/PROMPT_M-1_devnet.md), [v2 §2](spec/SPEC_M-1_devnet_v2.md), [current scope](spec/M1_LOCAL_ONLY_UPDATE.md), and owner-approved [check-in 1b corrections](checkins/CHECKIN-1b.md).
This is a design/test review, not an independent security audit.

## Assets and trust

Assets are escrow tokens and account rent. All current balances are local test data with no value. Actors: client, designated/accepted agent, validator, current/pending admin, upgrade authority and arbitrary sender. Client/agent can be malicious; validator can be wrong or unavailable. Validator, dispute admin and upgrade authority remain trust assumptions.

The program enforces signers and the recorded verdict. It cannot read HTTP or verify an external document hash/truth. Content validation belongs to step 3, not yet implemented.

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
| Double payout/verdict | State guards and account closure | Double verdict/finalize; finalize after resolution; forbidden-state matrix |
| Early payout/late contest | Clock sysvar and exact boundaries | Before/at deadline/window/dispute timeout; admin ruling before timeout |
| Validator outage | Permissionless stale refund after 7 days | Before/at stale threshold |
| Pause freezes exits | Pause affects creation only | Every exit while paused |
| Overflow/serialization | Checked arithmetic; cap; bounded UTF-8; fixed allocation | Zero, overcap, overflow, 200-byte/multibyte URI |
| Donation prevents closure | Sweep full balance to legitimate recipient | Extra deposit then closure |
| Rent theft | Both account rents return to stored client | Exact balance/rent assertions |
| ID reuse confuses history | SDK requires history and reserves each program/client/ID tuple; durable file adapter retains reservations forever | Duplicate create attempt rejected, including across restored history |
| Credential leakage | No real keys; ephemeral tests; secret scanning/push protection | Repository settings and limited artifacts |
| CI privilege abuse | PR and main-push workflow, contents:read, no secrets | No pull_request_target or deployment job |
| Altered downloaded tool binary | Versioned Anchor/Solana downloads checked against pinned SHA-256 before execution | CI checksum checks fail the job on mismatch |

## Residual risks

- A dishonest validator can approve bad work. Parties must dispute in time; admin may override the verdict. If no ruling succeeds within 14 days, anyone may apply that same original verdict. The timeout improves recovery from admin inactivity; it does not establish content truth.
- The timeout requires a transaction and valid recipient token accounts. It does not automatically settle a mission. Admin resolution remains possible after the timeout until the mission closes; the first successful serialized resolution/finalization wins.
- With designated_agent = None, any non-client signer can still accept and withhold delivery until the expiry refund. Designation removes acceptance by outsiders but cannot force the selected agent to deliver.
- Entry guards use the current Config validator. They do not retroactively remove an existing client/accepted agent if an admin later rotates the validator to that party; administrators must avoid this conflict on existing missions. No additional record_verdict rule was added beyond the requested creation/acceptance guards.
- Validator rotation affects already-submitted missions. Admin transfer affects existing disputes. Mint cannot be changed. If the current admin key is lost before a proposal, admin transfer is unavailable, while the dispute timeout remains callable.
- A mint freeze authority could halt transfers. Tests create a mint without one; no real mint policy is exercised.
- A recipient needs a valid token account. A future keeper could recreate an ATA; no keeper is implemented now.
- Closing accounts removes live history. The protocol deliberately permits a client to reuse a mission ID/PDA after closure. SDK history is an off-chain guard, not on-chain replay protection: bypassing the SDK or deleting, rolling back or concurrently mismanaging its persisted history can permit reuse. The future runner must persist reservations atomically and retain transaction signatures.
- Surplus vault deposits go to the legitimate payout recipient; no third-party donation recovery exists.
- Events currently use emit!, which is accepted for this stage. RPC log truncation or incomplete ingestion can hide events; event decoding must exclude failed transactions and must not be treated as durable history by itself. emit_cpi! will be evaluated before the indexer is implemented.
- The program does not identify its network. The deployment prohibition is enforced by scope/workflow, not a fictional program-level cluster check.
- Upgrade authority can replace code. No deployment or multisig is created. Original multisig requirements for later milestones remain outside this stage.
- Pinned download hashes verify the downloaded bytes against reviewed pins, not the integrity of upstream build systems. Dependency/source compromise remains possible. solana-verify is deferred to the first deployment and has not been executed here.
- LiteSVM executes real SBF/SPL with synthetic ProgramData/time. Tests do not prove distributed-network behavior, RPC operation, live upgrade control, Squads CPI, or production security.
- Instruction/scenario coverage is not line/branch coverage, formal verification, fuzzing or an independent audit.
- SDK builds instructions/decodes data and requires mission-ID history. FileMissionIdHistory provides durable Node storage; InMemoryMissionIdHistory is only for ephemeral tests. It holds no keys and sends no transactions.

Step 3 will cover validator/schema correctness, hashes/storage, agent, idempotence/recovery and the requested 10 local CI missions after later owner authorization. No public deployment, paid service, $MULE, staking, bonds, marketplace or site changes.
