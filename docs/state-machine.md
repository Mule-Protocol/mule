# MULE escrow state machine · check-in 1b

Authority: [v2 §2](spec/SPEC_M-1_devnet_v2.md), [v1 §2.1–2.5](spec/PROMPT_M-1_devnet.md), with the owner-approved [check-in 1b corrections](checkins/CHECKIN-1b.md).
Scope: [local-only update](spec/M1_LOCAL_ONLY_UPDATE.md). The original specifications remain historical, unchanged sources.

## Accounts and terms

Config PDA: UTF-8 "config". Its initializer must be the upgrade authority recorded in the canonical loader-owned ProgramData. Mint is immutable. Validator, cap, minimum window and pause can change through update_config. Admin changes only through the two-step propose_admin / accept_admin flow: the current admin records pending_admin, then that pending signer accepts and clears the proposal. The default public key is forbidden. A proposal alone does not grant admin rights; acceptance removes the previous admin's rights.

Mission PDA: "mission", client public key, unsigned 64-bit mission ID in little-endian. Vault PDA: "vault", mission public key. The vault's SPL authority is the mission PDA.

Mission amount, criteria hash/URI, deadline, window and designated_agent are immutable. create_mission takes designated_agent: Option<Pubkey> as its last argument. None permits any agent other than the client to accept. Some(key) permits only that signer (NotDesignatedAgent otherwise); a client cannot designate itself (ClientCannotDesignateSelf at creation). Acceptance permanently binds the agent. One submission binds the delivery; one verdict binds the report hash/time/result. original_verdict: Option<bool> preserves that verdict through a dispute, while disputed_at: Option<i64> records when the dispute opens. Classic SPL Token only, six decimals. URI limits are 1–200 UTF-8 bytes.

Defaults: 3,600-second minimum window, 100,000,000 base-unit cap (100 dUSDC, no value). Step-3 local tests may configure 60 seconds. DISPUTE_TIMEOUT is a protocol constant: 1,209,600 seconds (14 days), measured from disputed_at, independently of the mission's dispute window.

## Transitions

There are 14 distinct instructions; verdict and payout variants are listed separately below.

| Instruction | From | Signer / guard | Result |
| --- | --- | --- | --- |
| initialize_config | absent | upgrade authority; once | Config created; no pending admin |
| update_config | existing | current admin; positive cap/window | Config updated |
| propose_admin | existing | current admin; non-default new admin | pending_admin recorded; current admin unchanged |
| accept_admin | pending proposal | pending_admin signer | Admin replaced; pending_admin cleared |
| create_mission | absent | client; not paused; 0 < amount ≤ cap; future deadline; window ≥ minimum; designated_agent ≠ client | Open; client → vault |
| cancel_mission | Open | client | Cancelled; vault → client |
| accept_mission | Open | agent ≠ client; matches designated_agent if present; now < deadline | Accepted |
| submit_delivery | Accepted | accepted agent; now < deadline | Submitted |
| record_verdict(true) | Submitted | current validator | Passed; verdict_at = now; original_verdict = true |
| record_verdict(false) | Submitted | current validator | Failed; verdict_at = now; original_verdict = false |
| open_dispute | Passed / Failed | client or agent; now < verdict_at + window | Disputed; disputed_at = now; original verdict retained |
| resolve_dispute(true) | Disputed | current admin | Settled; vault → agent |
| resolve_dispute(false) | Disputed | current admin | Refunded; vault → client |
| finalize | Passed | anyone; now ≥ verdict_at + window | Settled; vault → agent |
| finalize | Failed | anyone; now ≥ verdict_at + window | Refunded; vault → client |
| finalize | Disputed, original verdict true | anyone; now ≥ disputed_at + DISPUTE_TIMEOUT | Settled; vault → agent |
| finalize | Disputed, original verdict false | anyone; now ≥ disputed_at + DISPUTE_TIMEOUT | Refunded; vault → client |
| refund_expired | Open / Accepted | anyone; now ≥ deadline | Refunded; vault → client |
| refund_stale | Submitted, no verdict | anyone; now ≥ deadline + 604,800 | Refunded; vault → client |

Time comes from the Clock sysvar. At the exact boundary, settlement/refund is allowed and dispute/delivery is disallowed. Disputed finalization returns DisputeTimeoutNotReached before its 14-day threshold. Additions are checked for overflow. Anyone still sends a signed transaction; no privileged role is needed.

resolve_dispute remains available before and after the timeout while the mission exists. Once the timeout elapses, an admin ruling and permissionless finalization can both be valid; the first successful serialized transaction closes the accounts and determines the outcome. The timeout makes funds recoverable; it does not automatically send a transaction.

All terminal paths close mission and vault, with both rents going to the stored client even if a third party paid the fee. Final state persists in events, not a live account. A repeated terminal instruction fails on the closed account, including finalize after an admin resolution.

The test matrix exercises every forbidden outgoing instruction from each live state. Authorization/account checks can fail earlier than InvalidState; all errors are named and failures roll back state/token changes.

## Pause, events and payouts

Pause affects creation only. Existing work, verdicts, disputes, admin transfer, payouts and refunds remain available. Config changes cannot alter an existing mission's window/amount/designated agent. Validator rotation changes who may decide pending missions. Admin transfer changes who may resolve existing disputes.

The admin can only choose client or agent in a dispute. If the admin does not act, anyone may apply the original validator verdict after the 14-day timeout. This fallback cannot correct a dishonest original verdict.

Each successful instruction emits one event. ConfigInitialized/ConfigUpdated identify Config/settings; the transfer emits AdminProposed and then AdminAccepted. The eight mission event types include mission, amount and status. MissionCreated additionally includes designated_agent. Finalize/resolve emit MissionSettled or MissionRefunded.

Destination token accounts are constrained to the correct owner and mint; no instruction accepts an arbitrary payout-address argument. The complete vault balance is transferred to the legitimate recipient so unsolicited deposits cannot prevent closure. Event amount remains the agreed escrow amount; surplus is a gift to that recipient.

## Explicit details and limits

- Acceptance after the deadline is rejected since no subsequent valid delivery is possible.
- IDs are unique among live accounts per client. Closure leaves no permanent tombstone: reuse after closure remains possible on-chain, as accepted by the owner. The SDK requires a MissionIdHistory store and reserves each program/client/ID tuple before returning a create_mission instruction. FileMissionIdHistory provides durable Node storage; every instance must retain and share the same directory. InMemoryMissionIdHistory is only for ephemeral tests. Callers must never remove reservations or reuse IDs, even after failure or closure. The future runner must obey the same rule. Historical indexes must retain transaction signatures.
- The admin field supports a multisig PDA signing through CPI; no Squads setup or CPI integration test is performed here. Two-step transfer cannot rescue an already-lost current admin key if no proposal was made; the dispute timeout still provides the fallback described above.
- No program is deployed on a public cluster. The fixed identity is test-only. solana-verify is deferred to the first deployment.

[Tests](../tests/escrow.test.ts) execute compiled SBF and real SPL instructions in LiteSVM. Only wallet funding, loader metadata and clock are fixtures. Coverage is generated from executed assertions; it is instruction/scenario coverage, not line/branch coverage.
