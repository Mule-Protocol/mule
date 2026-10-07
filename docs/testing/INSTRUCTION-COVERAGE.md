# Instruction coverage

Executed against the compiled SBF in LiteSVM. This is instruction/scenario coverage, not Rust line or branch coverage.

Test cases: 35/35 passed.

| Instruction | Successful assertions | Rejected assertions |
| --- | ---: | ---: |
| initialize_config | 42 | 4 |
| update_config | 9 | 4 |
| create_mission | 38 | 14 |
| cancel_mission | 4 | 7 |
| accept_mission | 29 | 7 |
| submit_delivery | 25 | 9 |
| record_verdict | 21 | 8 |
| open_dispute | 9 | 9 |
| resolve_dispute | 4 | 7 |
| finalize | 5 | 18 |
| refund_expired | 3 | 8 |
| refund_stale | 2 | 13 |

Counts include setup calls. Each recorded call asserted its expected result; successful calls also asserted its event.

## initialize_config

- initialize_config: defaults, authority and six-decimal mint
- initialize_config: forged ProgramData PDA rejected
- initialize_config: zero authority rejected
- update_config: restricted, immutable mint/admin, bounds and validator rotation
- create_mission: exact escrow, immutable criteria and initialized state
- create_mission: invalid amount, deadline, window, URI and overflow
- create_mission: wrong mint, token authority and PDA substitutions
- create_mission: missing client signature rejected
- cancel_mission: client only, full refund, vault/mission rent returned to client
- accept_mission: client cannot accept and expiry is enforced
- accept/submit: correct agent, immutable delivery, byte limits and deadline boundary
- record_verdict: restricted, exactly once, hashes and timestamp
- finalize passed: window boundary, payee, closure, replay
- finalize failed: window boundary, payee, closure, replay
- open_dispute from passed by client
- open_dispute from passed by agent
- open_dispute from failed by client
- open_dispute from failed by agent
- open_dispute: exact closed boundary rejected
- resolve_dispute pay: admin only, exact recipient, close
- resolve_dispute refund: admin only, exact recipient, close
- refund_expired from open: deadline and permissionless refund
- refund_expired from accepted: deadline and permissionless refund
- refund_stale: exactly deadline + 7 days, permissionless and no verdict
- refund_stale: cannot bypass recorded pass
- refund_stale: cannot bypass recorded fail
- paused: create blocked, every exit and in-flight step remains available
- settlement/refund: destination substitution and wrong vault cannot steal funds
- unsolicited vault tokens cannot prevent closure
- state machine rejects every forbidden outgoing instruction from open
- state machine rejects every forbidden outgoing instruction from accepted
- state machine rejects every forbidden outgoing instruction from submitted
- state machine rejects every forbidden outgoing instruction from passed
- state machine rejects every forbidden outgoing instruction from failed
- state machine rejects every forbidden outgoing instruction from disputed

## update_config

- update_config: restricted, immutable mint/admin, bounds and validator rotation
- paused: create blocked, every exit and in-flight step remains available

## create_mission

- update_config: restricted, immutable mint/admin, bounds and validator rotation
- create_mission: exact escrow, immutable criteria and initialized state
- create_mission: invalid amount, deadline, window, URI and overflow
- create_mission: wrong mint, token authority and PDA substitutions
- cancel_mission: client only, full refund, vault/mission rent returned to client
- accept_mission: client cannot accept and expiry is enforced
- accept/submit: correct agent, immutable delivery, byte limits and deadline boundary
- record_verdict: restricted, exactly once, hashes and timestamp
- finalize passed: window boundary, payee, closure, replay
- finalize failed: window boundary, payee, closure, replay
- open_dispute from passed by client
- open_dispute from passed by agent
- open_dispute from failed by client
- open_dispute from failed by agent
- open_dispute: exact closed boundary rejected
- resolve_dispute pay: admin only, exact recipient, close
- resolve_dispute refund: admin only, exact recipient, close
- refund_expired from open: deadline and permissionless refund
- refund_expired from accepted: deadline and permissionless refund
- refund_stale: exactly deadline + 7 days, permissionless and no verdict
- refund_stale: cannot bypass recorded pass
- refund_stale: cannot bypass recorded fail
- paused: create blocked, every exit and in-flight step remains available
- settlement/refund: destination substitution and wrong vault cannot steal funds
- unsolicited vault tokens cannot prevent closure
- state machine rejects every forbidden outgoing instruction from open
- state machine rejects every forbidden outgoing instruction from accepted
- state machine rejects every forbidden outgoing instruction from submitted
- state machine rejects every forbidden outgoing instruction from passed
- state machine rejects every forbidden outgoing instruction from failed
- state machine rejects every forbidden outgoing instruction from disputed

## cancel_mission

- cancel_mission: client only, full refund, vault/mission rent returned to client
- paused: create blocked, every exit and in-flight step remains available
- settlement/refund: destination substitution and wrong vault cannot steal funds
- unsolicited vault tokens cannot prevent closure
- state machine rejects every forbidden outgoing instruction from accepted
- state machine rejects every forbidden outgoing instruction from submitted
- state machine rejects every forbidden outgoing instruction from passed
- state machine rejects every forbidden outgoing instruction from failed
- state machine rejects every forbidden outgoing instruction from disputed

## accept_mission

- update_config: restricted, immutable mint/admin, bounds and validator rotation
- accept_mission: client cannot accept and expiry is enforced
- accept/submit: correct agent, immutable delivery, byte limits and deadline boundary
- record_verdict: restricted, exactly once, hashes and timestamp
- finalize passed: window boundary, payee, closure, replay
- finalize failed: window boundary, payee, closure, replay
- open_dispute from passed by client
- open_dispute from passed by agent
- open_dispute from failed by client
- open_dispute from failed by agent
- open_dispute: exact closed boundary rejected
- resolve_dispute pay: admin only, exact recipient, close
- resolve_dispute refund: admin only, exact recipient, close
- refund_expired from accepted: deadline and permissionless refund
- refund_stale: exactly deadline + 7 days, permissionless and no verdict
- refund_stale: cannot bypass recorded pass
- refund_stale: cannot bypass recorded fail
- paused: create blocked, every exit and in-flight step remains available
- settlement/refund: destination substitution and wrong vault cannot steal funds
- state machine rejects every forbidden outgoing instruction from accepted
- state machine rejects every forbidden outgoing instruction from submitted
- state machine rejects every forbidden outgoing instruction from passed
- state machine rejects every forbidden outgoing instruction from failed
- state machine rejects every forbidden outgoing instruction from disputed

## submit_delivery

- update_config: restricted, immutable mint/admin, bounds and validator rotation
- accept/submit: correct agent, immutable delivery, byte limits and deadline boundary
- record_verdict: restricted, exactly once, hashes and timestamp
- finalize passed: window boundary, payee, closure, replay
- finalize failed: window boundary, payee, closure, replay
- open_dispute from passed by client
- open_dispute from passed by agent
- open_dispute from failed by client
- open_dispute from failed by agent
- open_dispute: exact closed boundary rejected
- resolve_dispute pay: admin only, exact recipient, close
- resolve_dispute refund: admin only, exact recipient, close
- refund_stale: exactly deadline + 7 days, permissionless and no verdict
- refund_stale: cannot bypass recorded pass
- refund_stale: cannot bypass recorded fail
- paused: create blocked, every exit and in-flight step remains available
- settlement/refund: destination substitution and wrong vault cannot steal funds
- state machine rejects every forbidden outgoing instruction from open
- state machine rejects every forbidden outgoing instruction from submitted
- state machine rejects every forbidden outgoing instruction from passed
- state machine rejects every forbidden outgoing instruction from failed
- state machine rejects every forbidden outgoing instruction from disputed

## record_verdict

- update_config: restricted, immutable mint/admin, bounds and validator rotation
- record_verdict: restricted, exactly once, hashes and timestamp
- finalize passed: window boundary, payee, closure, replay
- finalize failed: window boundary, payee, closure, replay
- open_dispute from passed by client
- open_dispute from passed by agent
- open_dispute from failed by client
- open_dispute from failed by agent
- open_dispute: exact closed boundary rejected
- resolve_dispute pay: admin only, exact recipient, close
- resolve_dispute refund: admin only, exact recipient, close
- refund_stale: cannot bypass recorded pass
- refund_stale: cannot bypass recorded fail
- paused: create blocked, every exit and in-flight step remains available
- settlement/refund: destination substitution and wrong vault cannot steal funds
- state machine rejects every forbidden outgoing instruction from open
- state machine rejects every forbidden outgoing instruction from accepted
- state machine rejects every forbidden outgoing instruction from passed
- state machine rejects every forbidden outgoing instruction from failed
- state machine rejects every forbidden outgoing instruction from disputed

## open_dispute

- open_dispute from passed by client
- open_dispute from passed by agent
- open_dispute from failed by client
- open_dispute from failed by agent
- open_dispute: exact closed boundary rejected
- resolve_dispute pay: admin only, exact recipient, close
- resolve_dispute refund: admin only, exact recipient, close
- paused: create blocked, every exit and in-flight step remains available
- state machine rejects every forbidden outgoing instruction from open
- state machine rejects every forbidden outgoing instruction from accepted
- state machine rejects every forbidden outgoing instruction from submitted
- state machine rejects every forbidden outgoing instruction from disputed

## resolve_dispute

- resolve_dispute pay: admin only, exact recipient, close
- resolve_dispute refund: admin only, exact recipient, close
- paused: create blocked, every exit and in-flight step remains available
- state machine rejects every forbidden outgoing instruction from open
- state machine rejects every forbidden outgoing instruction from accepted
- state machine rejects every forbidden outgoing instruction from submitted
- state machine rejects every forbidden outgoing instruction from passed
- state machine rejects every forbidden outgoing instruction from failed

## finalize

- finalize passed: window boundary, payee, closure, replay
- finalize failed: window boundary, payee, closure, replay
- open_dispute from passed by client
- open_dispute from passed by agent
- open_dispute from failed by client
- open_dispute from failed by agent
- paused: create blocked, every exit and in-flight step remains available
- settlement/refund: destination substitution and wrong vault cannot steal funds
- state machine rejects every forbidden outgoing instruction from open
- state machine rejects every forbidden outgoing instruction from accepted
- state machine rejects every forbidden outgoing instruction from submitted
- state machine rejects every forbidden outgoing instruction from disputed

## refund_expired

- refund_expired from open: deadline and permissionless refund
- refund_expired from accepted: deadline and permissionless refund
- paused: create blocked, every exit and in-flight step remains available
- state machine rejects every forbidden outgoing instruction from submitted
- state machine rejects every forbidden outgoing instruction from passed
- state machine rejects every forbidden outgoing instruction from failed
- state machine rejects every forbidden outgoing instruction from disputed

## refund_stale

- open_dispute from passed by client
- open_dispute from passed by agent
- open_dispute from failed by client
- open_dispute from failed by agent
- refund_stale: exactly deadline + 7 days, permissionless and no verdict
- refund_stale: cannot bypass recorded pass
- refund_stale: cannot bypass recorded fail
- paused: create blocked, every exit and in-flight step remains available
- state machine rejects every forbidden outgoing instruction from open
- state machine rejects every forbidden outgoing instruction from accepted
- state machine rejects every forbidden outgoing instruction from passed
- state machine rejects every forbidden outgoing instruction from failed
- state machine rejects every forbidden outgoing instruction from disputed

