# @eclesia/eclesia-indexer-core

## 1.3.0-next.0

### Minor Changes

- f3f5979: Add API reference documentation covering all three core packages. Includes package overviews, interface documentation, type definitions, event system guide, utility function examples, and module implementation patterns. Configured TypeDoc for automated documentation generation.
- 0566761: Add benchmark suite for performance profiling using Vitest bench. Created benchmarks for block data processing, string operations, number operations, and object operations. Includes bench script in package.json for tracking performance metrics over time.
- c23d9e1: Add E2E test infrastructure with genesis fixture validation. Created tests directory with vitest configuration, genesis test fixture, and 10 E2E tests validating genesis file structure, account data, balances, and staking parameters.
- 8aba0ab: Add Grafana dashboard templates for indexer monitoring. Includes JSON dashboard with 10 panels covering indexing progress, error rates, performance metrics, and system health. Provides setup documentation and recommended alerts.
- 5445d50: Add comprehensive performance tuning guide covering configuration optimization, database tuning, hardware recommendations, and monitoring strategies. Includes PostgreSQL settings, indexing recommendations, and scaling strategies.
- 88d15dc: Add comprehensive security documentation covering trust model, network security, data integrity, access control, and deployment security. Includes threat model, secure configuration examples, and security checklist for production deployments.
- 3fe7aed: Add comprehensive troubleshooting guide covering common errors, debugging tips, performance issues, and FAQ. Includes solutions for database connections, RPC issues, genesis processing, module errors, and recovery strategies.

### Patch Changes

- e4b6dab: Add dependency audit scripts to root package.json for security vulnerability scanning. New scripts include `pnpm audit` for checking dependencies, `pnpm audit:fix` for automatic fixes, and `pnpm outdated` for checking outdated packages.
- 751a5ed: Add GitHub Actions CI/CD pipeline for automated quality checks. The pipeline includes four jobs:

  1. **Lint and Type Check**: Runs ESLint and TypeScript type checking across all packages
  2. **Test**: Executes test suite for indexer-engine package
  3. **Build**: Builds all packages to ensure compilation succeeds
  4. **Security Audit**: Runs pnpm audit to check for security vulnerabilities (moderate+ level)

  Pipeline runs on pushes and pull requests to main and develop branches, uses pnpm caching for faster builds, and runs on Ubuntu with Node.js 20. This ensures code quality and prevents broken code from being merged.

- 6f33689: Add Dependabot configuration for automated dependency updates and security scanning. Configuration includes:

  - Weekly npm dependency updates (Mondays at 9am)
  - Weekly GitHub Actions updates
  - Groups all dependencies together to reduce PR noise
  - Ignores major version updates to prevent breaking changes
  - Automatically labels PRs with "dependencies" and "automated"
  - Limits to 10 open PRs for npm, 5 for GitHub Actions
  - Assigns to eclesia-maintainers team for review

  This enables automated security vulnerability detection and streamlines dependency maintenance.

- 1ecf859: Add pre-commit hooks using Husky and lint-staged to automatically run ESLint and TypeScript checks on staged files before commits. Helps prevent broken commits and maintains code quality.
