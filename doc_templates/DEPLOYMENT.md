# Deployment Documentation Template

## Overview
This document describes the deployment procedures, environments, and infrastructure for the application.

## Environments

### Environment Overview
| Environment | Purpose | URL | Database | CI/CD |
|------------|---------|-----|----------|-------|
| **Local** | Development | http://localhost:3000 | Local Supabase | Manual |
| **Staging** | Pre-production testing | https://staging.example.com | Staging DB | Auto-deploy from `develop` |
| **Production** | Live environment | https://example.com | Production DB | Manual approval from `main` |

### Environment Configuration

#### Local Development
```bash
# .env.local
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=your-local-anon-key
TEMPORAL_ADDRESS=localhost:7234
```

#### Staging
```bash
# Environment variables in CI/CD or cloud platform
NODE_ENV=staging
DATABASE_URL=<staging-database-url>
SUPABASE_URL=https://your-staging-project.supabase.co
SUPABASE_ANON_KEY=<staging-anon-key>
TEMPORAL_ADDRESS=staging-temporal.example.com:7234
```

#### Production
```bash
# Environment variables in CI/CD or cloud platform
NODE_ENV=production
DATABASE_URL=<production-database-url>
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=<production-anon-key>
TEMPORAL_ADDRESS=temporal.example.com:7234
```

## Deployment Methods

### Automated Deployment (CI/CD)

#### GitHub Actions Workflow
```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches:
      - main      # Production
      - develop   # Staging

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run tests
        run: npm test
        
      - name: Build
        run: npm run build
        env:
          NODE_ENV: production
          
      - name: Deploy to staging
        if: github.ref == 'refs/heads/develop'
        run: |
          # Deploy to staging environment
          ./scripts/deploy.sh staging
          
      - name: Deploy to production
        if: github.ref == 'refs/heads/main'
        run: |
          # Deploy to production environment
          ./scripts/deploy.sh production
```

#### Deployment Status
- Check deployment status: GitHub Actions tab
- Monitor via [Dashboard URL]
- Notifications: Slack #deployments channel

### Manual Deployment

#### Prerequisites
```bash
# Required CLI tools
- Docker
- kubectl (for Kubernetes)
- aws/gcloud/az CLI (cloud provider)
- Deployment scripts
```

#### Staging Deployment
```bash
# 1. Checkout branch
git checkout develop
git pull origin develop

# 2. Build application
npm run build

# 3. Run tests
npm test

# 4. Deploy
./scripts/deploy.sh staging

# 5. Verify deployment
curl https://staging.example.com/health
```

#### Production Deployment
```bash
# 1. Checkout main branch
git checkout main
git pull origin main

# 2. Create release tag
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0

# 3. Build application
NODE_ENV=production npm run build

# 4. Run full test suite
npm test
npm run test:e2e

# 5. Deploy with approval
./scripts/deploy.sh production

# 6. Verify deployment
curl https://example.com/health

# 7. Monitor for issues
# Check logs and metrics
```

## Database Migrations

### Pre-Deployment
```bash
# 1. Test migrations locally
supabase db reset --config supabase/config.toml

# 2. Generate migration file (if needed)
supabase migration new add_new_feature --config supabase/config.toml

# 3. Review migration
cat supabase/migrations/YYYYMMDDHHMMSS_add_new_feature.sql

# 4. Commit migration
git add supabase/migrations/
git commit -m "Add migration for new feature"
```

### During Deployment

#### Staging
```bash
# Migrations run automatically during staging deploy
# Or manually:
supabase db push --config supabase/config.toml \
  --db-url $STAGING_DATABASE_URL
```

#### Production
```bash
# 1. Backup database
./scripts/backup-db.sh production

# 2. Apply migrations
supabase db push --config supabase/config.toml \
  --db-url $PRODUCTION_DATABASE_URL

# 3. Verify schema
psql $PRODUCTION_DATABASE_URL -c "\dt"

# 4. Test critical queries
./scripts/test-db.sh production
```

### Rollback Migrations
```bash
# Restore from backup
./scripts/restore-db.sh production <backup-timestamp>

# Or apply rollback migration
supabase migration new rollback_feature --config supabase/config.toml
# Edit migration to undo changes
supabase db push --config supabase/config.toml
```

## Deployment Checklist

### Pre-Deployment
- [ ] All tests passing (unit, integration, e2e)
- [ ] Code review completed and approved
- [ ] Security scan completed (no critical issues)
- [ ] Dependencies updated and scanned
- [ ] Database migrations reviewed and tested
- [ ] Environment variables configured
- [ ] Backup created (production only)
- [ ] Deployment scheduled and communicated
- [ ] Rollback plan prepared

### During Deployment
- [ ] Stop accepting new requests (if needed)
- [ ] Apply database migrations
- [ ] Deploy new application version
- [ ] Run smoke tests
- [ ] Check error rates and logs
- [ ] Verify critical functionality
- [ ] Monitor performance metrics

### Post-Deployment
- [ ] All health checks passing
- [ ] No error spikes in logs
- [ ] Performance metrics normal
- [ ] Database queries performing well
- [ ] External integrations working
- [ ] User-facing features working
- [ ] Deployment documented
- [ ] Team notified of completion

## Rollback Procedures

### When to Rollback
- Critical bugs in production
- High error rates (> 5%)
- Performance degradation (> 50% slower)
- Data integrity issues
- Security vulnerabilities

### Rollback Steps

#### Application Rollback
```bash
# 1. Rollback to previous version
kubectl rollout undo deployment/app

# Or redeploy previous version
docker pull your-registry/app:previous-version
docker tag your-registry/app:previous-version your-registry/app:latest
./scripts/deploy.sh production

# 2. Verify rollback
curl https://example.com/health

# 3. Monitor logs and metrics
kubectl logs -f deployment/app
```

#### Database Rollback
```bash
# 1. Stop application (prevent writes)
kubectl scale deployment/app --replicas=0

# 2. Restore from backup
./scripts/restore-db.sh production <backup-timestamp>

# 3. Verify data
psql $PRODUCTION_DATABASE_URL -c "SELECT COUNT(*) FROM users;"

# 4. Restart application
kubectl scale deployment/app --replicas=3
```

### Post-Rollback
1. Investigate root cause
2. Document incident
3. Create postmortem
4. Fix issues
5. Deploy fix to staging
6. Re-deploy to production

## Infrastructure

### Cloud Architecture

#### Services
- **Compute**: Docker containers on Kubernetes/ECS/Cloud Run
- **Database**: Supabase (PostgreSQL)
- **Storage**: S3/GCS/Azure Blob Storage
- **CDN**: CloudFront/Cloud CDN
- **Load Balancer**: Application Load Balancer
- **DNS**: Route53/Cloud DNS

#### Scaling
- **Horizontal scaling**: Auto-scaling groups (min: 2, max: 10)
- **Vertical scaling**: Instance types configurable
- **Database scaling**: Connection pooling, read replicas
- **CDN**: Automatically scales

### Container Orchestration

#### Kubernetes Deployment
```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
      - name: app
        image: your-registry/app:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: app-secrets
              key: database-url
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

#### Deploying to Kubernetes
```bash
# Apply deployment
kubectl apply -f deployment.yaml

# Check status
kubectl get pods
kubectl get deployments

# View logs
kubectl logs -f deployment/app

# Scale deployment
kubectl scale deployment/app --replicas=5

# Update image
kubectl set image deployment/app app=your-registry/app:v2
```

### Docker Deployment

#### Build and Push
```bash
# Build image
docker build -t your-registry/app:v1.0.0 .

# Tag as latest
docker tag your-registry/app:v1.0.0 your-registry/app:latest

# Push to registry
docker push your-registry/app:v1.0.0
docker push your-registry/app:latest
```

#### Deploy with Docker Compose (Production)
```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  app:
    image: your-registry/app:latest
    restart: always
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: ${DATABASE_URL}
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
```

```bash
# Deploy
docker compose -f docker-compose.prod.yml up -d

# Check status
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f
```

## Monitoring Deployment

### Health Checks
```bash
# Application health
curl https://example.com/health

# Expected response:
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### Smoke Tests
```bash
# Run automated smoke tests
npm run test:smoke -- --env=production

# Manual checks
curl https://example.com/api/v1/users
curl https://example.com/api/v1/health
```

### Metrics to Monitor
- Request rate (requests per second)
- Error rate (errors per minute)
- Response time (p50, p95, p99)
- CPU usage
- Memory usage
- Database connections
- Queue depth (Temporal)

### Alerts
Configure alerts for:
- Error rate > 5%
- Response time > 2s (p95)
- CPU usage > 80%
- Memory usage > 90%
- Failed health checks

## Deployment Best Practices

### General Practices
1. **Test thoroughly** in staging before production
2. **Deploy during low-traffic** periods
3. **Deploy incrementally** (canary or blue-green)
4. **Monitor closely** during and after deployment
5. **Have rollback plan** ready
6. **Communicate** with team before/during/after
7. **Document** deployment process and issues

### Blue-Green Deployment
```bash
# Deploy to green environment (inactive)
./scripts/deploy.sh production-green

# Test green environment
./scripts/smoke-test.sh production-green

# Switch traffic to green
./scripts/switch-traffic.sh green

# Monitor for issues
# If problems, switch back to blue
./scripts/switch-traffic.sh blue
```

### Canary Deployment
```bash
# Deploy new version to 10% of instances
kubectl set image deployment/app app=your-registry/app:v2 \
  --record

# Monitor metrics for 10 minutes
# If stable, increase to 50%
kubectl scale deployment/app-v2 --replicas=5

# If stable, complete rollout
kubectl scale deployment/app-v1 --replicas=0
kubectl scale deployment/app-v2 --replicas=10
```

### Zero-Downtime Deployment
1. Deploy new version alongside old version
2. Health checks ensure new version is ready
3. Load balancer routes traffic to healthy instances
4. Gradually shift traffic to new version
5. Remove old version when traffic shifted

## Deployment Scripts

### deploy.sh
```bash
#!/bin/bash
# Usage: ./scripts/deploy.sh <environment>

ENVIRONMENT=$1

if [ "$ENVIRONMENT" = "staging" ]; then
  # Staging deployment
  docker build -t your-registry/app:staging .
  docker push your-registry/app:staging
  kubectl set image deployment/app app=your-registry/app:staging \
    --namespace=staging
elif [ "$ENVIRONMENT" = "production" ]; then
  # Production deployment
  docker build -t your-registry/app:latest .
  docker push your-registry/app:latest
  kubectl set image deployment/app app=your-registry/app:latest \
    --namespace=production
else
  echo "Invalid environment: $ENVIRONMENT"
  exit 1
fi
```

## Troubleshooting Deployments

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common deployment issues.

## Additional Resources

- [Build Documentation](./BUILD.md)
- [Monitoring Documentation](./MONITORING.md)
- [Runbook](./RUNBOOK.md)
- [Architecture Documentation](./ARCHITECTURE.md)
