# Owner scope update · 2026-10-07

This later request supersedes steps 2, 4 and 5 in M1_FREE_ARCHITECTURE.md. Original specifications remain unmodified.

- GitHub development only. No deployment on devnet or anywhere else.
- Keep the public repository, milestone, issues, draft PRs and public CI.
- Step 1 unchanged: complete Anchor program, tests, coverage, SDK, state machine and threat model.
- Step 3: validator, scripted agent and runner tested against a local validator in CI; 10 local missions including dishonest missions, all dishonest missions refunded. Ephemeral test keys generated in CI only.
- No devnet mint, faucet, devnet-run workflow or GitHub secrets.
- Stop after CHECKIN-1, then after CHECKIN-3. Only the owner merges.
- No paid services, mainnet, $MULE operations or mule-site changes.
