# Instruction coverage

Executed against the compiled SBF in LiteSVM. This is instruction/scenario coverage, not Rust line or branch coverage.

Test cases: 51/51 passed.

| Instruction | Successful assertions | Rejected assertions |
| --- | ---: | ---: |
| initialize_config | 60 | 4 |
| update_config | 17 | 6 |
| propose_admin | 4 | 4 |
| accept_admin | 3 | 5 |
| create_mission | 54 | 19 |
| cancel_mission | 5 | 7 |
| accept_mission | 43 | 11 |
| submit_delivery | 35 | 9 |
| record_verdict | 30 | 8 |
| open_dispute | 17 | 10 |
| resolve_dispute | 6 | 11 |
| finalize | 11 | 33 |
| refund_expired | 3 | 8 |
| refund_stale | 3 | 13 |

Counts include setup calls. Each recorded call asserted its expected result; successful calls also asserted its event.

## initialize_config

- initialize_config: defaults, authority and six-decimal mint
- initialize_config: forged ProgramData PDA rejected
- initialize_config: zero authority rejected
- update_config: restricted, unchanged mint/admin, bounds and validator rotation
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
- designated agent: only the designated signer accepts; field and event agree
- designated agent: None preserves permissionless acceptance
- designated agent: client self-designation rejected atomically
- dispute timeout passed: opening time, exact boundary, recipient, rent and closure
- dispute timeout failed: opening time, exact boundary, recipient, rent and closure
- dispute timeout: overflow rejected without losing original verdict
- resolve_dispute: after timeout first resolution wins and finalization cannot replay
- admin transfer: current admin proposes, pending signer accepts, old rights revoked
- admin transfer: no proposal, replacement, default rejection and replay
- validator conflict: current validator cannot create as client; rotation releases the old key
- validator conflict: designated validator rejected before and after rotation
- validator conflict: acceptance reads current Config and releases old validator after rotation
- validator conflict: a previously designated agent cannot accept after becoming validator
- sweep on LiteSVM: stale submission refunded exactly at seven days and never sent twice
- sweep on LiteSVM: disputed passed settles at fourteen days
- sweep on LiteSVM: disputed failed settles at fourteen days

## update_config

- update_config: restricted, unchanged mint/admin, bounds and validator rotation
- paused: create blocked, every exit and in-flight step remains available
- admin transfer: current admin proposes, pending signer accepts, old rights revoked
- validator conflict: current validator cannot create as client; rotation releases the old key
- validator conflict: designated validator rejected before and after rotation
- validator conflict: acceptance reads current Config and releases old validator after rotation
- validator conflict: a previously designated agent cannot accept after becoming validator

## propose_admin

- admin transfer: current admin proposes, pending signer accepts, old rights revoked
- admin transfer: no proposal, replacement, default rejection and replay

## accept_admin

- admin transfer: current admin proposes, pending signer accepts, old rights revoked
- admin transfer: no proposal, replacement, default rejection and replay

## create_mission

- update_config: restricted, unchanged mint/admin, bounds and validator rotation
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
- designated agent: only the designated signer accepts; field and event agree
- designated agent: None preserves permissionless acceptance
- designated agent: client self-designation rejected atomically
- dispute timeout passed: opening time, exact boundary, recipient, rent and closure
- dispute timeout failed: opening time, exact boundary, recipient, rent and closure
- dispute timeout: overflow rejected without losing original verdict
- resolve_dispute: after timeout first resolution wins and finalization cannot replay
- admin transfer: current admin proposes, pending signer accepts, old rights revoked
- validator conflict: current validator cannot create as client; rotation releases the old key
- validator conflict: designated validator rejected before and after rotation
- validator conflict: acceptance reads current Config and releases old validator after rotation
- validator conflict: a previously designated agent cannot accept after becoming validator
- sweep on LiteSVM: stale submission refunded exactly at seven days and never sent twice
- sweep on LiteSVM: disputed passed settles at fourteen days
- sweep on LiteSVM: disputed failed settles at fourteen days

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
- validator conflict: current validator cannot create as client; rotation releases the old key

## accept_mission

- update_config: restricted, unchanged mint/admin, bounds and validator rotation
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
- designated agent: only the designated signer accepts; field and event agree
- designated agent: None preserves permissionless acceptance
- dispute timeout passed: opening time, exact boundary, recipient, rent and closure
- dispute timeout failed: opening time, exact boundary, recipient, rent and closure
- dispute timeout: overflow rejected without losing original verdict
- resolve_dispute: after timeout first resolution wins and finalization cannot replay
- admin transfer: current admin proposes, pending signer accepts, old rights revoked
- validator conflict: designated validator rejected before and after rotation
- validator conflict: acceptance reads current Config and releases old validator after rotation
- validator conflict: a previously designated agent cannot accept after becoming validator
- sweep on LiteSVM: stale submission refunded exactly at seven days and never sent twice
- sweep on LiteSVM: disputed passed settles at fourteen days
- sweep on LiteSVM: disputed failed settles at fourteen days

## submit_delivery

- update_config: restricted, unchanged mint/admin, bounds and validator rotation
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
- dispute timeout passed: opening time, exact boundary, recipient, rent and closure
- dispute timeout failed: opening time, exact boundary, recipient, rent and closure
- dispute timeout: overflow rejected without losing original verdict
- resolve_dispute: after timeout first resolution wins and finalization cannot replay
- admin transfer: current admin proposes, pending signer accepts, old rights revoked
- sweep on LiteSVM: stale submission refunded exactly at seven days and never sent twice
- sweep on LiteSVM: disputed passed settles at fourteen days
- sweep on LiteSVM: disputed failed settles at fourteen days

## record_verdict

- update_config: restricted, unchanged mint/admin, bounds and validator rotation
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
- dispute timeout passed: opening time, exact boundary, recipient, rent and closure
- dispute timeout failed: opening time, exact boundary, recipient, rent and closure
- dispute timeout: overflow rejected without losing original verdict
- resolve_dispute: after timeout first resolution wins and finalization cannot replay
- admin transfer: current admin proposes, pending signer accepts, old rights revoked
- sweep on LiteSVM: disputed passed settles at fourteen days
- sweep on LiteSVM: disputed failed settles at fourteen days

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
- dispute timeout passed: opening time, exact boundary, recipient, rent and closure
- dispute timeout failed: opening time, exact boundary, recipient, rent and closure
- dispute timeout: overflow rejected without losing original verdict
- resolve_dispute: after timeout first resolution wins and finalization cannot replay
- admin transfer: current admin proposes, pending signer accepts, old rights revoked
- sweep on LiteSVM: disputed passed settles at fourteen days
- sweep on LiteSVM: disputed failed settles at fourteen days

## resolve_dispute

- resolve_dispute pay: admin only, exact recipient, close
- resolve_dispute refund: admin only, exact recipient, close
- paused: create blocked, every exit and in-flight step remains available
- state machine rejects every forbidden outgoing instruction from open
- state machine rejects every forbidden outgoing instruction from accepted
- state machine rejects every forbidden outgoing instruction from submitted
- state machine rejects every forbidden outgoing instruction from passed
- state machine rejects every forbidden outgoing instruction from failed
- dispute timeout passed: opening time, exact boundary, recipient, rent and closure
- dispute timeout failed: opening time, exact boundary, recipient, rent and closure
- resolve_dispute: after timeout first resolution wins and finalization cannot replay
- admin transfer: current admin proposes, pending signer accepts, old rights revoked

## finalize

- finalize passed: window boundary, payee, closure, replay
- finalize failed: window boundary, payee, closure, replay
- open_dispute from passed by client
- open_dispute from passed by agent
- open_dispute from failed by client
- open_dispute from failed by agent
- resolve_dispute pay: admin only, exact recipient, close
- resolve_dispute refund: admin only, exact recipient, close
- paused: create blocked, every exit and in-flight step remains available
- settlement/refund: destination substitution and wrong vault cannot steal funds
- state machine rejects every forbidden outgoing instruction from open
- state machine rejects every forbidden outgoing instruction from accepted
- state machine rejects every forbidden outgoing instruction from submitted
- dispute timeout passed: opening time, exact boundary, recipient, rent and closure
- dispute timeout failed: opening time, exact boundary, recipient, rent and closure
- resolve_dispute: after timeout first resolution wins and finalization cannot replay
- admin transfer: current admin proposes, pending signer accepts, old rights revoked
- sweep on LiteSVM: disputed passed settles at fourteen days
- sweep on LiteSVM: disputed failed settles at fourteen days

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
- sweep on LiteSVM: stale submission refunded exactly at seven days and never sent twice

