---
"@eclesia/indexer-engine": patch
---

Make health check HTTP server port configurable via `healthCheckPort` config option or `HEALTH_CHECK_PORT` environment variable. Defaults to port 8080 instead of port 80 to avoid requiring root privileges on Unix systems.
