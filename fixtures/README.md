# Deterministic mission fixtures

These synthetic fixtures contain no personal data. The three curated criteria documents use JSON Schema draft 2020-12, validated with Ajv. Unknown or modified criteria for an existing version fail closed.

- `invoice.v1`: the six specification fields. Amounts are decimal **strings** with exactly two decimal places; the named cross-check sums integer cents with `bigint`. Values such as `0.10 + 0.20` remain exact. Monetary numbers, more than two decimal places and negative amounts are rejected rather than rounded.
- `contract.v1`: `title`, `parties`, `effective_date`, `termination`, `governing_law`. The specification and console only prescribe the last field and a total of five fields; these four additional fields are this implementation's explicit template choice. This validates structure, not legal accuracy.
- `address.v1`: exactly twelve synthetic French rows, each with `name`, `street`, `city`, `postcode`, `country`. Normalization removes whitespace from postcodes and preserves leading zeroes. Five ASCII digits are the scoped format rule; geographic existence is not checked.

The **agent de référence scripté** copies invoice/contract fixture input and normalizes the address postcodes. Its dishonest mode changes precisely one field relative to the honest output: remove `total_amount`; remove `governing_law`; replace row 7's postcode with `INVALID`. It calls no AI API.

The specification defines the exact failure messages. The read-only site reference `src/data/mission.mjs` agrees; no site files were changed.

Sources: [protocol specification §5–6](../docs/spec/SPEC_M-1_devnet_v2.md), [latest stage-3 scope](../docs/spec/M1_STAGE3_LOCAL_UPDATE.md), [Ajv JSON Schema 2020-12](https://ajv.js.org/json-schema.html#draft-2020-12-breaking), [Ajv formats](https://ajv.js.org/guide/formats.html).

## Content bytes and reports

The local content store writes `data/<sha256>.json`: object keys sorted lexicographically, compact JSON, UTF-8 and one final LF. It rejects unsupported/non-finite values and cyclic objects. This deterministic format is not claimed to be RFC 8785. The hash covers exact stored bytes, including the final LF. Every read checks the hash again; corrupted files are rejected. URIs point to GitHub `main/data` and are under 200 bytes, but the resolver never performs network requests. In an unmerged PR these URI files do not yet exist on `main`; reference data remains reviewable in the branch.

Reports contain mission, schema, named check results, pass/fail, the exact console message, the scripted-agent label and content hashes when supplied. They include no timestamp or random field, so retrying the same inputs for the same mission yields identical bytes and report hash.
