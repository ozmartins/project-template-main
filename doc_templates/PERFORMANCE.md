# Performance Documentation Template

## Overview
This document describes performance benchmarks, optimization strategies, and performance monitoring for the application.

## Performance Goals

### Target Metrics
| Metric | Target | Acceptable | Critical |
|--------|--------|------------|----------|
| API Response Time (p95) | < 200ms | < 500ms | < 1000ms |
| Page Load Time (p95) | < 2s | < 3s | < 5s |
| Database Query Time (p95) | < 50ms | < 100ms | < 500ms |
| Time to First Byte (TTFB) | < 100ms | < 200ms | < 500ms |
| Throughput | > 1000 req/s | > 500 req/s | > 100 req/s |
| Error Rate | < 0.1% | < 1% | < 5% |
| CPU Usage | < 50% | < 70% | < 90% |
| Memory Usage | < 60% | < 80% | < 95% |

### Service Level Objectives (SLOs)
- **Availability**: 99.9% uptime (< 43 minutes downtime per month)
- **Latency**: 95% of requests complete in < 500ms
- **Error Rate**: < 1% of requests result in errors

## Benchmarks

### Current Performance (as of YYYY-MM-DD)

#### API Endpoints
| Endpoint | Method | p50 | p95 | p99 | RPS |
|----------|--------|-----|-----|-----|-----|
| GET /api/v1/users | GET | 45ms | 120ms | 250ms | 500 |
| POST /api/v1/users | POST | 80ms | 200ms | 450ms | 200 |
| GET /api/v1/users/:id | GET | 35ms | 90ms | 180ms | 800 |
| PUT /api/v1/users/:id | PUT | 95ms | 250ms | 500ms | 150 |
| DELETE /api/v1/users/:id | DELETE | 60ms | 150ms | 300ms | 50 |

#### Database Queries
| Query Type | p50 | p95 | p99 | Frequency |
|------------|-----|-----|-----|-----------|
| Simple SELECT | 5ms | 15ms | 30ms | High |
| JOIN (2 tables) | 12ms | 35ms | 70ms | Medium |
| Complex aggregation | 50ms | 150ms | 300ms | Low |
| INSERT | 8ms | 20ms | 45ms | Medium |
| UPDATE | 10ms | 25ms | 55ms | Medium |

#### Page Load Times
| Page | p50 | p95 | p99 | TTFB |
|------|-----|-----|-----|------|
| Home | 1.2s | 2.1s | 3.5s | 85ms |
| Dashboard | 1.8s | 3.2s | 5.0s | 120ms |
| Profile | 1.5s | 2.8s | 4.2s | 95ms |

### Load Testing Results

#### Test Configuration
- **Tool**: k6, Artillery, or JMeter
- **Duration**: 10 minutes
- **Ramp-up**: 0 to 1000 users over 2 minutes
- **Steady state**: 1000 concurrent users for 6 minutes
- **Ramp-down**: 1000 to 0 users over 2 minutes

#### Results
```
Scenario: Normal Load
- Total Requests: 600,000
- Success Rate: 99.95%
- Average Response Time: 145ms
- p95 Response Time: 380ms
- p99 Response Time: 850ms
- Throughput: 1000 req/s
- CPU Usage: 45%
- Memory Usage: 62%

Scenario: Peak Load (2x normal)
- Total Requests: 1,200,000
- Success Rate: 99.5%
- Average Response Time: 285ms
- p95 Response Time: 720ms
- p99 Response Time: 1500ms
- Throughput: 2000 req/s
- CPU Usage: 78%
- Memory Usage: 85%

Scenario: Stress Test (5x normal)
- Total Requests: 2,500,000
- Success Rate: 95%
- Average Response Time: 850ms
- p95 Response Time: 2500ms
- p99 Response Time: 5000ms
- Throughput: 4166 req/s
- CPU Usage: 95%
- Memory Usage: 92%
- Note: Some timeouts and errors at this load
```

## Performance Optimization

### Frontend Optimization

#### Code Splitting
```javascript
// Lazy load components
const Dashboard = lazy(() => import('./components/Dashboard'));
const Profile = lazy(() => import('./components/Profile'));

// Use Suspense for loading states
<Suspense fallback={<Loading />}>
  <Dashboard />
</Suspense>
```

#### Image Optimization
- Use modern formats (WebP, AVIF)
- Implement lazy loading
- Serve responsive images
- Use CDN for static assets
- Compress images before upload

```html
<!-- Responsive images -->
<picture>
  <source srcset="image.avif" type="image/avif">
  <source srcset="image.webp" type="image/webp">
  <img src="image.jpg" alt="Description" loading="lazy">
</picture>
```

#### Bundle Optimization
```bash
# Analyze bundle size
npm run build -- --analyze

# Tree shaking (remove unused code)
# Modern bundlers do this automatically

# Minification
# Enabled in production builds
```

#### Caching Strategy
```javascript
// Service Worker for offline caching
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('v1').then((cache) => {
      return cache.addAll([
        '/',
        '/styles.css',
        '/script.js',
        '/images/logo.png'
      ]);
    })
  );
});

// HTTP cache headers
res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
```

### Backend Optimization

#### Database Query Optimization

##### Indexing
```sql
-- Create indexes for frequently queried columns
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_created ON users(created_at);

-- Composite index for common query patterns
CREATE INDEX idx_users_type_status ON users(user_type, status);

-- Partial index for filtered queries
CREATE INDEX idx_active_users ON users(id) WHERE status = 'active';

-- GIN index for JSONB columns
CREATE INDEX idx_users_metadata ON users USING GIN (metadata);
```

##### Query Analysis
```sql
-- Analyze query performance
EXPLAIN ANALYZE
SELECT u.*, p.name as profile_name
FROM users u
LEFT JOIN profiles p ON u.id = p.user_id
WHERE u.status = 'active'
ORDER BY u.created_at DESC
LIMIT 100;

-- Check for sequential scans (bad)
-- Look for index scans (good)
```

##### N+1 Query Prevention
```javascript
// ❌ Bad: N+1 queries
const users = await db.query('SELECT * FROM users');
for (const user of users) {
  const profile = await db.query(
    'SELECT * FROM profiles WHERE user_id = $1',
    [user.id]
  );
  user.profile = profile;
}

// ✅ Good: Single query with JOIN
const users = await db.query(`
  SELECT u.*, p.name as profile_name
  FROM users u
  LEFT JOIN profiles p ON u.id = p.user_id
`);
```

#### Caching

##### Application-Level Caching
```javascript
// Redis caching
const cache = new Redis();

async function getUser(userId) {
  // Try cache first
  const cached = await cache.get(`user:${userId}`);
  if (cached) {
    return JSON.parse(cached);
  }
  
  // Fetch from database
  const user = await db.query(
    'SELECT * FROM users WHERE id = $1',
    [userId]
  );
  
  // Cache for 5 minutes
  await cache.setex(`user:${userId}`, 300, JSON.stringify(user));
  
  return user;
}
```

##### HTTP Caching
```javascript
// Set cache headers for GET requests
app.get('/api/v1/users/:id', (req, res) => {
  res.set({
    'Cache-Control': 'public, max-age=60',
    'ETag': generateETag(user),
    'Last-Modified': user.updated_at
  });
  res.json(user);
});
```

##### Database Query Caching
```javascript
// Cache expensive queries
const cachedQuery = await cache.wrap('expensive-report', async () => {
  return await db.query(`
    SELECT 
      DATE(created_at) as date,
      COUNT(*) as count,
      AVG(amount) as avg_amount
    FROM transactions
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(created_at)
    ORDER BY date
  `);
}, { ttl: 3600 }); // Cache for 1 hour
```

#### Connection Pooling
```javascript
// PostgreSQL connection pool
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'mydb',
  user: 'user',
  password: 'password',
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Use pool for queries
const result = await pool.query('SELECT * FROM users');
```

#### Asynchronous Processing
```javascript
// Offload heavy tasks to background jobs
async function createUser(userData) {
  // Create user synchronously
  const user = await db.createUser(userData);
  
  // Send email asynchronously (Temporal workflow)
  await temporal.startWorkflow({
    workflowId: `send-welcome-email-${user.id}`,
    taskQueue: 'email-tasks',
    args: [user.email, user.name]
  });
  
  return user;
}
```

### Infrastructure Optimization

#### Horizontal Scaling
```bash
# Scale up replicas
kubectl scale deployment/app --replicas=10

# Auto-scaling based on CPU
kubectl autoscale deployment/app --min=3 --max=10 --cpu-percent=70
```

#### Content Delivery Network (CDN)
- Serve static assets from CDN
- Cache API responses at edge locations
- Use geographic distribution for low latency

#### Load Balancing
- Distribute traffic across multiple instances
- Use health checks to route to healthy instances
- Implement session affinity if needed

#### Database Optimization
- Read replicas for read-heavy workloads
- Connection pooling (PgBouncer)
- Database partitioning for large tables
- Materialized views for complex queries

```sql
-- Create materialized view
CREATE MATERIALIZED VIEW daily_stats AS
SELECT 
  DATE(created_at) as date,
  COUNT(*) as transaction_count,
  SUM(amount) as total_amount
FROM transactions
GROUP BY DATE(created_at);

-- Refresh periodically
REFRESH MATERIALIZED VIEW daily_stats;
```

## Performance Monitoring

### Key Performance Indicators (KPIs)
- Request throughput (requests per second)
- Response time (p50, p95, p99)
- Error rate
- Apdex score (Application Performance Index)
- Resource utilization (CPU, memory, disk)

### Monitoring Tools
- **APM**: New Relic, Datadog, or AppDynamics
- **Infrastructure**: Prometheus + Grafana
- **Logs**: ELK Stack or Supabase logs
- **Real User Monitoring**: Google Analytics, Sentry

### Dashboards
Create dashboards for:
- Application performance (response times, throughput)
- Infrastructure health (CPU, memory, disk)
- Database performance (query times, connections)
- Error tracking (error rates, types)
- User experience (page load times, Core Web Vitals)

### Alerts
Set up alerts for:
- Response time > threshold
- Error rate > threshold
- CPU/Memory > threshold
- Database connection pool exhausted
- Disk space low

## Performance Testing

### Tools
- **k6**: Modern load testing tool
- **Artillery**: Easy-to-use load testing
- **JMeter**: Feature-rich performance testing
- **Lighthouse**: Frontend performance auditing

### Running Performance Tests

#### Load Test with k6
```javascript
// load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp up
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 200 },  // Ramp to 200 users
    { duration: '5m', target: 200 },  // Stay at 200 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% under 500ms
    http_req_failed: ['rate<0.01'],   // Error rate < 1%
  },
};

export default function () {
  let response = http.get('https://api.example.com/v1/users');
  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  sleep(1);
}
```

```bash
# Run load test
k6 run load-test.js

# Run with more virtual users
k6 run --vus 500 --duration 10m load-test.js
```

#### Frontend Performance with Lighthouse
```bash
# Install Lighthouse CLI
npm install -g lighthouse

# Run audit
lighthouse https://example.com --output html --output-path ./report.html

# CI integration
lighthouse https://example.com --preset=desktop --chrome-flags="--headless" --output json --output-path ./lighthouse.json
```

### Continuous Performance Testing
```yaml
# .github/workflows/performance.yml
name: Performance Tests

on:
  pull_request:
  schedule:
    - cron: '0 0 * * *' # Daily

jobs:
  performance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Run k6 load test
        uses: grafana/k6-action@v0.3.0
        with:
          filename: load-test.js
          
      - name: Run Lighthouse
        uses: treosh/lighthouse-ci-action@v9
        with:
          urls: |
            https://staging.example.com
          uploadArtifacts: true
```

## Performance Best Practices

### General Guidelines
1. **Measure first**: Profile before optimizing
2. **Optimize bottlenecks**: Focus on slowest parts
3. **Use caching**: Cache expensive operations
4. **Lazy load**: Load resources on demand
5. **Compress**: Compress responses (gzip, brotli)
6. **CDN**: Use CDN for static assets
7. **Database**: Optimize queries and add indexes
8. **Async**: Offload heavy tasks to background jobs
9. **Monitor**: Continuously monitor performance
10. **Test**: Regular performance testing

### Code Review Checklist
- [ ] Database queries are optimized (no N+1)
- [ ] Proper indexes exist for queries
- [ ] Caching is used where appropriate
- [ ] Large payloads are paginated
- [ ] Images are optimized and lazy loaded
- [ ] Heavy computation is asynchronous
- [ ] No unnecessary re-renders (frontend)
- [ ] Bundle size is acceptable
- [ ] API responses are compressed
- [ ] Resource limits are configured

## Performance Regression Detection

### Automated Checks
```yaml
# Example: Fail CI if performance degrades
- name: Check performance
  run: |
    NEW_P95=$(cat results.json | jq '.p95')
    BASELINE_P95=500
    if (( $(echo "$NEW_P95 > $BASELINE_P95" | bc -l) )); then
      echo "Performance regression detected: p95 ${NEW_P95}ms > ${BASELINE_P95}ms"
      exit 1
    fi
```

### Tracking Over Time
- Store performance metrics in time-series database
- Create trends dashboard
- Alert on significant deviations
- Regular performance reviews

## Troubleshooting Performance Issues

### Investigation Steps
1. Identify affected endpoints/pages
2. Check recent changes/deployments
3. Analyze logs for errors or slow queries
4. Review monitoring dashboards
5. Profile application code
6. Check database query performance
7. Verify infrastructure resources
8. Test with reduced load

### Common Issues
- **Slow database queries**: Add indexes, optimize queries
- **Memory leaks**: Profile and fix leaks
- **CPU bound**: Optimize algorithms, scale horizontally
- **I/O bound**: Use caching, async processing
- **Network latency**: Use CDN, reduce payload size
- **Too many requests**: Implement rate limiting, caching

## Additional Resources

- [Monitoring Documentation](./MONITORING.md)
- [Database Documentation](./DATABASE.md)
- [Architecture Documentation](./ARCHITECTURE.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)

## References
- [Web.dev Performance](https://web.dev/performance/)
- [PostgreSQL Performance Tips](https://www.postgresql.org/docs/current/performance-tips.html)
- [k6 Documentation](https://k6.io/docs/)
