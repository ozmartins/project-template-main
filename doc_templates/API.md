# API Documentation Template

## Overview
Provide a high-level description of the API, its purpose, and main functionality.

## Base URL
```
Production: https://api.example.com
Staging: https://staging-api.example.com
Development: http://localhost:PORT
```

## Authentication
Describe the authentication mechanism used by the API.

### Authentication Methods
- **JWT Bearer Token**: Used for authenticated requests
- **API Key**: Used for service-to-service communication
- **OAuth 2.0**: Used for third-party integrations

### Example
```http
Authorization: Bearer <your-jwt-token>
```

## Rate Limiting
- Rate limit: X requests per minute
- Rate limit headers:
  - `X-RateLimit-Limit`: Maximum requests allowed
  - `X-RateLimit-Remaining`: Remaining requests
  - `X-RateLimit-Reset`: Time when the rate limit resets

## Endpoints

### Resource Name

#### List Resources
```http
GET /api/v1/resources
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| page | integer | No | Page number (default: 1) |
| limit | integer | No | Items per page (default: 20, max: 100) |
| sort | string | No | Sort field and direction (e.g., "created_at:desc") |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Resource Name",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "total_pages": 5
  }
}
```

#### Get Resource
```http
GET /api/v1/resources/:id
```

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| id | string | Yes | Resource UUID |

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "Resource Name",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  }
}
```

#### Create Resource
```http
POST /api/v1/resources
```

**Request Body:**
```json
{
  "name": "Resource Name",
  "description": "Optional description"
}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "Resource Name",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  }
}
```

#### Update Resource
```http
PUT /api/v1/resources/:id
PATCH /api/v1/resources/:id
```

**Request Body:**
```json
{
  "name": "Updated Resource Name"
}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "Updated Resource Name",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  }
}
```

#### Delete Resource
```http
DELETE /api/v1/resources/:id
```

**Response:**
```json
{
  "message": "Resource deleted successfully"
}
```

## Error Responses

### Error Format
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "field": "Additional context about the error"
    }
  }
}
```

### Common Error Codes
| Status Code | Error Code | Description |
|-------------|------------|-------------|
| 400 | BAD_REQUEST | Invalid request parameters |
| 401 | UNAUTHORIZED | Missing or invalid authentication |
| 403 | FORBIDDEN | Insufficient permissions |
| 404 | NOT_FOUND | Resource not found |
| 409 | CONFLICT | Resource conflict (e.g., duplicate) |
| 422 | VALIDATION_ERROR | Request validation failed |
| 429 | RATE_LIMIT_EXCEEDED | Too many requests |
| 500 | INTERNAL_ERROR | Internal server error |
| 503 | SERVICE_UNAVAILABLE | Service temporarily unavailable |

## Webhooks
If applicable, document webhook endpoints and payloads.

### Webhook Events
- `resource.created`
- `resource.updated`
- `resource.deleted`

### Webhook Payload
```json
{
  "event": "resource.created",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "id": "uuid",
    "name": "Resource Name"
  }
}
```

## SDKs and Client Libraries
List available SDKs and client libraries for different programming languages.

- JavaScript/TypeScript: [Link to SDK]
- Python: [Link to SDK]
- Go: [Link to SDK]

## Changelog
Document API version changes and deprecations.

### Version 1.0.0 (2024-01-01)
- Initial API release
