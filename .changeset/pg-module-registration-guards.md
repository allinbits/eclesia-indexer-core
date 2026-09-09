---
"@eclesia/basic-pg-indexer": patch
---

`addModules()` rejects a duplicate module name and any module added after `setup()`, which would otherwise be registered without its schema.
