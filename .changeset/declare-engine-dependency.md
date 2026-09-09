---
"@eclesia/basic-pg-indexer": patch
---

Declare `@eclesia/indexer-engine` as a runtime dependency (it was a devDependency, so consumers had to install it themselves) and drop nine dependencies this package never imports.
