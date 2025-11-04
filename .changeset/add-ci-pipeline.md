---
"@eclesia/eclesia-indexer-core": patch
---

Add GitHub Actions CI/CD pipeline for automated quality checks. The pipeline includes four jobs:
1. **Lint and Type Check**: Runs ESLint and TypeScript type checking across all packages
2. **Test**: Executes test suite for indexer-engine package
3. **Build**: Builds all packages to ensure compilation succeeds
4. **Security Audit**: Runs pnpm audit to check for security vulnerabilities (moderate+ level)

Pipeline runs on pushes and pull requests to main and develop branches, uses pnpm caching for faster builds, and runs on Ubuntu with Node.js 20. This ensures code quality and prevents broken code from being merged.
