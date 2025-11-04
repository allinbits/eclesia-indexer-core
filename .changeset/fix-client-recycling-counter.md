---
"@eclesia/basic-pg-indexer": patch
---

Fix database client recycling counter to only increment on successful transaction commits. Previously, the counter would increment even on rollbacks or errors, leading to inaccurate recycling timing and potentially premature client resets.
