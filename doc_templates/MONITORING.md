# Monitoring Documentation Template

## Overview
This document describes the monitoring and observability strategy, including metrics, logs, traces, and alerting for the application.

## Monitoring Stack

### Tools and Services
- **Metrics**: Prometheus, Datadog, or CloudWatch
- **Logs**: ELK Stack, Supabase Logs, or CloudWatch Logs
- **Traces**: Jaeger, Zipkin, or OpenTelemetry
- **Dashboards**: Grafana, Datadog, or cloud provider dashboards
- **Alerts**: PagerDuty, Opsgenie, or Slack
- **APM**: New Relic, Datadog APM, or Application Insights
- **Uptime**: Pingdom, UptimeRobot, or StatusPage

### Architecture
```
Application → Metrics Exporter → Prometheus → Grafana
Application → Log Forwarder → Elasticsearch → Kibana
Application → Trace Collector → Jaeger → Jaeger UI
Alertmanager → PagerDuty/Slack
```

## Metrics

### Application Metrics

#### Key Metrics
| Metric | Type | Description | Alert Threshold |
|--------|------|-------------|----------------|
| `http_requests_total` | Counter | Total HTTP requests | - |
| `http_request_duration_seconds` | Histogram | Request duration | p95 > 500ms |
| `http_requests_in_progress` | Gauge | Active requests | > 1000 |
| `http_request_errors_total` | Counter | Failed requests | Rate > 5% |
| `database_queries_total` | Counter | Total DB queries | - |
| `database_query_duration_seconds` | Histogram | Query duration | p95 > 100ms |
| `database_connections_active` | Gauge | Active DB connections | > 80% of pool |
| `cache_hits_total` | Counter | Cache hits | - |
| `cache_misses_total` | Counter | Cache misses | Hit rate < 80% |
| `queue_depth` | Gauge | Message queue depth | > 1000 |
| `worker_tasks_processed_total` | Counter | Processed tasks | - |
| `worker_tasks_failed_total` | Counter | Failed tasks | Rate > 1% |

#### Custom Business Metrics
```javascript
// Track business-critical events
metrics.increment('user.registration', { source: 'google_oauth' });
metrics.histogram('payment.amount', amount, { currency: 'USD' });
metrics.gauge('active_users', activeUserCount);
```

### Infrastructure Metrics

#### System Metrics
| Metric | Description | Alert Threshold |
|--------|-------------|----------------|
| CPU Usage | Percentage of CPU used | > 80% |
| Memory Usage | Percentage of RAM used | > 85% |
| Disk Usage | Percentage of disk used | > 90% |
| Disk I/O | Read/write operations per second | - |
| Network I/O | Bytes in/out per second | - |
| Load Average | System load (1m, 5m, 15m) | > num_cores |

#### Container Metrics (Kubernetes/Docker)
- Pod restarts
- Container CPU/memory usage
- Container status (running, failed, pending)
- Node resource utilization

#### Database Metrics
| Metric | Description | Alert Threshold |
|--------|-------------|----------------|
| Connections | Active database connections | > 80% of max |
| Query performance | Slow queries (> 1s) | > 10 per minute |
| Replication lag | Time behind primary | > 5 seconds |
| Cache hit ratio | Percentage of cache hits | < 90% |
| Transaction rate | Transactions per second | - |
| Table size | Size of tables | - |

### Exporting Metrics

#### Prometheus Format
```javascript
// Express.js example with prom-client
const client = require('prom-client');

// Create metrics
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5]
});

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

// Middleware to track metrics
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpRequestDuration.observe({
      method: req.method,
      route: req.route?.path || 'unknown',
      status_code: res.statusCode
    }, duration);
    
    httpRequestsTotal.inc({
      method: req.method,
      route: req.route?.path || 'unknown',
      status_code: res.statusCode
    });
  });
  
  next();
});

// Expose metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});
```

## Logs

### Log Aggregation
See [LOGGING.md](./LOGGING.md) for detailed logging information.

#### Key Log Sources
- Application logs (stdout/stderr)
- Access logs (HTTP requests)
- Error logs (exceptions, stack traces)
- Audit logs (security events)
- Database logs (slow queries, errors)
- Infrastructure logs (Docker, Kubernetes)

#### Log Queries
```
# Find errors in last hour
level:ERROR AND timestamp:>now-1h

# Find slow requests
context.duration_ms:>1000 AND timestamp:>now-1h

# Find failed authentication
message:"authentication failed" AND timestamp:>now-24h
```

## Traces

### Distributed Tracing
Trace requests across multiple services to understand request flow and identify bottlenecks.

#### OpenTelemetry Example
```javascript
const { trace } = require('@opentelemetry/api');
const tracer = trace.getTracer('my-service');

async function processOrder(orderId) {
  const span = tracer.startSpan('processOrder');
  
  try {
    span.setAttribute('order.id', orderId);
    
    // Fetch order
    const order = await tracer.startActiveSpan('fetchOrder', async (childSpan) => {
      const result = await db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
      childSpan.end();
      return result;
    });
    
    // Process payment
    await tracer.startActiveSpan('processPayment', async (childSpan) => {
      childSpan.setAttribute('amount', order.amount);
      await paymentService.charge(order);
      childSpan.end();
    });
    
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}
```

#### Trace Context Propagation
```javascript
// Pass trace context between services
const headers = {
  'traceparent': `00-${traceId}-${spanId}-01`,
  'tracestate': `vendor=value`
};

await fetch('https://api.example.com/endpoint', { headers });
```

## Dashboards

### Application Dashboard

#### Panels
1. **Request Rate**: Requests per second over time
2. **Response Time**: p50, p95, p99 latency
3. **Error Rate**: Errors per minute and percentage
4. **Throughput**: Total requests and data transferred
5. **Active Users**: Current concurrent users
6. **Top Endpoints**: Most frequently called endpoints
7. **Slowest Endpoints**: Endpoints with highest latency
8. **Error Distribution**: Errors by type and endpoint

#### Example Grafana Panel
```json
{
  "title": "Request Rate",
  "targets": [
    {
      "expr": "rate(http_requests_total[5m])",
      "legendFormat": "{{method}} {{route}}"
    }
  ],
  "type": "graph"
}
```

### Infrastructure Dashboard

#### Panels
1. **CPU Usage**: Per container/instance
2. **Memory Usage**: Per container/instance
3. **Disk Usage**: Available space
4. **Network I/O**: Bytes in/out
5. **Container Status**: Running, failed, pending
6. **Pod Restarts**: Restart count over time

### Database Dashboard

#### Panels
1. **Query Performance**: Slow queries count
2. **Connection Pool**: Active vs available connections
3. **Replication Lag**: Time behind primary
4. **Cache Hit Ratio**: Percentage of cache hits
5. **Transaction Rate**: Transactions per second
6. **Table Sizes**: Largest tables

### Business Metrics Dashboard

#### Panels
1. **User Signups**: New users over time
2. **Active Users**: DAU, WAU, MAU
3. **Revenue**: Total and by product
4. **Conversion Rate**: Funnel conversion
5. **Feature Usage**: Most used features

## Alerting

### Alert Channels
- **Critical**: PagerDuty (24/7 on-call)
- **High**: Slack #alerts + Email
- **Medium**: Slack #monitoring
- **Low**: Email summary (daily)

### Alert Rules

#### Application Alerts
```yaml
# High error rate
- alert: HighErrorRate
  expr: rate(http_request_errors_total[5m]) > 0.05
  for: 5m
  severity: high
  annotations:
    summary: "Error rate above 5% for 5 minutes"
    
# Slow response time
- alert: SlowResponseTime
  expr: histogram_quantile(0.95, http_request_duration_seconds) > 0.5
  for: 10m
  severity: medium
  annotations:
    summary: "p95 response time above 500ms for 10 minutes"
    
# High request rate (possible DDoS)
- alert: HighRequestRate
  expr: rate(http_requests_total[1m]) > 10000
  for: 2m
  severity: high
  annotations:
    summary: "Request rate above 10k/s for 2 minutes"
```

#### Infrastructure Alerts
```yaml
# High CPU usage
- alert: HighCPU
  expr: cpu_usage_percent > 80
  for: 10m
  severity: medium
  annotations:
    summary: "CPU usage above 80% for 10 minutes"
    
# High memory usage
- alert: HighMemory
  expr: memory_usage_percent > 85
  for: 5m
  severity: high
  annotations:
    summary: "Memory usage above 85% for 5 minutes"
    
# Disk space low
- alert: LowDiskSpace
  expr: disk_usage_percent > 90
  for: 1m
  severity: critical
  annotations:
    summary: "Disk usage above 90%"
    
# Container restarts
- alert: FrequentRestarts
  expr: increase(container_restarts_total[1h]) > 5
  for: 1m
  severity: high
  annotations:
    summary: "Container restarted more than 5 times in 1 hour"
```

#### Database Alerts
```yaml
# Connection pool exhaustion
- alert: DatabaseConnectionPoolExhausted
  expr: database_connections_active / database_connections_max > 0.9
  for: 5m
  severity: critical
  annotations:
    summary: "Database connection pool above 90% capacity"
    
# Slow queries
- alert: SlowQueries
  expr: rate(database_slow_queries_total[5m]) > 10
  for: 5m
  severity: medium
  annotations:
    summary: "More than 10 slow queries per minute"
    
# Replication lag
- alert: ReplicationLag
  expr: database_replication_lag_seconds > 60
  for: 2m
  severity: high
  annotations:
    summary: "Database replication lag above 60 seconds"
```

### Alert Best Practices
1. **Reduce noise**: Set appropriate thresholds and durations
2. **Actionable**: Include runbook links in alerts
3. **Context**: Provide relevant information (graphs, logs)
4. **Escalation**: Define escalation paths
5. **Review**: Regularly review and tune alerts
6. **Test**: Test alert delivery and escalation

## Health Checks

### Application Health
```javascript
// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION,
    checks: {}
  };
  
  try {
    // Check database
    await db.query('SELECT 1');
    health.checks.database = 'healthy';
  } catch (error) {
    health.checks.database = 'unhealthy';
    health.status = 'unhealthy';
  }
  
  try {
    // Check cache
    await cache.ping();
    health.checks.cache = 'healthy';
  } catch (error) {
    health.checks.cache = 'unhealthy';
    // Cache is optional, don't fail health check
  }
  
  res.status(health.status === 'healthy' ? 200 : 503).json(health);
});
```

### Liveness and Readiness Probes
```yaml
# Kubernetes example
livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3
```

## Synthetic Monitoring

### Uptime Checks
- Monitor critical endpoints every 1-5 minutes
- Check from multiple geographic locations
- Alert on failures

### Smoke Tests
```javascript
// Automated smoke tests
describe('Critical User Flows', () => {
  test('User can sign up', async () => {
    const response = await fetch('https://api.example.com/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'SecurePassword123!'
      })
    });
    expect(response.status).toBe(201);
  });
  
  test('User can log in', async () => {
    const response = await fetch('https://api.example.com/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'SecurePassword123!'
      })
    });
    expect(response.status).toBe(200);
  });
});
```

## Real User Monitoring (RUM)

### Frontend Metrics
- Page load time
- Time to First Byte (TTFB)
- First Contentful Paint (FCP)
- Largest Contentful Paint (LCP)
- Cumulative Layout Shift (CLS)
- First Input Delay (FID)

### User Experience Tracking
```javascript
// Track Core Web Vitals
import { getCLS, getFID, getFCP, getLCP, getTTFB } from 'web-vitals';

getCLS(console.log);
getFID(console.log);
getFCP(console.log);
getLCP(console.log);
getTTFB(console.log);
```

### Error Tracking
```javascript
// Sentry example
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "your-sentry-dsn",
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});

// Capture errors
try {
  riskyOperation();
} catch (error) {
  Sentry.captureException(error);
}
```

## Monitoring Checklist

### Setup Checklist
- [ ] Metrics collection configured
- [ ] Logs aggregation configured
- [ ] Distributed tracing enabled
- [ ] Dashboards created
- [ ] Alerts configured
- [ ] Alert channels tested
- [ ] On-call rotation defined
- [ ] Runbooks created
- [ ] Health checks implemented
- [ ] Synthetic monitoring enabled
- [ ] RUM configured
- [ ] Error tracking configured

### Regular Review
- [ ] Review dashboards weekly
- [ ] Tune alert thresholds monthly
- [ ] Review slow queries weekly
- [ ] Check error patterns weekly
- [ ] Review resource utilization weekly
- [ ] Update runbooks as needed
- [ ] Test disaster recovery quarterly

## Incident Response

### On-Call Rotation
- Primary on-call: [Schedule link]
- Secondary on-call: [Schedule link]
- Escalation: [Manager/Team lead]

### Incident Management
1. **Acknowledge**: Acknowledge alert within 5 minutes
2. **Assess**: Determine severity and impact
3. **Communicate**: Update status page and stakeholders
4. **Mitigate**: Take immediate action to reduce impact
5. **Resolve**: Fix root cause
6. **Document**: Write incident report
7. **Review**: Conduct post-mortem

### Severity Levels
| Severity | Definition | Response Time | Example |
|----------|------------|---------------|---------|
| P0 | Critical outage | 15 minutes | Complete service down |
| P1 | Major impact | 30 minutes | Key feature unavailable |
| P2 | Minor impact | 2 hours | Non-critical feature degraded |
| P3 | Minimal impact | Next business day | Minor bug, cosmetic issue |

## Troubleshooting

### Common Monitoring Issues

#### Missing Metrics
- Check metrics exporter is running
- Verify Prometheus is scraping endpoint
- Check firewall rules

#### Alert Fatigue
- Review and tune alert thresholds
- Add appropriate `for` duration
- Group related alerts
- Use severity levels appropriately

#### Dashboard Not Loading
- Check data source configuration
- Verify metrics are being collected
- Check time range selection

## Additional Resources

- [Logging Documentation](./LOGGING.md)
- [Performance Documentation](./PERFORMANCE.md)
- [Runbook](./RUNBOOK.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)

## References
- [Prometheus Best Practices](https://prometheus.io/docs/practices/)
- [Google SRE Book](https://sre.google/books/)
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
