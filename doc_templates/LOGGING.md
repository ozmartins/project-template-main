# Logging Documentation Template

## Overview
This document describes the logging infrastructure, log locations, log levels, and how to read and analyze logs.

## Logging Strategy

### Log Levels
The application uses the following log levels (in order of severity):

| Level | Usage | Examples |
|-------|-------|----------|
| **TRACE** | Very detailed information, typically for debugging | Function entry/exit, variable values |
| **DEBUG** | Detailed information for debugging | Query parameters, intermediate calculations |
| **INFO** | General informational messages | Service started, request completed, significant events |
| **WARN** | Warning messages for potential issues | Deprecated API usage, fallback behavior, recoverable errors |
| **ERROR** | Error messages for failures | Failed operations, exceptions caught and handled |
| **FATAL** | Critical errors causing shutdown | Unrecoverable errors, system failures |

### Log Format

#### Structured Logging (JSON)
```json
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "level": "INFO",
  "service": "api",
  "message": "Request completed successfully",
  "context": {
    "method": "GET",
    "path": "/api/v1/users",
    "status": 200,
    "duration_ms": 45,
    "request_id": "uuid-here",
    "user_id": "user-uuid"
  }
}
```

#### Human-Readable Format (Development)
```
2024-01-01 12:00:00.000 INFO  [api] Request completed successfully
  method=GET path=/api/v1/users status=200 duration=45ms request_id=uuid-here
```

## Log Locations

### Local Development

#### Docker Compose Logs
```bash
# View all service logs
make logs

# View specific service logs
make logs-frontend
make logs-temporal
make logs-worker

# Or using docker compose directly
docker compose logs -f
docker compose logs -f frontend
docker compose logs -f worker
```

#### Application Logs
- **Frontend**: `./logs/frontend.log` (if file logging enabled)
- **Backend/API**: `./logs/api.log`
- **Worker**: `./logs/worker.log`
- **Database**: Supabase logs via `supabase logs`

#### Temporal Logs
```bash
# Temporal server logs
docker compose logs -f temporal

# Temporal worker logs
docker compose logs -f worker

# Temporal UI logs
docker compose logs -f temporal-ui
```

### Staging Environment

#### Application Logs
- **Cloud Platform**: Check your cloud provider's logging service
  - AWS: CloudWatch Logs
  - GCP: Cloud Logging
  - Azure: Azure Monitor
- **Log Groups/Streams**: Organized by service name and environment
  - `/app/staging/frontend`
  - `/app/staging/api`
  - `/app/staging/worker`

#### Supabase Logs
Access via Supabase Dashboard:
- **API Logs**: Supabase Dashboard → Logs → API
- **Database Logs**: Supabase Dashboard → Logs → Database
- **Realtime Logs**: Supabase Dashboard → Logs → Realtime

### Production Environment

#### Application Logs
Same as staging, but in production log groups:
- `/app/production/frontend`
- `/app/production/api`
- `/app/production/worker`

#### Centralized Logging
- **Log Aggregation**: Logs are aggregated to [Platform Name]
- **Retention**: Production logs retained for 30 days
- **Access**: Via [Dashboard URL] or CLI

## Reading Logs

### Filtering Logs

#### By Service
```bash
# Docker Compose
docker compose logs -f frontend

# Cloud logging (AWS example)
aws logs filter-log-events \
  --log-group-name /app/production/api \
  --filter-pattern "ERROR"
```

#### By Time Range
```bash
# Docker Compose (last 10 minutes)
docker compose logs --since 10m

# Cloud logging (AWS example)
aws logs filter-log-events \
  --log-group-name /app/production/api \
  --start-time $(date -d '1 hour ago' +%s)000
```

#### By Log Level
```bash
# Using grep
docker compose logs | grep "ERROR"

# Using jq for JSON logs
docker compose logs --no-color | jq 'select(.level == "ERROR")'
```

#### By Request ID
```bash
# Trace a specific request across services
docker compose logs | grep "request_id=abc-123"

# Using jq for JSON logs
docker compose logs --no-color | jq 'select(.context.request_id == "abc-123")'
```

### Analyzing Logs

#### Common Patterns

##### Finding Errors
```bash
# All errors in last hour
docker compose logs --since 1h | grep "ERROR"

# Group errors by type
docker compose logs --no-color | jq -r 'select(.level == "ERROR") | .message' | sort | uniq -c
```

##### Performance Analysis
```bash
# Find slow requests (> 1000ms)
docker compose logs --no-color | jq 'select(.context.duration_ms > 1000)'

# Average response time
docker compose logs --no-color | jq -r '.context.duration_ms' | awk '{sum+=$1; count++} END {print sum/count}'
```

##### Error Rate
```bash
# Count errors vs total requests
docker compose logs --no-color | jq -r '.level' | sort | uniq -c
```

### Log Tools

#### jq (JSON Query)
Essential for parsing JSON logs:
```bash
# Pretty print
docker compose logs --no-color | jq '.'

# Select specific fields
docker compose logs --no-color | jq '{time: .timestamp, level: .level, message: .message}'

# Complex filtering
docker compose logs --no-color | jq 'select(.level == "ERROR" and .context.status >= 500)'
```

#### grep
Basic text filtering:
```bash
# Case-insensitive search
docker compose logs | grep -i "error"

# Context lines
docker compose logs | grep -A 5 -B 5 "ERROR"

# Multiple patterns
docker compose logs | grep -E "ERROR|WARN"
```

#### tail
Follow logs in real-time:
```bash
# Follow log file
tail -f logs/api.log

# Last 100 lines
tail -n 100 logs/api.log

# Follow with filtering
tail -f logs/api.log | grep "ERROR"
```

## Logging Best Practices

### What to Log

**DO Log:**
- Application startup/shutdown
- Request/response at API boundaries
- Authentication attempts (success and failure)
- Database queries (in DEBUG level)
- External API calls
- Errors and exceptions with stack traces
- Business-critical events
- Performance metrics

**DON'T Log:**
- Passwords or secrets
- Personal identifiable information (PII) without masking
- Credit card numbers or payment information
- Session tokens or API keys
- Large payloads (truncate if necessary)

### Log Message Guidelines

#### Good Log Messages
```javascript
// ✅ Structured and informative
logger.info('User authentication successful', {
  user_id: userId,
  method: 'oauth',
  provider: 'google',
  duration_ms: 123
});

// ✅ Error with context
logger.error('Failed to process payment', {
  error: error.message,
  stack: error.stack,
  user_id: userId,
  payment_id: paymentId,
  amount: amount,
  currency: currency
});
```

#### Poor Log Messages
```javascript
// ❌ Not informative
logger.info('Success');

// ❌ Missing context
logger.error('Error occurred');

// ❌ Logging sensitive data
logger.info('User logged in', { password: user.password });
```

### Request Tracing

#### Generate Request ID
```javascript
// Middleware to add request ID
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});
```

#### Log with Request ID
```javascript
logger.info('Processing request', {
  request_id: req.id,
  method: req.method,
  path: req.path
});
```

#### Trace Across Services
Pass request ID in headers when making service calls:
```javascript
await fetch('https://api.example.com/endpoint', {
  headers: {
    'X-Request-ID': requestId
  }
});
```

## Log Monitoring and Alerting

### Key Metrics to Monitor
- Error rate (errors per minute)
- Response time (p50, p95, p99)
- Request volume
- Specific error patterns
- Failed authentication attempts

### Alert Conditions
```yaml
# Example alert configuration
alerts:
  - name: High Error Rate
    condition: error_rate > 10 per minute
    severity: critical
    
  - name: Slow Response Time
    condition: p95_response_time > 2000ms
    severity: warning
    
  - name: Failed Authentication Spike
    condition: auth_failures > 50 per minute
    severity: warning
```

### Log-Based Metrics
Create metrics from logs for dashboards:
- Request count by endpoint
- Error count by type
- Average response time
- User activity patterns

## Troubleshooting with Logs

### Common Scenarios

#### Investigating a User Issue
1. Get the request ID from the user or support ticket
2. Search logs by request ID across all services
3. Follow the request flow chronologically
4. Identify where the error occurred
5. Check related logs (database, external APIs)

#### Debugging Performance Issues
1. Filter logs by endpoint or operation
2. Extract duration metrics
3. Identify slow operations (database queries, API calls)
4. Look for patterns (specific users, times, conditions)

#### Analyzing Errors
1. Filter logs by ERROR level
2. Group by error message or type
3. Check error frequency and patterns
4. Review stack traces for root cause
5. Check related services for cascading failures

### Log Analysis Commands

```bash
# Find errors for specific user
docker compose logs --no-color | jq 'select(.context.user_id == "user-uuid" and .level == "ERROR")'

# Find all database query errors
docker compose logs | grep "database" | grep "ERROR"

# Analyze request distribution by endpoint
docker compose logs --no-color | jq -r '.context.path' | sort | uniq -c | sort -rn

# Find requests with high response time
docker compose logs --no-color | jq 'select(.context.duration_ms > 1000) | {path: .context.path, duration: .context.duration_ms}'
```

## Log Rotation and Retention

### Local Development
- Logs rotate automatically via Docker Compose
- Default retention: Last 7 days or 100MB per service

### Staging/Production
- **Retention Period**: 30 days for production, 7 days for staging
- **Archival**: Older logs archived to cold storage for compliance
- **Automatic Cleanup**: Configured at platform level

### Manual Cleanup
```bash
# Clear local Docker logs
docker compose down
docker system prune -a --volumes

# Clear application log files
rm -f logs/*.log
```

## Additional Resources

- [Monitoring Documentation](./MONITORING.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)
- [Runbook](./RUNBOOK.md)
