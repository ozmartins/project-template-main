# Troubleshooting Guide Template

## Overview
This guide provides solutions to common issues encountered during development, deployment, and operation of the application.

## Quick Diagnostics

### Health Checks
```bash
# Check all services are running
docker compose ps

# Check service health
curl http://localhost:3000/health
curl http://localhost:54321/health

# Check database connectivity
psql $DATABASE_URL -c "SELECT 1;"
```

### Common First Steps
1. Check service status: `docker compose ps`
2. Review recent logs: `docker compose logs --tail=100`
3. Verify environment variables: Check `.env` file
4. Check disk space: `df -h`
5. Check memory usage: `free -h` or `docker stats`

## Development Issues

### Docker and Container Issues

#### Issue: Containers won't start
**Symptoms:**
- `docker compose up` fails
- Services show as "Exited" status

**Solutions:**
```bash
# Check Docker is running
docker info

# Check for port conflicts
lsof -i :3000
lsof -i :54321
lsof -i :7234

# Remove existing containers and volumes
make down
docker system prune -a --volumes

# Rebuild from scratch
make reset
```

#### Issue: "Port already in use"
**Symptoms:**
- Error message: "bind: address already in use"

**Solutions:**
```bash
# Find process using the port (example: port 3000)
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or stop all related services
make down

# Change port in .env file if needed
echo "FRONTEND_PORT=3001" >> .env
```

#### Issue: Docker out of disk space
**Symptoms:**
- Build failures with disk space errors
- "No space left on device" error

**Solutions:**
```bash
# Check disk usage
docker system df

# Clean up unused resources
docker system prune -a --volumes

# Remove specific volumes
docker volume ls
docker volume rm <volume-name>

# Clear build cache
docker builder prune -a
```

### Dependency Issues

#### Issue: npm/pnpm install fails
**Symptoms:**
- Package installation errors
- Dependency resolution conflicts

**Solutions:**
```bash
# Clear npm cache
npm cache clean --force

# Remove lock file and node_modules
rm -rf node_modules package-lock.json

# Reinstall dependencies
npm install

# Try legacy peer deps if needed
npm install --legacy-peer-deps

# Use specific Node version
nvm use 18
npm install
```

#### Issue: Module not found errors
**Symptoms:**
- Runtime error: "Cannot find module 'xyz'"
- Build fails with missing module

**Solutions:**
```bash
# Verify package is installed
npm list <package-name>

# Install missing package
npm install <package-name>

# Check import paths
# Verify relative paths are correct

# Clear build cache
rm -rf dist/ .next/ build/
npm run build
```

### Build Issues

#### Issue: Build fails with TypeScript errors
**Symptoms:**
- Type checking errors during build
- "error TS2307: Cannot find module"

**Solutions:**
```bash
# Check TypeScript version
npx tsc --version

# Regenerate type definitions
npm run type-check

# Clear TypeScript cache
rm -rf node_modules/.cache

# Verify tsconfig.json is correct
cat tsconfig.json

# Update type definitions
npm install --save-dev @types/node @types/react
```

#### Issue: Out of memory during build
**Symptoms:**
- "JavaScript heap out of memory"
- Build process killed

**Solutions:**
```bash
# Increase Node memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build

# Or add to package.json scripts
"build": "NODE_OPTIONS='--max-old-space-size=4096' next build"

# Check system memory
free -h

# Close unnecessary applications
```

## Database Issues

### Connection Issues

#### Issue: Cannot connect to database
**Symptoms:**
- "Connection refused" errors
- "FATAL: password authentication failed"

**Solutions:**
```bash
# Check database is running
docker compose ps postgres

# Verify connection string
echo $DATABASE_URL

# Test connection
psql $DATABASE_URL -c "SELECT 1;"

# Check database logs
docker compose logs postgres

# Restart database
docker compose restart postgres
```

#### Issue: Too many connections
**Symptoms:**
- "FATAL: sorry, too many clients already"
- Connection pool exhausted

**Solutions:**
```sql
-- Check current connections
SELECT count(*) FROM pg_stat_activity;

-- Check connection limit
SHOW max_connections;

-- Kill idle connections
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'idle'
AND state_change < now() - interval '10 minutes';
```

```bash
# Increase connection limit in Docker
# Edit docker-compose.yml:
# command: postgres -c max_connections=200

# Use connection pooling (PgBouncer)
# Update DATABASE_URL to point to pooler
```

### Migration Issues

#### Issue: Migration fails to apply
**Symptoms:**
- Migration errors during `supabase db reset`
- Syntax errors in SQL

**Solutions:**
```bash
# Check migration files
ls -la supabase/migrations/

# Apply migrations manually
supabase db reset --config supabase/config.toml

# Check for syntax errors
psql $DATABASE_URL < supabase/migrations/XXXXX_migration.sql

# Roll back to specific migration
supabase db reset --version YYYYMMDDHHMMSS --config supabase/config.toml

# Verify database state
psql $DATABASE_URL -c "\dt"
```

#### Issue: Migration conflicts
**Symptoms:**
- Duplicate column or table errors
- Constraint violations

**Solutions:**
```sql
-- Check if table exists before creating
CREATE TABLE IF NOT EXISTS table_name (...);

-- Check if column exists before adding
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='table_name' AND column_name='column_name') THEN
        ALTER TABLE table_name ADD COLUMN column_name type;
    END IF;
END $$;
```

### Query Performance Issues

#### Issue: Slow queries
**Symptoms:**
- Long response times
- Database CPU at 100%

**Solutions:**
```sql
-- Find slow queries
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Analyze query plan
EXPLAIN ANALYZE <your-query>;

-- Check for missing indexes
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public';

-- Add indexes for frequently queried columns
CREATE INDEX idx_table_column ON table_name(column_name);

-- Vacuum and analyze
VACUUM ANALYZE;
```

## Runtime Issues

### API/Server Issues

#### Issue: API returns 500 errors
**Symptoms:**
- Internal server errors
- Unhandled exceptions

**Solutions:**
```bash
# Check application logs
make logs-api

# Look for error stack traces
docker compose logs api | grep "ERROR"

# Check environment variables
docker compose exec api env | grep -E "DATABASE_URL|API_KEY"

# Restart service
docker compose restart api

# Check service health
curl http://localhost:54321/health
```

#### Issue: API timeout
**Symptoms:**
- Request hangs and times out
- Gateway timeout errors

**Solutions:**
```bash
# Check if service is responsive
curl -v http://localhost:54321/health

# Check database connection pool
# (See database connection issues above)

# Increase timeout limits
# In nginx/proxy configuration:
# proxy_read_timeout 300s;

# Check for deadlocks
SELECT * FROM pg_stat_activity WHERE wait_event_type = 'Lock';

# Review slow queries
# (See query performance issues above)
```

### Authentication Issues

#### Issue: Authentication fails
**Symptoms:**
- 401 Unauthorized errors
- Invalid token errors

**Solutions:**
```bash
# Check JWT secret is set
echo $JWT_SECRET

# Verify token expiration
# Use jwt.io to decode token and check exp claim

# Check Supabase keys
echo $SUPABASE_ANON_KEY
echo $SUPABASE_SERVICE_ROLE_KEY

# Test authentication endpoint
curl -X POST http://localhost:54321/auth/v1/token \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'

# Review RLS policies
psql $DATABASE_URL -c "SELECT * FROM pg_policies;"
```

### Temporal Issues

#### Issue: Workflows not executing
**Symptoms:**
- Workflows stuck in "Running" state
- Worker not processing tasks

**Solutions:**
```bash
# Check Temporal server is running
curl http://localhost:8080

# Check worker logs
make logs-worker

# Verify worker is registered
# Check Temporal UI: http://localhost:8080

# Restart worker
docker compose restart worker

# Check task queue
# In Temporal UI, verify task queue has workers

# Check for worker errors
docker compose logs worker | grep "ERROR"
```

#### Issue: Workflow timeouts
**Symptoms:**
- Workflows failing with timeout errors
- Activities timing out

**Solutions:**
```typescript
// Increase workflow timeout
const workflow = await client.workflow.start({
  workflowId: 'my-workflow',
  taskQueue: 'my-task-queue',
  workflowExecutionTimeout: '24h', // Increase timeout
});

// Increase activity timeout
const result = await proxyActivities<Activities>({
  startToCloseTimeout: '10m', // Increase timeout
})(/* activity call */);
```

## Deployment Issues

### Build/Deploy Failures

#### Issue: CI/CD pipeline fails
**Symptoms:**
- Build fails in CI
- Tests fail in CI but pass locally

**Solutions:**
```bash
# Run CI checks locally
make ci

# Check CI logs
# Review GitHub Actions logs or CI platform

# Verify environment variables
# Ensure all required secrets are set in CI

# Check for platform-specific issues
# (e.g., different Node version in CI)

# Clear CI cache
# Option in GitHub Actions or CI platform
```

#### Issue: Docker image build fails
**Symptoms:**
- Dockerfile syntax errors
- Layer caching issues

**Solutions:**
```bash
# Build without cache
docker build --no-cache -t app:latest .

# Check Dockerfile syntax
docker build --check -f Dockerfile .

# Build with verbose output
docker build --progress=plain -t app:latest .

# Check base image is available
docker pull node:18-alpine

# Verify .dockerignore
cat .dockerignore
```

### Production Issues

#### Issue: Application crashes in production
**Symptoms:**
- Container restarts frequently
- Out of memory errors

**Solutions:**
```bash
# Check container logs
docker logs <container-id>

# Check resource limits
docker inspect <container-id> | grep -A 10 "Memory"

# Increase memory limit
# In docker-compose.yml:
# services:
#   app:
#     deploy:
#       resources:
#         limits:
#           memory: 2G

# Monitor resource usage
docker stats

# Check for memory leaks
# Use profiling tools or heap snapshots
```

## Network Issues

#### Issue: Service cannot reach another service
**Symptoms:**
- Connection refused between services
- DNS resolution failures

**Solutions:**
```bash
# Check Docker network
docker network ls
docker network inspect <network-name>

# Verify services are on same network
docker compose ps

# Test connectivity from one container to another
docker compose exec frontend ping api
docker compose exec frontend curl http://api:3000/health

# Check service names in code match docker-compose.yml
# Use service name, not localhost

# Restart networking
docker compose down
docker compose up
```

## Performance Issues

#### Issue: Slow response times
**Symptoms:**
- High latency
- Requests taking too long

**Solutions:**
1. **Check database performance** (see Query Performance Issues)
2. **Profile API endpoints**
   ```bash
   # Add timing middleware
   # Log request duration
   ```
3. **Check external API calls**
   ```bash
   # Look for slow third-party API calls in logs
   # Add timeouts to external requests
   ```
4. **Review caching strategy**
   - Add Redis caching
   - Enable HTTP caching headers
   - Cache database queries

5. **Check resource utilization**
   ```bash
   docker stats
   # Look for CPU/memory bottlenecks
   ```

## Getting Help

### Escalation Path
1. Check this troubleshooting guide
2. Search application logs for errors
3. Review [LOGGING.md](./LOGGING.md) for log analysis
4. Check [MONITORING.md](./MONITORING.md) for metrics
5. Consult [RUNBOOK.md](./RUNBOOK.md) for operational procedures
6. Contact team via Slack/Teams
7. Create incident ticket for critical issues

### Information to Include
When asking for help, include:
- Error messages (full text)
- Relevant log excerpts
- Steps to reproduce
- Environment (local/staging/production)
- Recent changes or deployments
- Screenshots/recordings if applicable

### Useful Commands for Diagnostics
```bash
# Full system status
make status

# All logs
make logs

# Environment info
docker compose exec app env
node --version
npm --version

# Database status
psql $DATABASE_URL -c "\conninfo"
psql $DATABASE_URL -c "SELECT version();"

# Disk and memory
df -h
free -h
docker stats --no-stream
```

## Additional Resources

- [Logging Documentation](./LOGGING.md)
- [Monitoring Documentation](./MONITORING.md)
- [Runbook](./RUNBOOK.md)
- [Architecture Documentation](./ARCHITECTURE.md)
