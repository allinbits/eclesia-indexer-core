---
"create-eclesia-indexer": minor
---

- Generated Dockerfiles are proper multi-stage builds on Node 22: dependencies are installed and compiled in a build stage, only `dist` and production dependencies reach the runtime image, the container runs as the unprivileged `node` user, and pnpm is pinned. A `.dockerignore` keeps `node_modules`, `.env` and the genesis file out of the image.
- Generated projects declare `engines.node >= 22`, pin tsdown 0.16 with `fixedExtension: false` so the output stays `dist/index.js`, depend on the 2.16 line of the eclesia packages, and ship the project license as `LICENSE.md`.
