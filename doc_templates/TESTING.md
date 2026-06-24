# Testing Documentation Template

## Overview
This document describes the testing strategy, test types, tools, and best practices for the application.

## Testing Philosophy

### Testing Pyramid
```
        /\
       /  \       E2E Tests (Few)
      /----\      
     /      \     Integration Tests (Some)
    /--------\    
   /          \   Unit Tests (Many)
  /____________\  
```

### Test Coverage Goals
| Test Type | Coverage Goal | Current |
|-----------|---------------|---------|
| Unit Tests | > 80% | [X]% |
| Integration Tests | Critical paths covered | [Y] paths |
| E2E Tests | Happy paths + critical flows | [Z] flows |
| API Tests | All endpoints | [N] endpoints |

## Test Types

### Unit Tests

#### Purpose
Test individual functions, methods, or components in isolation.

#### Characteristics
- Fast (< 1ms per test)
- Isolated (no external dependencies)
- Deterministic (same input → same output)
- Test one thing at a time

#### Example (JavaScript/TypeScript)
```typescript
// user.service.test.ts
import { UserService } from './user.service';
import { mockDatabase } from '../test-utils';

describe('UserService', () => {
  let userService: UserService;
  let db: any;

  beforeEach(() => {
    db = mockDatabase();
    userService = new UserService(db);
  });

  describe('createUser', () => {
    it('should create a user with valid data', async () => {
      const userData = {
        email: 'test@example.com',
        name: 'Test User'
      };

      const user = await userService.createUser(userData);

      expect(user).toMatchObject(userData);
      expect(user.id).toBeDefined();
      expect(user.created_at).toBeDefined();
    });

    it('should throw error for duplicate email', async () => {
      const userData = {
        email: 'existing@example.com',
        name: 'Test User'
      };

      db.users.findByEmail.mockResolvedValue({ id: '123' });

      await expect(userService.createUser(userData))
        .rejects
        .toThrow('Email already exists');
    });

    it('should validate email format', async () => {
      const userData = {
        email: 'invalid-email',
        name: 'Test User'
      };

      await expect(userService.createUser(userData))
        .rejects
        .toThrow('Invalid email format');
    });
  });
});
```

#### Running Unit Tests
```bash
# Run all unit tests
npm test

# Run specific test file
npm test -- user.service.test.ts

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch

# Update snapshots
npm test -- --updateSnapshot
```

### Integration Tests

#### Purpose
Test interactions between multiple components, services, or with external dependencies.

#### Characteristics
- Slower than unit tests (100ms - 1s per test)
- Use real or test databases
- Test API endpoints, database interactions
- Test service integrations

#### Example (API Integration Test)
```typescript
// user.api.test.ts
import { app } from '../app';
import request from 'supertest';
import { setupTestDatabase, teardownTestDatabase } from '../test-utils';

describe('User API', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('POST /api/v1/users', () => {
    it('should create a new user', async () => {
      const userData = {
        email: 'test@example.com',
        name: 'Test User',
        password: 'SecurePassword123!'
      };

      const response = await request(app)
        .post('/api/v1/users')
        .send(userData)
        .expect(201);

      expect(response.body).toMatchObject({
        email: userData.email,
        name: userData.name
      });
      expect(response.body.password).toBeUndefined();
      expect(response.body.id).toBeDefined();
    });

    it('should return 400 for invalid email', async () => {
      const userData = {
        email: 'invalid-email',
        name: 'Test User',
        password: 'SecurePassword123!'
      };

      const response = await request(app)
        .post('/api/v1/users')
        .send(userData)
        .expect(400);

      expect(response.body.error).toBe('Invalid email format');
    });

    it('should return 409 for duplicate email', async () => {
      const userData = {
        email: 'duplicate@example.com',
        name: 'Test User',
        password: 'SecurePassword123!'
      };

      // Create first user
      await request(app)
        .post('/api/v1/users')
        .send(userData)
        .expect(201);

      // Try to create duplicate
      const response = await request(app)
        .post('/api/v1/users')
        .send(userData)
        .expect(409);

      expect(response.body.error).toBe('Email already exists');
    });
  });

  describe('GET /api/v1/users/:id', () => {
    it('should get user by id', async () => {
      // Create user
      const createResponse = await request(app)
        .post('/api/v1/users')
        .send({
          email: 'test2@example.com',
          name: 'Test User 2',
          password: 'SecurePassword123!'
        });

      const userId = createResponse.body.id;

      // Get user
      const response = await request(app)
        .get(`/api/v1/users/${userId}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: userId,
        email: 'test2@example.com',
        name: 'Test User 2'
      });
    });

    it('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .get('/api/v1/users/00000000-0000-0000-0000-000000000000')
        .expect(404);

      expect(response.body.error).toBe('User not found');
    });
  });
});
```

#### Running Integration Tests
```bash
# Run integration tests
npm run test:integration

# Run specific test suite
npm run test:integration -- user.api.test.ts

# Run with database setup
docker compose up -d postgres
npm run test:integration
docker compose down
```

### End-to-End (E2E) Tests

#### Purpose
Test complete user flows through the application from the user's perspective.

#### Characteristics
- Slowest tests (1s - 10s per test)
- Use real browser (Playwright, Cypress)
- Test critical user journeys
- Run against deployed environment

#### Example (Playwright)
```typescript
// user-signup.e2e.test.ts
import { test, expect } from '@playwright/test';

test.describe('User Signup Flow', () => {
  test('should allow new user to sign up', async ({ page }) => {
    // Navigate to signup page
    await page.goto('https://example.com/signup');

    // Fill in signup form
    await page.fill('input[name="email"]', 'newuser@example.com');
    await page.fill('input[name="name"]', 'New User');
    await page.fill('input[name="password"]', 'SecurePassword123!');
    await page.fill('input[name="confirmPassword"]', 'SecurePassword123!');

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL('**/dashboard');

    // Verify user is logged in
    await expect(page.locator('text=Welcome, New User')).toBeVisible();
  });

  test('should show error for invalid email', async ({ page }) => {
    await page.goto('https://example.com/signup');

    await page.fill('input[name="email"]', 'invalid-email');
    await page.fill('input[name="name"]', 'Test User');
    await page.fill('input[name="password"]', 'SecurePassword123!');
    await page.fill('input[name="confirmPassword"]', 'SecurePassword123!');

    await page.click('button[type="submit"]');

    await expect(page.locator('text=Invalid email format')).toBeVisible();
  });

  test('should show error when passwords do not match', async ({ page }) => {
    await page.goto('https://example.com/signup');

    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="name"]', 'Test User');
    await page.fill('input[name="password"]', 'SecurePassword123!');
    await page.fill('input[name="confirmPassword"]', 'DifferentPassword123!');

    await page.click('button[type="submit"]');

    await expect(page.locator('text=Passwords do not match')).toBeVisible();
  });
});

test.describe('User Login Flow', () => {
  test('should allow existing user to login', async ({ page }) => {
    await page.goto('https://example.com/login');

    await page.fill('input[name="email"]', 'existing@example.com');
    await page.fill('input[name="password"]', 'ExistingPassword123!');

    await page.click('button[type="submit"]');

    await page.waitForURL('**/dashboard');

    await expect(page.locator('text=Welcome back')).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('https://example.com/login');

    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'WrongPassword123!');

    await page.click('button[type="submit"]');

    await expect(page.locator('text=Invalid email or password')).toBeVisible();
  });
});
```

#### Running E2E Tests
```bash
# Run E2E tests
npm run test:e2e

# Run in headed mode (see browser)
npm run test:e2e -- --headed

# Run specific test
npm run test:e2e -- user-signup.e2e.test.ts

# Run against specific environment
npm run test:e2e -- --base-url=https://staging.example.com

# Debug mode
npm run test:e2e -- --debug
```

### Database Tests

#### Purpose
Test database operations, migrations, and data integrity.

#### Example (Migration Test)
```typescript
// migrations.test.ts
import { setupTestDatabase, runMigrations } from '../test-utils';

describe('Database Migrations', () => {
  it('should apply all migrations successfully', async () => {
    const db = await setupTestDatabase();
    
    await expect(runMigrations(db)).resolves.not.toThrow();
    
    // Verify tables exist
    const tables = await db.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
    `);
    
    expect(tables.rows.map(r => r.tablename)).toContain('users');
    expect(tables.rows.map(r => r.tablename)).toContain('entities');
  });

  it('should create proper indexes', async () => {
    const db = await setupTestDatabase();
    await runMigrations(db);
    
    const indexes = await db.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
    `);
    
    expect(indexes.rows.map(r => r.indexname)).toContain('idx_users_email');
  });
});
```

### Performance Tests

#### Purpose
Test application performance under load.

#### Example (k6 Load Test)
See [PERFORMANCE.md](./PERFORMANCE.md) for detailed performance testing.

## Test Organization

### Directory Structure
```
tests/
├── unit/                   # Unit tests
│   ├── services/
│   ├── utils/
│   └── models/
├── integration/            # Integration tests
│   ├── api/
│   └── database/
├── e2e/                    # End-to-end tests
│   ├── user-flows/
│   └── admin-flows/
├── performance/            # Performance tests
│   └── load-tests/
├── fixtures/               # Test data
│   └── users.json
└── utils/                  # Test utilities
    ├── setup.ts
    └── mocks.ts
```

### Naming Conventions
- Test files: `*.test.ts` or `*.spec.ts`
- E2E tests: `*.e2e.test.ts`
- Test suites: Use `describe()` blocks
- Test cases: Use `it()` or `test()`
- Descriptive names: "should [expected behavior] when [condition]"

## Test Utilities

### Test Database Setup
```typescript
// test-utils/database.ts
import { Pool } from 'pg';

let testDb: Pool;

export async function setupTestDatabase(): Promise<Pool> {
  testDb = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
  });

  // Run migrations
  await runMigrations(testDb);

  return testDb;
}

export async function teardownTestDatabase(): Promise<void> {
  // Clean up
  await testDb.query('DROP SCHEMA public CASCADE');
  await testDb.query('CREATE SCHEMA public');
  await testDb.end();
}

export async function clearDatabase(): Promise<void> {
  const tables = await testDb.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
  `);

  for (const { tablename } of tables.rows) {
    await testDb.query(`TRUNCATE TABLE ${tablename} CASCADE`);
  }
}
```

### Mock Data
```typescript
// test-utils/fixtures.ts
export const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
  name: 'Test User',
  created_at: new Date('2024-01-01'),
  updated_at: new Date('2024-01-01'),
};

export const mockUsers = [
  mockUser,
  {
    id: 'user-456',
    email: 'test2@example.com',
    name: 'Test User 2',
    created_at: new Date('2024-01-02'),
    updated_at: new Date('2024-01-02'),
  },
];

export function createMockUser(overrides = {}) {
  return {
    ...mockUser,
    id: Math.random().toString(36).substr(2, 9),
    ...overrides,
  };
}
```

### Mocking External Services
```typescript
// test-utils/mocks.ts
import { jest } from '@jest/globals';

export function mockEmailService() {
  return {
    sendEmail: jest.fn().mockResolvedValue({ success: true }),
    sendBulkEmail: jest.fn().mockResolvedValue({ success: true }),
  };
}

export function mockPaymentService() {
  return {
    charge: jest.fn().mockResolvedValue({ id: 'charge-123', status: 'succeeded' }),
    refund: jest.fn().mockResolvedValue({ id: 'refund-123', status: 'succeeded' }),
  };
}
```

## Testing Best Practices

### General Principles
1. **AAA Pattern**: Arrange, Act, Assert
2. **One assertion per test** (when possible)
3. **Test behavior, not implementation**
4. **Independent tests**: No test should depend on another
5. **Deterministic**: Same input → same output
6. **Fast feedback**: Unit tests should be fast
7. **Readable**: Clear test names and structure

### Test Writing Guidelines

#### Good Test
```typescript
describe('calculateDiscount', () => {
  it('should apply 10% discount for orders over $100', () => {
    // Arrange
    const order = { total: 150 };
    
    // Act
    const discount = calculateDiscount(order);
    
    // Assert
    expect(discount).toBe(15);
  });
});
```

#### Bad Test
```typescript
describe('calculateDiscount', () => {
  it('should work', () => {
    expect(calculateDiscount({ total: 150 })).toBe(15);
    expect(calculateDiscount({ total: 50 })).toBe(0);
    expect(calculateDiscount({ total: 200 })).toBe(20);
  });
});
```

### Avoid Test Flakiness
- Don't use `setTimeout` or fixed delays
- Use proper waits for async operations
- Don't depend on external state
- Clear database between tests
- Use test isolation
- Mock time-dependent code

### Test Coverage
```bash
# Generate coverage report
npm test -- --coverage

# Coverage thresholds in package.json
{
  "jest": {
    "coverageThresholds": {
      "global": {
        "branches": 80,
        "functions": 80,
        "lines": 80,
        "statements": 80
      }
    }
  }
}
```

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run unit tests
        run: npm test -- --coverage
        
      - name: Run integration tests
        run: npm run test:integration
        env:
          TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
          
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        
      - name: Run E2E tests
        run: npm run test:e2e
        env:
          BASE_URL: http://localhost:3000
```

## Test Maintenance

### Regular Tasks
- [ ] Review and update tests with code changes
- [ ] Remove obsolete tests
- [ ] Refactor duplicated test code
- [ ] Update test data and fixtures
- [ ] Review test coverage reports
- [ ] Fix flaky tests
- [ ] Update testing documentation

### When to Update Tests
- After fixing bugs (add regression test)
- When adding new features
- When refactoring code
- When tests fail unexpectedly
- When coverage drops

## Troubleshooting Tests

### Common Issues

#### Tests timing out
```typescript
// Increase timeout for specific test
test('slow operation', async () => {
  // ...
}, 10000); // 10 seconds

// Or in beforeAll
beforeAll(async () => {
  // ...
}, 30000); // 30 seconds
```

#### Database tests failing
```bash
# Ensure test database is clean
npm run test:db:reset

# Check database connection
psql $TEST_DATABASE_URL -c "SELECT 1;"
```

#### E2E tests failing
```bash
# Run in headed mode to see what's happening
npm run test:e2e -- --headed

# Take screenshots on failure (Playwright)
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== 'passed') {
    await page.screenshot({ path: `screenshots/${testInfo.title}.png` });
  }
});
```

## Additional Resources

- [Build Documentation](./BUILD.md)
- [Architecture Documentation](./ARCHITECTURE.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)

## References
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Playwright Documentation](https://playwright.dev/)
- [Testing Best Practices](https://testingjavascript.com/)
