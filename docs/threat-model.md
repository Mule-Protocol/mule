# MULE threat model · step 1

Sources: [v1 §2.4–2.5](spec/PROMPT_M-1_devnet.md), [v2 §2](spec/SPEC_M-1_devnet_v2.md), [current scope](spec/M1_LOCAL_ONLY_UPDATE.md).
This is a design/test review, not an independent audit.

## Assets and trust

Assets are escrow tokens and account rent. All current balances are local test data with no value. Actors: client, accepted agent, validator, admin, upgrade authority and arbitrary sender. Client/agent can be malicious; validator can be wrong or unavailable. Validator, dispute admin and upgrade authority remain trust assumptions.

The program enforces signer and recorded verdict. It cannot read HTTP or verify an external document hash/truth. Content validation belongs to step 3, not yet implemented.

## Controls and tests

| Threat | Control | Tests |
| --- | --- | --- |
| Config takeover | Canonical ProgramData and upgrade-authority signature | Wrong initializer / forged account |
| Account substitution | PDA seeds, owners, has_one, mint and authority constraints | Wrong mission/vault/mint/client/recipient |
| Agent impersonation | Agent bound once; signature on submission | Wrong agent, reaccept, resubmit |
| Self-dealing | Client cannot accept own mission | Self-accept |
| Unauthorized verdict/ruling | Config validator/admin signature | Wrong signers and rotation |
| Double payout/verdict | State guards and account closure | Double verdict/finalize, forbidden-state matrix |
| Early payout/late contest | Clock sysvar and exact boundaries | Before/at deadline/window |
| Validator outage | Permissionless stale refund after 7 days | Before/at stale threshold |
| Pause freezes exits | Pause affects creation only | Every exit while paused |
| Overflow/serialization | Checked arithmetic; cap; bounded UTF-8; fixed allocation | Zero, overcap, overflow, 200-byte/multibyte URI |
| Donation prevents closure | Sweep full balance to legitimate recipient | Extra deposit then closure |
| Rent theft | Both account rents return to stored client | Exact balance/rent assertions |
| Credential leakage | No real keys; ephemeral tests; secret scanning/push protection | Repository settings and limited artifacts |
| CI privilege abuse | Pull-request workflow, contents:read, no secrets | No pull_request_target or deployment job |

## Residual risks

- A dishonest validator can approve bad work. Parties must dispute in time; admin resolves.
- Disputed funds can remain locked if admin disappears; no timeout exists in the spec.
- Validator rotation affects already-submitted missions. Admin/mint cannot be changed with update_config.
- A mint freeze authority could halt transfers. Tests create a mint without one; no real mint policy is exercised.
- A recipient needs a valid token account. A future keeper could recreate an ATA; no keeper is implemented now.
- Closing accounts removes live history. A client can reuse a mission ID/PDA; signatures and non-reused IDs are required for history. Permanent replay protection is not implemented by the specified accounts.
- Surplus vault deposits go to the legitimate payout recipient; no third-party donation recovery exists.
- The program does not identify its network. The deployment prohibition is enforced by scope/workflow, not a fictional program-level cluster check.
- Upgrade authority can replace code. No deployment or multisig is created. Original multisig requirements for later milestones remain outside this stage.
- LiteSVM executes real SBF/SPL with synthetic ProgramData/time. Tests do not prove distributed-network behavior, RPC operation, live upgrade control, Squads CPI, or production security.
- Instruction/scenario coverage is not line/branch coverage, formal verification, fuzzing or an independent audit.
- SDK only builds instructions/decodes data. It holds no keys and sends no transactions.

Step 3 will cover validator/schema correctness, hashes/storage, agent, idempotence/recovery and the requested 10 local CI missions after owner review. No public deployment, paid service, $MULE, staking, bonds, marketplace or site changes.
