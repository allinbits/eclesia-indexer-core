# Security Considerations

This document outlines security considerations, trust assumptions, and best practices for deploying the Eclesia Indexer.

## Trust Model

### RPC Endpoint Trust

**Critical Assumption:** The indexer **fully trusts** the RPC endpoint.

**Implications:**
- All block data is accepted as valid
- No independent verification of block signatures
- No consensus participation
- Malicious RPC can provide false data

**Mitigation Strategies:**
1. **Run your own RPC node** (recommended)
2. Use RPC from trusted infrastructure provider
3. Implement external data validation if needed
4. Monitor for anomalies in indexed data
5. Compare data across multiple indexers for critical applications

**Risk Level:** HIGH if using untrusted RPC

### Database Security

**Trust Level:** The database is part of your trusted infrastructure.

**Assumptions:**
- Database server is secure and access-controlled
- Network connection to database is trusted
- No SQL injection from blockchain data (all data parameterized)

**Best Practices:**
1. Use strong authentication (never trust auth)
2. Encrypt connections (SSL/TLS for PostgreSQL)
3. Restrict database network access
4. Use dedicated database user with minimal privileges
5. Regular security updates for PostgreSQL

## Network Security

### RPC Connection

**Recommended:** Use private network or VPN
- Keep RPC endpoints internal
- Don't expose RPC to public internet
- Use firewall rules to restrict access

**TLS/HTTPS:**
```typescript
{
  rpcUrl: "https://secure-rpc.example.com:443"  // Use HTTPS
}
```

**Authentication:**
- RPC endpoints may require auth headers
- Store credentials in environment variables
- Never commit credentials to version control

### Database Connection

**Always use credentials:**
```
postgresql://username:password@host:port/database
```

**SSL Mode (recommended for production):**
```
postgresql://user:pass@host:5432/db?sslmode=require
```

**Certificate Verification:**
```
postgresql://user:pass@host:5432/db?sslmode=verify-full&sslrootcert=/path/to/ca.crt
```

### Health Check Endpoint

**Default:** Listens on 0.0.0.0:8080

**Security Considerations:**
- Exposes indexer status publicly
- No sensitive data included
- Consider restricting to internal network

**Firewall rules:**
```bash
# Allow only from monitoring network
iptables -A INPUT -p tcp --dport 8080 -s 10.0.0.0/8 -j ACCEPT
iptables -A INPUT -p tcp --dport 8080 -j DROP
```

### Metrics Endpoint

If exposing Prometheus metrics:

**Recommendations:**
1. Use separate port from health check
2. Restrict to monitoring network
3. Consider authentication (basic auth, mTLS)
4. Don't expose to public internet

**Example with authentication:**
```typescript
app.get("/metrics", basicAuth, async (req, res) => {
  res.set("Content-Type", metrics.registry.contentType);
  res.end(await metrics.getMetrics());
});
```

## Data Integrity

### Blockchain Data

**Validation Performed:**
- Configuration validation at startup
- Database connection string format
- Environment variable format (CHAIN_PREFIX)
- Transaction rollback on processing errors

**No Validation:**
- Block signatures (trusts RPC)
- Transaction signatures (trusts RPC)
- Consensus rules (not a validator)

**Data Integrity Checks:**
```sql
-- Check for gaps in block heights
SELECT height + 1 AS missing_height
FROM blocks
WHERE height + 1 NOT IN (SELECT height FROM blocks)
  AND height < (SELECT MAX(height) FROM blocks);

-- Verify balance consistency
SELECT address, COUNT(*) as balance_count
FROM balances
GROUP BY address
HAVING COUNT(*) > 1;  -- Should only have one balance per address at a given height
```

### Database Integrity

**Protections:**
- UNIQUE constraints on critical columns
- Foreign key constraints where appropriate
- NOT NULL constraints on required fields
- Transaction atomicity (ACID properties)

**Backup Strategy:**
```bash
# Daily backups
pg_dump your_database | gzip > backup-$(date +%Y%m%d).sql.gz

# Point-in-time recovery with WAL archiving
archive_command = 'cp %p /backup/wal/%f'
```

## Access Control

### Minimum Database Privileges

Create dedicated user with limited permissions:

```sql
-- Create indexer user
CREATE USER indexer WITH PASSWORD 'strong_password';

-- Grant minimal required privileges
GRANT CONNECT ON DATABASE your_database TO indexer;
GRANT USAGE ON SCHEMA public TO indexer;

-- Grant table privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO indexer;
GRANT CREATE ON SCHEMA public TO indexer;  -- For initial schema creation

-- For production (after schema created):
REVOKE CREATE ON SCHEMA public FROM indexer;
```

### File System Access

**Required Access:**
- Read access to genesis file (if processing genesis)
- Write access to log directory
- No other file system access needed

**Recommendations:**
- Run as non-root user
- Use dedicated service account
- Restrict file permissions (chmod 600 for config files)

## Input Validation

### Configuration Validation

**Implemented:**
- RPC URL format validation
- Database connection string format
- Port number validation (1-65535)
- Positive integer validation for heights
- File path existence checks

**Example:**
```typescript
// All validated at startup
{
  rpcUrl: "http://localhost:26657",      // URL format checked
  dbConnectionString: "postgresql://...", // Connection string format checked
  healthCheckPort: 8080,                  // Port range validated
  startHeight: 1,                         // Positive integer validated
  genesisPath: "/path/to/genesis.json"   // File existence checked
}
```

### Runtime Input Validation

**Blockchain Data:**
- All data from RPC is considered untrusted for security purposes
- Parameterized queries prevent SQL injection
- No eval() or dynamic code execution
- JSON parsing with error handling

**Example of safe query:**
```typescript
// Safe - parameterized
await db.query(
  "INSERT INTO accounts(address) VALUES($1)",
  [untrustedAddress]
);

// NEVER do this - SQL injection risk
await db.query(
  `INSERT INTO accounts(address) VALUES('${untrustedAddress}')`
);
```

## Common Vulnerabilities

### SQL Injection - MITIGATED

**Protection:**
- All queries use parameterized statements
- No string interpolation in SQL
- PostgreSQL driver handles escaping

**Verification:**
```bash
# Search codebase for unsafe patterns
grep -r "query(\`" packages/  # Should find nothing
grep -r 'query("INSERT.*\${' packages/  # Should find nothing
```

### Denial of Service

**Potential Vectors:**
1. **Large genesis files** - Mitigated by chunked processing
2. **RPC flooding** - Rate limited by batchSize
3. **Database overload** - Mitigated by connection recycling
4. **Memory exhaustion** - Mitigated by LRU caches

**Additional Protections:**
- Process can be monitored and restarted
- fatal-error events for graceful shutdown
- Health check for monitoring

### Data Tampering

**At Rest:**
- Database access control
- Encrypted storage (if required)
- Regular backups

**In Transit:**
- TLS for RPC connections
- SSL for database connections
- Private networks recommended

### Credential Exposure

**Best Practices:**
1. **Never commit credentials**
2. Use environment variables
3. Rotate credentials regularly
4. Use .env files (add to .gitignore)
5. Limit credential scope

**Example:**
```bash
# .env file (never commit)
DB_CONNECTION_STRING=postgresql://user:pass@localhost:5432/db
RPC_URL=http://localhost:26657

# In code
{
  dbConnectionString: process.env.DB_CONNECTION_STRING,
  rpcUrl: process.env.RPC_URL
}
```

## Deployment Security

### Docker Security

**Recommendations:**
```dockerfile
# Use specific version, not latest
FROM node:20-alpine

# Run as non-root user
RUN addgroup -g 1001 indexer && \
    adduser -D -u 1001 -G indexer indexer
USER indexer

# Limit capabilities
# In docker-compose.yml:
cap_drop:
  - ALL
cap_add:
  - NET_BIND_SERVICE  # Only if needed for port < 1024
```

### Kubernetes Security

**Pod Security:**
```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1001
  fsGroup: 1001
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
```

**Network Policies:**
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: indexer-network-policy
spec:
  podSelector:
    matchLabels:
      app: eclesia-indexer
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: prometheus  # Only monitoring can access metrics
    ports:
    - protocol: TCP
      port: 9090
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: postgres
    ports:
    - protocol: TCP
      port: 5432
  - to:
    - podSelector:
        matchLabels:
          app: rpc-node
    ports:
    - protocol: TCP
      port: 26657
```

## Secrets Management

### Environment Variables

**Good:**
```bash
export DB_PASSWORD=$(vault read -field=password secret/indexer/db)
```

**Better:**
Use secrets management:
- Kubernetes Secrets
- HashiCorp Vault
- AWS Secrets Manager
- Azure Key Vault

### Configuration Files

**Never include in version control:**
- Database passwords
- API keys
- Private keys
- Any sensitive credentials

**Use .gitignore:**
```
.env
.env.local
config.local.json
secrets/
```

## Monitoring & Alerting

### Security Monitoring

**Monitor for:**
1. Unexpected error rates (potential attack)
2. Unusual database query patterns
3. Failed authentication attempts
4. Abnormal resource usage
5. fatal-error events

**Alerting:**
```promql
# High error rate
rate(indexer_errors_total[5m]) > 10

# Database connection failures
rate(indexer_database_errors_total[5m]) > 5

# Unusual RPC failures
rate(indexer_rpc_errors_total[5m]) > 10
```

### Audit Logging

**Log security-relevant events:**
- Startup/shutdown
- Configuration changes
- Fatal errors
- Database connection events

**Already logged:**
- All errors (with context)
- Database client reconnections
- RPC connection status
- Fatal error events

## Compliance Considerations

### Data Privacy

**Blockchain data is public** by design:
- All indexed data is from public blockchain
- No personal data beyond blockchain addresses
- GDPR may not apply to blockchain data

**Considerations:**
- Log rotation to prevent long-term storage of IPs
- Don't add off-chain personal data to indexed data
- Document data retention policies

### Audit Trail

**Immutable Record:**
- Blocks table provides complete audit trail
- Heights are sequential and unique
- Transactions are atomic

**Verification:**
```sql
-- Verify no gaps in indexed blocks
SELECT
  CASE
    WHEN COUNT(*) = (MAX(height) - MIN(height) + 1)
    THEN 'No gaps'
    ELSE 'Gaps detected'
  END as integrity_check
FROM blocks;
```

## Incident Response

### Security Incident Procedures

1. **Detection:**
   - Monitor alerts trigger
   - Unusual patterns detected
   - User reports issue

2. **Containment:**
   - Stop indexer if actively being compromised
   - Isolate affected systems
   - Preserve logs and state

3. **Investigation:**
   - Review logs for attack vector
   - Check database for tampering
   - Verify RPC data integrity
   - Assess scope of compromise

4. **Recovery:**
   - Patch vulnerabilities
   - Restore from clean backup if needed
   - Verify data integrity
   - Resume operations

5. **Post-Incident:**
   - Document incident
   - Update security measures
   - Improve monitoring
   - Share learnings (if appropriate)

## Best Practices Summary

### DO:
✅ Run your own RPC node
✅ Use strong database authentication
✅ Encrypt network connections (TLS/SSL)
✅ Store credentials in secrets management
✅ Run as non-root user
✅ Implement network restrictions
✅ Monitor security metrics
✅ Keep dependencies updated (Dependabot configured)
✅ Regular backups
✅ Use pre-commit hooks for code quality

### DON'T:
❌ Trust public RPC endpoints for critical applications
❌ Store credentials in code or config files
❌ Run as root user
❌ Expose database to public internet
❌ Disable SSL/TLS in production
❌ Use default passwords
❌ Ignore security updates
❌ Skip input validation

## Vulnerability Reporting

If you discover a security vulnerability:

1. **DO NOT** open a public issue
2. Email security team privately
3. Include:
   - Description of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
4. Allow reasonable time for patch before disclosure

## Security Updates

**Stay Updated:**
- Monitor GitHub security advisories
- Subscribe to security mailing lists
- Use Dependabot (already configured)
- Regular dependency audits: `pnpm audit`

**Update Process:**
1. Review security advisory
2. Test update in non-production
3. Verify no breaking changes
4. Deploy to production
5. Monitor for issues

## Security Checklist

Before production deployment:

- [ ] RPC endpoint is trusted/controlled by you
- [ ] Database uses strong authentication
- [ ] SSL/TLS enabled for all network connections
- [ ] Credentials stored in secrets management
- [ ] Running as non-root user
- [ ] Network access properly restricted
- [ ] Monitoring and alerting configured
- [ ] Backups automated and tested
- [ ] Security updates process established
- [ ] Incident response plan documented
- [ ] Health check endpoint not publicly exposed
- [ ] Metrics endpoint authentication enabled
- [ ] Log rotation configured
- [ ] File permissions properly set (600 for configs)
- [ ] .env files in .gitignore

## Threat Model

### In-Scope Threats

**What the indexer protects against:**
- SQL injection via blockchain data
- Database connection issues
- Application crashes from malformed data
- Resource exhaustion (memory leaks)
- Process hangs

**Mitigations Implemented:**
- Parameterized queries
- Input validation
- Error handling and recovery
- LRU caches with size limits
- Connection recycling
- Graceful shutdown
- Transaction rollback

### Out-of-Scope Threats

**What the indexer does NOT protect against:**
- Malicious RPC providing false data
- Compromised database server
- Network-level attacks (DDoS, MitM)
- Operating system vulnerabilities
- Supply chain attacks on dependencies

**Responsibility:**
These threats must be addressed at infrastructure level:
- Use trusted RPC nodes
- Secure database servers
- Network security (firewalls, VPN)
- OS hardening and updates
- Dependency scanning (Dependabot + manual review)

## Data Sensitivity

### Public Data

**All indexed data is public:**
- Block headers and hashes
- Transaction data
- Account addresses
- Balances and delegations
- Validator information

**No sensitive data unless:**
- Custom modules add off-chain data
- Application logs include sensitive info

### Logging

**What's logged:**
- Block heights and hashes
- Transaction counts
- Error messages and stack traces
- Performance metrics
- Database queries (in debug mode)

**Not logged:**
- User IP addresses (no HTTP server in indexer)
- Authentication credentials
- Private keys (indexer doesn't use any)

**Log Security:**
- Rotate logs to prevent disk fill
- Secure log storage
- Limit retention period
- Sanitize logs before sharing

## Dependency Security

### Automated Scanning

**Already Configured:**
- Dependabot for automated updates
- GitHub Actions security audit on CI/CD
- pnpm audit script

**Manual Review:**
```bash
# Check for vulnerabilities
pnpm audit

# Check outdated packages
pnpm outdated

# Update with caution
pnpm audit --fix
```

### Supply Chain Security

**Protections:**
- Lock file committed (pnpm-lock.yaml)
- Specific version pins in package.json
- No wildcards in critical dependencies
- Regular dependency updates

**Risks:**
- Compromised npm packages
- Malicious dependencies

**Mitigations:**
- Review dependency changes
- Use reputable packages only
- Monitor security advisories
- Consider vendoring critical dependencies

## Secure Configuration Examples

### Production Configuration

```typescript
import { PgIndexer } from "@eclesia/basic-pg-indexer";
import { AuthModule, BankModule, StakingModule } from "@eclesia/core-modules-pg";

// Load from environment
const config = {
  rpcUrl: process.env.RPC_URL || "http://localhost:26657",
  dbConnectionString: process.env.DB_CONNECTION_STRING,
  startHeight: parseInt(process.env.START_HEIGHT || "1"),
  batchSize: parseInt(process.env.BATCH_SIZE || "500"),
  logLevel: "info" as const,
  healthCheckPort: 8080,
  minimal: false,
  processGenesis: false,
  usePolling: false,
  pollingInterval: 5000,
  modules: ["cosmos.auth.v1beta1", "cosmos.bank.v1beta1", "cosmos.staking.v1beta1"]
};

// Validate required env vars
if (!config.dbConnectionString) {
  throw new Error("DB_CONNECTION_STRING environment variable required");
}

const indexer = PgIndexer.withModules(config, [
  new AuthModule([]),
  new BankModule([]),
  new StakingModule([])
]);
```

### Environment Variables

```bash
# .env.example (commit this)
RPC_URL=http://localhost:26657
DB_CONNECTION_STRING=postgresql://user:pass@localhost:5432/indexer
START_HEIGHT=1
BATCH_SIZE=500
LOG_LEVEL=info
HEALTH_CHECK_PORT=8080

# .env (DO NOT COMMIT)
RPC_URL=https://production-rpc.internal:443
DB_CONNECTION_STRING=postgresql://indexer:ACTUAL_PASSWORD@db.internal:5432/mainnet?sslmode=require
START_HEIGHT=1000000
BATCH_SIZE=700
LOG_LEVEL=info
HEALTH_CHECK_PORT=8080
```

## Security Maintenance

### Regular Tasks

**Weekly:**
- Review security logs
- Check monitoring alerts
- Verify backup integrity

**Monthly:**
- Rotate credentials
- Review access logs
- Update dependencies
- Security audit

**Quarterly:**
- Penetration testing (if required)
- Access control review
- Incident response drill
- Security training

### Dependency Updates

**Process:**
1. Monitor Dependabot PRs
2. Review changelogs for breaking changes
3. Check for security advisories
4. Test in non-production
5. Deploy with rollback plan
6. Monitor for issues

## Contact

For security concerns or to report vulnerabilities, contact the security team (configure based on your organization).
