# Runbook Template

## Overview
This runbook contains operational procedures, incident response playbooks, and troubleshooting guides for on-call engineers and operators.

## Emergency Contacts

### On-Call Rotation
- **Primary On-Call**: [PagerDuty/Opsgenie Link]
- **Secondary On-Call**: [PagerDuty/Opsgenie Link]
- **Engineering Manager**: [Name] - [Email] - [Phone]
- **Director of Engineering**: [Name] - [Email] - [Phone]

### Escalation Path
1. Primary On-Call (5 minutes)
2. Secondary On-Call (15 minutes)
3. Engineering Manager (30 minutes)
4. Director of Engineering (1 hour)

### Team Contacts
- **Backend Team**: Slack #backend, backend@example.com
- **Frontend Team**: Slack #frontend, frontend@example.com
- **DevOps Team**: Slack #devops, devops@example.com
- **Security Team**: Slack #security, security@example.com

## Quick Reference

### Service URLs
| Environment | Service | URL | Dashboard |
|------------|---------|-----|-----------|
| Production | Frontend | https://example.com | [Grafana] |
| Production | API | https://api.example.com | [Grafana] |
| Production | Database | [Connection String] | [Supabase] |
| Production | Temporal | https://temporal.example.com:8080 | [Temporal UI] |
| Staging | Frontend | https://staging.example.com | [Grafana] |
| Staging | API | https://api.staging.example.com | [Grafana] |

### Key Metrics Thresholds
| Metric | Normal | Warning | Critical |
|--------|--------|---------|----------|
| Error Rate | < 0.1% | < 1% | > 5% |
| Response Time (p95) | < 200ms | < 500ms | > 1000ms |
| CPU Usage | < 50% | < 80% | > 90% |
| Memory Usage | < 60% | < 85% | > 95% |
| Database Connections | < 50 | < 80 | > 90 |

### Common Commands
```bash
# Check service status
kubectl get pods -n production

# View logs
kubectl logs -f deployment/app -n production --tail=100

# Scale service
kubectl scale deployment/app --replicas=5 -n production

# Restart service
kubectl rollout restart deployment/app -n production

# Database connection
psql $PRODUCTION_DATABASE_URL

# Check recent deployments
kubectl rollout history deployment/app -n production
```

## Incident Response Playbooks

### P0: Complete Service Outage

#### Symptoms
- All health checks failing
- 100% error rate
- No user can access the service

#### Immediate Actions
1. **Acknowledge alert** in PagerDuty/Opsgenie
2. **Update status page**: "We're investigating an outage"
3. **Check infrastructure**:
   ```bash
   kubectl get pods -n production
   kubectl get nodes
   ```
4. **Check recent changes**:
   ```bash
   kubectl rollout history deployment/app -n production
   git log --oneline origin/main -10
   ```
5. **Review logs**:
   ```bash
   kubectl logs -f deployment/app -n production --tail=200
   ```

#### Common Causes and Solutions

##### Recent deployment broke the service
```bash
# Rollback to previous version
kubectl rollout undo deployment/app -n production

# Verify health
curl https://example.com/health
```

##### Database is down
```bash
# Check database status
psql $PRODUCTION_DATABASE_URL -c "SELECT 1;"

# Check Supabase dashboard
# Contact Supabase support if needed

# Check connection pool
psql $PRODUCTION_DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"
```

##### Infrastructure failure (cloud provider)
```bash
# Check cloud provider status page
# Check for ongoing incidents

# If nodes are down, cordon and drain
kubectl cordon <node-name>
kubectl drain <node-name> --ignore-daemonsets

# Scale to healthy nodes
kubectl scale deployment/app --replicas=<current+2> -n production
```

##### Out of memory/resources
```bash
# Check resource usage
kubectl top pods -n production
kubectl top nodes

# Scale horizontally
kubectl scale deployment/app --replicas=10 -n production

# Or increase resource limits
kubectl edit deployment/app -n production
# Update resources.limits
```

#### Communication Template
```
Subject: [P0] Service Outage

Status: INVESTIGATING / IDENTIFIED / MONITORING / RESOLVED

We are aware of a service outage affecting all users. The team is investigating the issue.

Impact: All users unable to access the service
Started: [Timestamp]
Current Status: [Details]
Next Update: In 15 minutes

Updates will be posted to: [Status Page URL]
```

#### Post-Incident
1. Write incident report
2. Schedule post-mortem (within 48 hours)
3. Create action items to prevent recurrence

### P1: High Error Rate

#### Symptoms
- Error rate > 5%
- Some users affected
- Specific endpoints failing

#### Immediate Actions
1. **Acknowledge alert**
2. **Identify affected endpoints**:
   ```bash
   # Check error logs
   kubectl logs deployment/app -n production | grep "ERROR" | tail -50
   
   # Check metrics dashboard
   # Look for error rate by endpoint
   ```
3. **Determine scope**:
   - Which users are affected?
   - Which features are broken?
   - Since when?

#### Common Causes and Solutions

##### Database connection pool exhausted
```bash
# Check active connections
psql $PRODUCTION_DATABASE_URL -c "
SELECT count(*), state
FROM pg_stat_activity
GROUP BY state;
"

# Kill idle connections
psql $PRODUCTION_DATABASE_URL -c "
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle'
AND state_change < now() - interval '30 minutes';
"

# Increase pool size (temporary)
# Edit deployment to increase DATABASE_POOL_SIZE
kubectl set env deployment/app DATABASE_POOL_SIZE=50 -n production
```

##### External API dependency failing
```bash
# Check external service status
curl -v https://external-api.com/status

# Enable circuit breaker (if implemented)
kubectl set env deployment/app CIRCUIT_BREAKER_ENABLED=true -n production

# Or disable non-critical external calls
kubectl set env deployment/app FEATURE_FLAG_EXTERNAL_API=false -n production
```

##### Rate limiting or DDoS attack
```bash
# Check request patterns
kubectl logs deployment/app -n production | \
  grep "request_id" | \
  jq -r '.context.ip_address' | \
  sort | uniq -c | sort -rn | head -20

# Block malicious IPs (example with AWS WAF)
aws wafv2 create-ip-set \
  --scope REGIONAL \
  --name BlockedIPs \
  --addresses 1.2.3.4/32 5.6.7.8/32

# Or increase rate limits temporarily
kubectl set env deployment/app RATE_LIMIT_MAX=1000 -n production
```

### P2: Slow Response Times

#### Symptoms
- p95 response time > 1s
- Users reporting slowness
- No errors but degraded performance

#### Immediate Actions
1. **Acknowledge alert**
2. **Check resource usage**:
   ```bash
   kubectl top pods -n production
   kubectl top nodes
   ```
3. **Identify slow endpoints**:
   ```bash
   # Check metrics dashboard
   # Look for slowest endpoints
   
   # Check logs for slow queries
   kubectl logs deployment/app -n production | \
     jq 'select(.context.duration_ms > 1000)'
   ```

#### Common Causes and Solutions

##### Slow database queries
```sql
-- Find slow queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Check for missing indexes
-- Review query plans with EXPLAIN ANALYZE
EXPLAIN ANALYZE <slow-query>;

-- Add index if needed (in migration)
CREATE INDEX CONCURRENTLY idx_table_column ON table(column);
```

##### High CPU usage
```bash
# Scale horizontally
kubectl scale deployment/app --replicas=10 -n production

# Check for CPU-intensive operations in logs
kubectl logs deployment/app -n production | grep "CPU"
```

##### Cache not working
```bash
# Check cache hit rate
# Review Redis/cache metrics

# Clear cache if corrupted
redis-cli FLUSHDB

# Restart cache if needed
kubectl rollout restart deployment/redis -n production
```

### P3: Individual User Issue

#### Symptoms
- Single user or small group affected
- Specific to user data or state
- Not system-wide

#### Actions
1. **Collect information**:
   - User ID
   - Steps to reproduce
   - Error messages
   - Timestamp
2. **Search logs**:
   ```bash
   kubectl logs deployment/app -n production | \
     jq 'select(.context.user_id == "user-uuid")'
   ```
3. **Check user data**:
   ```sql
   SELECT * FROM users WHERE id = 'user-uuid';
   ```
4. **Reproduce issue** in staging if possible

## Common Operational Tasks

### Deploy New Version

#### Standard Deployment
```bash
# 1. Verify tests pass
# Check CI/CD pipeline

# 2. Tag release
git tag -a v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3

# 3. Deploy
kubectl set image deployment/app \
  app=your-registry/app:v1.2.3 \
  -n production

# 4. Monitor rollout
kubectl rollout status deployment/app -n production

# 5. Verify health
curl https://example.com/health

# 6. Monitor metrics
# Watch dashboard for 15 minutes
```

#### Rollback Deployment
```bash
# Rollback to previous version
kubectl rollout undo deployment/app -n production

# Rollback to specific version
kubectl rollout undo deployment/app \
  --to-revision=3 \
  -n production

# Verify
kubectl rollout status deployment/app -n production
```

### Scale Application

#### Manual Scaling
```bash
# Scale up
kubectl scale deployment/app --replicas=10 -n production

# Scale down
kubectl scale deployment/app --replicas=3 -n production

# Verify
kubectl get pods -n production
```

#### Auto-Scaling
```bash
# Configure HPA (Horizontal Pod Autoscaler)
kubectl autoscale deployment/app \
  --min=3 \
  --max=10 \
  --cpu-percent=70 \
  -n production

# Check HPA status
kubectl get hpa -n production
```

### Database Operations

#### Backup Database
```bash
# Manual backup
./scripts/backup-db.sh production

# Verify backup
ls -lh backups/

# Automated backups run daily via Supabase
```

#### Restore Database
```bash
# Stop application (prevent writes)
kubectl scale deployment/app --replicas=0 -n production

# Restore from backup
./scripts/restore-db.sh production <backup-timestamp>

# Verify data
psql $PRODUCTION_DATABASE_URL -c "SELECT COUNT(*) FROM users;"

# Restart application
kubectl scale deployment/app --replicas=3 -n production
```

#### Apply Database Migration
```bash
# 1. Backup database first
./scripts/backup-db.sh production

# 2. Test migration in staging
supabase db push --config supabase/config.toml \
  --db-url $STAGING_DATABASE_URL

# 3. Apply to production
supabase db push --config supabase/config.toml \
  --db-url $PRODUCTION_DATABASE_URL

# 4. Verify
psql $PRODUCTION_DATABASE_URL -c "\dt"

# 5. Monitor for errors
kubectl logs -f deployment/app -n production
```

### Restart Service

#### Graceful Restart
```bash
# Rolling restart (no downtime)
kubectl rollout restart deployment/app -n production

# Monitor
kubectl rollout status deployment/app -n production
```

#### Force Restart
```bash
# Delete pods (recreated automatically)
kubectl delete pods -l app=myapp -n production

# Verify
kubectl get pods -n production
```

### Check Logs

#### Application Logs
```bash
# Real-time logs
kubectl logs -f deployment/app -n production

# Last 100 lines
kubectl logs deployment/app -n production --tail=100

# Logs from specific pod
kubectl logs <pod-name> -n production

# Logs with timestamps
kubectl logs deployment/app -n production --timestamps
```

#### Filter Logs
```bash
# Error logs
kubectl logs deployment/app -n production | grep "ERROR"

# Specific user
kubectl logs deployment/app -n production | \
  jq 'select(.context.user_id == "user-uuid")'

# Slow requests
kubectl logs deployment/app -n production | \
  jq 'select(.context.duration_ms > 1000)'
```

### Update Environment Variables

```bash
# Set environment variable
kubectl set env deployment/app \
  FEATURE_FLAG_NEW_FEATURE=true \
  -n production

# Remove environment variable
kubectl set env deployment/app \
  FEATURE_FLAG_OLD_FEATURE- \
  -n production

# Update from secret
kubectl create secret generic app-secrets \
  --from-literal=api-key=new-key \
  --dry-run=client -o yaml | \
  kubectl apply -f -

# Restart to apply changes
kubectl rollout restart deployment/app -n production
```

## Monitoring and Alerts

### Check System Health
```bash
# All services
kubectl get pods --all-namespaces

# Specific namespace
kubectl get pods -n production

# Node health
kubectl get nodes

# Resource usage
kubectl top pods -n production
kubectl top nodes
```

### View Dashboards
- **Application Metrics**: [Grafana Dashboard URL]
- **Infrastructure**: [Cloud Provider Dashboard]
- **Database**: [Supabase Dashboard]
- **Temporal**: [Temporal UI URL]

### Silence Alerts
```bash
# Silence alert in Alertmanager
amtool silence add \
  alertname="HighErrorRate" \
  --duration=1h \
  --comment="Investigating issue #123"

# List active silences
amtool silence query

# Expire silence
amtool silence expire <silence-id>
```

## Security Incidents

### Suspected Security Breach
1. **DO NOT PANIC**
2. **Isolate affected systems** (if safe to do so)
3. **Contact security team immediately**: security@example.com
4. **Preserve evidence**: Don't delete logs or restart systems
5. **Follow security incident response plan**

### Leaked Credentials
```bash
# 1. Revoke compromised credentials immediately
# Via cloud provider console or API

# 2. Rotate all related credentials
kubectl create secret generic app-secrets \
  --from-literal=api-key=new-key \
  --dry-run=client -o yaml | \
  kubectl apply -f -

# 3. Restart services
kubectl rollout restart deployment/app -n production

# 4. Review access logs
# Check for unauthorized access

# 5. Notify security team
```

## Regular Maintenance

### Daily Tasks
- [ ] Review error logs
- [ ] Check performance metrics
- [ ] Verify backups completed
- [ ] Check for security advisories

### Weekly Tasks
- [ ] Review slow queries
- [ ] Check disk usage
- [ ] Review and tune alerts
- [ ] Check for dependency updates

### Monthly Tasks
- [ ] Review and update runbooks
- [ ] Conduct disaster recovery test
- [ ] Review access permissions
- [ ] Update documentation

## Additional Resources

- [Monitoring Documentation](./MONITORING.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)
- [Deployment Documentation](./DEPLOYMENT.md)
- [Security Documentation](./SECURITY.md)
- [Logging Documentation](./LOGGING.md)

## Runbook Updates

This runbook should be updated:
- After every major incident
- When procedures change
- When new services are added
- During post-mortems

**Last Updated**: YYYY-MM-DD
**Last Review**: YYYY-MM-DD
**Owner**: [Team Name]
