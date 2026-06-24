# Architecture Documentation Template

## Overview
This document describes the high-level system architecture, design decisions, and architectural patterns used in the application.

## System Architecture

### High-Level Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                            │
│                      (React/Next.js)                        │
└────────────┬────────────────────────────────────┬───────────┘
             │                                    │
             │  REST API / GraphQL                │  WebSocket
             │                                    │  (Realtime)
┌────────────▼────────────────────────────────────▼───────────┐
│                      API Gateway / BFF                      │
└────────────┬────────────────────────────────────┬───────────┘
             │                                    │
    ┌────────▼────────┐                  ┌───────▼──────────┐
    │  API Services   │                  │  Supabase        │
    │  (Node.js)      │◄─────────────────┤  - Auth          │
    └────────┬────────┘                  │  - Database      │
             │                           │  - Storage       │
    ┌────────▼────────┐                  │  - Realtime      │
    │  Temporal       │                  └──────────────────┘
    │  - Workflows    │
    │  - Activities   │
    └─────────────────┘
```

### Components

#### Frontend
- **Technology**: React, Next.js, TypeScript
- **State Management**: React Context, TanStack Query
- **Styling**: Tailwind CSS
- **Build Tool**: Next.js with webpack/turbopack

#### Backend API
- **Technology**: Node.js, Express, TypeScript
- **API Style**: RESTful + GraphQL (optional)
- **Authentication**: JWT via Supabase Auth
- **Validation**: Zod or Joi

#### Supabase
- **Database**: PostgreSQL 15+
- **Authentication**: Built-in auth with JWT
- **Storage**: Object storage for files
- **Realtime**: WebSocket subscriptions
- **Edge Functions**: Serverless functions (if used)

#### Temporal
- **Workflows**: Long-running business processes
- **Activities**: Individual tasks within workflows
- **Workers**: Process workflow tasks
- **Schedules**: Cron-like scheduled workflows

### Data Flow

#### User Request Flow
```
1. User → Frontend (React)
2. Frontend → API Gateway
3. API Gateway → Authentication (Supabase Auth)
4. API Gateway → Business Logic (Services)
5. Business Logic → Database (Supabase)
6. Business Logic → Temporal (if async processing needed)
7. Response ← Frontend
```

#### Background Job Flow
```
1. API Service → Temporal (start workflow)
2. Temporal → Worker (execute activities)
3. Worker → External Services (email, payments, etc.)
4. Worker → Database (update status)
5. Worker → Notifications (notify user)
```

## Design Patterns

### Architectural Patterns

#### Layered Architecture
```
┌─────────────────────────────────────┐
│       Presentation Layer            │  Controllers, Routes
├─────────────────────────────────────┤
│       Business Logic Layer          │  Services, Domain Logic
├─────────────────────────────────────┤
│       Data Access Layer             │  Repositories, DAOs
├─────────────────────────────────────┤
│       Database Layer                │  PostgreSQL
└─────────────────────────────────────┘
```

#### Repository Pattern
```typescript
// User repository abstracts database access
interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(user: CreateUserDto): Promise<User>;
  update(id: string, user: UpdateUserDto): Promise<User>;
  delete(id: string): Promise<void>;
}

// Implementation
class SupabaseUserRepository implements UserRepository {
  constructor(private db: SupabaseClient) {}
  
  async findById(id: string): Promise<User | null> {
    const { data, error } = await this.db
      .from('users')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    return data;
  }
  
  // ... other methods
}
```

#### Service Layer Pattern
```typescript
// User service encapsulates business logic
class UserService {
  constructor(
    private userRepo: UserRepository,
    private emailService: EmailService
  ) {}
  
  async createUser(data: CreateUserDto): Promise<User> {
    // Validate
    this.validateUserData(data);
    
    // Check for duplicates
    const existing = await this.userRepo.findByEmail(data.email);
    if (existing) {
      throw new Error('Email already exists');
    }
    
    // Create user
    const user = await this.userRepo.create(data);
    
    // Send welcome email (async)
    await this.emailService.sendWelcomeEmail(user.email);
    
    return user;
  }
}
```

### Application Patterns

#### Dependency Injection
```typescript
// Container setup
const container = {
  userRepository: new SupabaseUserRepository(supabase),
  emailService: new EmailService(config.email),
  userService: null as UserService | null,
};

container.userService = new UserService(
  container.userRepository,
  container.emailService
);

// Usage in controllers
app.post('/users', async (req, res) => {
  const user = await container.userService.createUser(req.body);
  res.status(201).json(user);
});
```

#### Factory Pattern
```typescript
// Create different types of notifications
class NotificationFactory {
  static create(type: string, data: any): Notification {
    switch (type) {
      case 'email':
        return new EmailNotification(data);
      case 'sms':
        return new SMSNotification(data);
      case 'push':
        return new PushNotification(data);
      default:
        throw new Error(`Unknown notification type: ${type}`);
    }
  }
}
```

#### Strategy Pattern
```typescript
// Different payment strategies
interface PaymentStrategy {
  charge(amount: number): Promise<PaymentResult>;
}

class CreditCardPayment implements PaymentStrategy {
  async charge(amount: number): Promise<PaymentResult> {
    // Stripe implementation
  }
}

class PayPalPayment implements PaymentStrategy {
  async charge(amount: number): Promise<PaymentResult> {
    // PayPal implementation
  }
}

class PaymentService {
  constructor(private strategy: PaymentStrategy) {}
  
  async processPayment(amount: number) {
    return await this.strategy.charge(amount);
  }
}
```

## Data Model

### Core Entities
See [DATABASE.md](./DATABASE.md) for detailed schema documentation.

#### Entity Relationships
```
entities (1) ──── (N) entity_versions
entities (1) ──── (N) entity_facts
entities (1) ──── (N) time_series_points
entities (N) ──── (N) entities (via entity_relationships)
```

### Data Modeling Strategy

#### Event Sourcing (Partial)
- `entity_versions` table stores historical snapshots
- Enables time-travel queries
- Supports audit trails

#### Slowly Changing Dimensions (SCD Type 2)
- Track historical changes with `valid_from` and `valid_to`
- `is_current` flag for current version
- Enables point-in-time queries

#### Flexible Schema
- JSONB columns (`metadata`, `data`) for flexible storage
- Strongly typed columns for queryable fields
- Balance between schema flexibility and query performance

## API Design

### RESTful API Principles
- Resource-based URLs: `/api/v1/users`, `/api/v1/entities`
- HTTP methods: GET, POST, PUT, PATCH, DELETE
- Status codes: 200 (OK), 201 (Created), 400 (Bad Request), 404 (Not Found), etc.
- Versioning: `/api/v1/`, `/api/v2/`

### API Response Format
```json
{
  "data": {
    "id": "uuid",
    "name": "Resource Name"
  },
  "meta": {
    "timestamp": "2024-01-01T00:00:00Z"
  }
}
```

### Error Response Format
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": {
      "email": "Invalid email format"
    }
  }
}
```

### Pagination
```json
{
  "data": [...],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "total_pages": 5
  }
}
```

## Security Architecture

### Authentication Flow
```
1. User submits credentials
2. Supabase Auth validates credentials
3. Supabase returns JWT token
4. Client stores token (localStorage/cookie)
5. Client sends token with requests (Authorization: Bearer <token>)
6. API validates token with Supabase
7. API authorizes request based on user roles/permissions
```

### Authorization Model
- **Role-Based Access Control (RBAC)**
- Roles: `user`, `admin`, `super_admin`
- Permissions: `resource:action` (e.g., `users:read`, `users:write`)
- Row-Level Security (RLS) in PostgreSQL

### Security Layers
1. **Network**: HTTPS, firewall rules, VPC
2. **Application**: Input validation, output encoding, rate limiting
3. **Authentication**: JWT tokens, MFA
4. **Authorization**: RBAC, RLS policies
5. **Data**: Encryption at rest and in transit

## Scalability

### Horizontal Scaling
- Stateless API servers (can add more instances)
- Load balancer distributes traffic
- Session state in Redis (if needed)
- Database read replicas for read-heavy workloads

### Vertical Scaling
- Increase CPU/memory for API servers
- Upgrade database instance size
- Optimize queries and add indexes

### Caching Strategy
```
┌─────────┐     ┌─────────┐     ┌──────────┐     ┌──────────┐
│  Client │────▶│   CDN   │────▶│   API    │────▶│ Database │
└─────────┘     └─────────┘     └──────────┘     └──────────┘
                  (Static)        (Redis)       (PostgreSQL)
```

1. **CDN**: Static assets (images, CSS, JS)
2. **Application Cache**: Redis for frequently accessed data
3. **Database Cache**: PostgreSQL query cache, materialized views

### Asynchronous Processing
- Use Temporal workflows for long-running tasks
- Offload heavy computation to workers
- Event-driven architecture for decoupling

## Observability

### Monitoring Stack
- **Metrics**: Prometheus + Grafana
- **Logs**: ELK Stack / Supabase Logs
- **Traces**: OpenTelemetry + Jaeger
- **Alerts**: Alertmanager + PagerDuty

### Key Metrics
- Request rate, error rate, latency (RED method)
- CPU, memory, disk usage (USE method)
- Business metrics (signups, conversions, etc.)

See [MONITORING.md](./MONITORING.md) for details.

## Deployment Architecture

### Infrastructure
- **Container Orchestration**: Kubernetes or Docker Compose
- **Cloud Provider**: AWS, GCP, or Azure
- **Database**: Supabase (managed PostgreSQL)
- **CDN**: CloudFront or Cloud CDN

### Environments
- **Local**: Docker Compose, local Supabase
- **Staging**: Mimics production, separate database
- **Production**: Highly available, auto-scaling

See [DEPLOYMENT.md](./DEPLOYMENT.md) for details.

## Technology Stack

### Frontend
- **Framework**: React 18+ with Next.js 14+
- **Language**: TypeScript 5+
- **Styling**: Tailwind CSS
- **State**: TanStack Query for server state
- **Forms**: React Hook Form + Zod

### Backend
- **Runtime**: Node.js 18+ LTS
- **Framework**: Express.js
- **Language**: TypeScript 5+
- **Database**: PostgreSQL 15+ via Supabase
- **ORM**: Supabase Client / node-postgres
- **Workflow Engine**: Temporal

### DevOps
- **Containerization**: Docker
- **Orchestration**: Kubernetes or Docker Compose
- **CI/CD**: GitHub Actions
- **Monitoring**: Prometheus, Grafana
- **Logging**: ELK Stack

## Architectural Decisions

### ADR (Architecture Decision Records)
See [adrs/](./adrs/) directory for detailed architectural decisions.

#### Key Decisions
1. **Use Supabase**: Managed PostgreSQL with built-in auth and realtime
2. **Use Temporal**: Reliable workflow orchestration for complex processes
3. **Monorepo vs Multi-repo**: Single repository for frontend and backend
4. **REST vs GraphQL**: RESTful API for simplicity
5. **TypeScript**: Type safety across the stack

## Design Principles

### SOLID Principles
- **Single Responsibility**: Each class/module has one responsibility
- **Open/Closed**: Open for extension, closed for modification
- **Liskov Substitution**: Subtypes must be substitutable for base types
- **Interface Segregation**: Many specific interfaces over one general interface
- **Dependency Inversion**: Depend on abstractions, not concretions

### DRY (Don't Repeat Yourself)
- Reusable components and utilities
- Shared type definitions
- Common patterns abstracted

### KISS (Keep It Simple, Stupid)
- Simple solutions over complex ones
- Clear code over clever code
- Straightforward architecture

## Future Considerations

### Potential Improvements
- [ ] Implement GraphQL for flexible queries
- [ ] Add caching layer (Redis)
- [ ] Implement event sourcing fully
- [ ] Add read replicas for database
- [ ] Implement API gateway for microservices
- [ ] Add service mesh for inter-service communication
- [ ] Implement blue-green deployments

### Scalability Roadmap
1. **Phase 1** (Current): Monolithic application
2. **Phase 2**: Add caching and read replicas
3. **Phase 3**: Extract microservices for specific domains
4. **Phase 4**: Event-driven architecture

## Additional Resources

- [Database Documentation](./DATABASE.md)
- [API Documentation](./API.md)
- [Deployment Documentation](./DEPLOYMENT.md)
- [Security Documentation](./SECURITY.md)
- [ADR Directory](./adrs/)

## Diagrams

### Sequence Diagrams
Create sequence diagrams for complex flows:
- User authentication flow
- Payment processing flow
- Order fulfillment workflow

### Component Diagrams
Document component interactions and dependencies.

### Entity Relationship Diagrams
See [DATABASE.md](./DATABASE.md) for ERD.

## References
- [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Twelve-Factor App](https://12factor.net/)
- [Domain-Driven Design](https://martinfowler.com/bliki/DomainDrivenDesign.html)
