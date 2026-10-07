# MULE escrow state machine · step 1

Authority: [v2 §2](spec/SPEC_M-1_devnet_v2.md), [v1 §2.1–2.5](spec/PROMPT_M-1_devnet.md).
Scope: [local-only update](spec/M1_LOCAL_ONLY_UPDATE.md).

## Accounts and terms

Config PDA: UTF-8 "config". Its initializer must be the upgrade authority recorded in the canonical loader-owned ProgramData. Admin and mint are immutable; validator, cap, minimum window and pause can change.

Mission PDA: "mission", client public key, unsigned 64-bit mission ID in little-endian. Vault PDA: "vault", mission public key. The vault's SPL authority is the mission PDA.

Mission amount, criteria hash/URI, deadline and window are immutable. Acceptance permanently binds the agent. One submission binds the delivery; one verdict binds the report hash/time/result. Classic SPL Token only, six decimals. URI limits are 1–200 UTF-8 bytes.

Defaults: 3,600-second minimum window, 100,000,000 base-unit cap (100 dUSDC, no value). Step-3 local tests may configure 60 seconds.

## Transitions

| Instruction | From | Signer / guard | Result |
| --- | --- | --- | --- |
| initialize_config | absent | upgrade authority; once | Config created |
| update_config | existing | admin; positive cap/window | Config updated |
| create_mission | absent | client; not paused; 0 < amount ≤ cap; future deadline; window ≥ minimum | Open; client → vault |
| cancel_mission | Open | client | Cancelled; vault → client |
| accept_mission | Open | agent ≠ client; now < deadline | Accepted |
| submit_delivery | Accepted | accepted agent; now < deadline | Submitted |
| record_verdict(true) | Submitted | current validator | Passed; verdict_at = now |
| record_verdict(false) | Submitted | current validator | Failed; verdict_at = now |
| open_dispute | Passed / Failed | client or agent; now < verdict_at + window | Disputed |
| resolve_dispute(true) | Disputed | admin | Settled; vault → agent |
| resolve_dispute(false) | Disputed | admin | Refunded; vault → client |
| finalize | Passed | anyone; now ≥ verdict_at + window | Settled; vault → agent |
| finalize | Failed | anyone; now ≥ verdict_at + window | Refunded; vault → client |
| refund_expired | Open / Accepted | anyone; now ≥ deadline | Refunded; vault → client |
| refund_stale | Submitted, no verdict | anyone; now ≥ deadline + 604,800 | Refunded; vault → client |

Time comes from the Clock sysvar. At the exact boundary, settlement/refund is allowed and dispute/delivery is disallowed. Additions are checked for overflow. Anyone still sends a signed transaction; no privileged role is needed.

All terminal paths close mission and vault, with both rents going to the stored client even if a third party paid the fee. Final state persists in events, not a live account. A repeated terminal instruction fails on the closed account.

The test matrix exercises every forbidden outgoing instruction from each live state. Authorization/account checks can fail earlier than InvalidState; all errors are named and failures roll back state/token changes.

## Pause, events and payouts

Pause affects creation only. Existing work, verdicts, disputes, payouts and refunds remain available. Config changes cannot alter an existing mission's window/amount. Validator rotation changes who may decide pending missions.

The admin can only choose client or agent in a dispute. Disputed missions have no autonomous timeout in the specification.

Each successful instruction emits one event. ConfigInitialized/ConfigUpdated identify Config/settings. The eight specified mission events include mission, amount and status. Finalize/resolve emit MissionSettled or MissionRefunded.

Destination token accounts are constrained to the correct owner and mint; no instruction accepts an arbitrary payout-address argument. The complete vault balance is transferred to the legitimate recipient so unsolicited deposits cannot prevent closure. Event amount remains the agreed escrow amount; surplus is a gift to that recipient.

## Explicit details and limits

- Acceptance after the deadline is rejected since no subsequent valid delivery is possible.
- IDs are unique among live accounts per client. The specified closure/account layout has no permanent tombstone: reuse after closure remains possible. Callers must not reuse IDs; historical indexes must retain signatures. Permanent replay prevention would need a specification change.
- The admin field supports a multisig PDA signing through CPI; no Squads setup or CPI integration test is performed here.
- No program is deployed on a public cluster. The fixed identity is test-only.

[Tests](../tests/escrow.test.ts) execute compiled SBF and real SPL instructions in LiteSVM. Only wallet funding, loader metadata and clock are fixtures. Coverage is generated from executed assertions; it is instruction/scenario coverage, not line/branch coverage.
