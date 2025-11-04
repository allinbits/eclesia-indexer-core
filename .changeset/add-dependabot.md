---
"@eclesia/eclesia-indexer-core": patch
---

Add Dependabot configuration for automated dependency updates and security scanning. Configuration includes:
- Weekly npm dependency updates (Mondays at 9am)
- Weekly GitHub Actions updates
- Groups all dependencies together to reduce PR noise
- Ignores major version updates to prevent breaking changes
- Automatically labels PRs with "dependencies" and "automated"
- Limits to 10 open PRs for npm, 5 for GitHub Actions
- Assigns to eclesia-maintainers team for review

This enables automated security vulnerability detection and streamlines dependency maintenance.
