---
"@eclesia/core-modules-pg": patch
---

- Consensus addresses for secp256k1 validator keys are derived as CometBFT does (ripemd160 of sha256); ed25519 keys are unchanged.
- `MsgEditValidator` follows the SDK: only the `[do-not-modify]` sentinel keeps a description field, an empty string clears it. `avatar_url` is no longer filled with the identity string.
- Event attributes that arrive as raw bytes (CometBFT 0.34) are stored as base64 in `transactions.logs` instead of one key per byte.
- `getValidatorDescription` is the correctly spelt lookup; the old name remains as an alias. Prepared statement names are unique across modules. Two redundant indexes are dropped by migrations.
