# Build Documentation Template

## Overview
This document describes how to build, test, and deploy the project.

## Prerequisites

### Required Tools
- **Docker Desktop**: Version 20.10+ with Compose v2
- **Node.js**: Version 18+ (LTS recommended)
- **Make**: Command-line build tool
- **Supabase CLI**: For database management (optional for basic development)

### Optional Tools
- **Git**: Version 2.30+
- **pnpm/npm/yarn**: Package manager
- **IDE**: VS Code with recommended extensions

### System Requirements
- **OS**: macOS, Linux, or Windows with WSL2
- **RAM**: 8GB minimum, 16GB recommended
- **Disk Space**: 10GB free space minimum

## Installation

### Clone Repository
```bash
git clone https://github.com/your-org/project-name.git
cd project-name
```

### Install Dependencies
```bash
# Install Node.js dependencies (if applicable)
npm install

# Or using pnpm
pnpm install

# Or using yarn
yarn install
```

### Environment Setup
```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your local configuration
# Required variables:
# - DATABASE_URL
# - SUPABASE_URL
# - SUPABASE_ANON_KEY
# - TEMPORAL_ADDRESS
```

## Building the Project

### Development Build
```bash
# Start all services in development mode
make up

# Or with live-reload enabled
USE_DEV=1 make up
```

### Production Build
```bash
# Build production-ready artifacts
npm run build

# Or using make
make build
```

### Docker Build
```bash
# Build Docker images
docker compose build

# Build specific service
docker compose build frontend
docker compose build worker
```

## Running the Project

### Local Development
```bash
# Start all services
make up

# Access services:
# - Frontend: http://localhost:3000
# - Temporal UI: http://localhost:8080
# - Supabase Studio: http://localhost:54323
# - API: http://localhost:54321
```

### Running Individual Services
```bash
# Frontend only
make logs-frontend

# Temporal worker only
make logs-temporal

# All services
make logs
```

### Database Setup
```bash
# Start Supabase stack (full)
supabase start --config supabase/config.toml

# Reset and apply migrations
supabase db reset --config supabase/config.toml

# Apply migrations only
supabase db push --config supabase/config.toml
```

## Testing

### Running Tests

#### Unit Tests
```bash
# Run all unit tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- path/to/test.spec.ts

# Watch mode for development
npm test -- --watch
```

#### Integration Tests
```bash
# Run integration tests
npm run test:integration

# Run with specific tags
npm run test:integration -- --grep "api"
```

#### End-to-End Tests
```bash
# Run E2E tests
npm run test:e2e

# Run in headed mode (see browser)
npm run test:e2e -- --headed

# Run specific test suite
npm run test:e2e -- tests/auth.spec.ts
```

### Test Coverage
```bash
# Generate coverage report
npm run test:coverage

# View HTML coverage report
open coverage/index.html
```

### Linting and Formatting
```bash
# Run linter
npm run lint

# Fix linting issues automatically
npm run lint:fix

# Check code formatting
npm run format:check

# Format code
npm run format
```

## Building for Production

### Create Production Build
```bash
# Build all services
make build-prod

# Or individual services
npm run build
```

### Optimize Build
```bash
# Run production build with optimizations
NODE_ENV=production npm run build

# Analyze bundle size
npm run build -- --analyze
```

### Docker Production Images
```bash
# Build production Docker images
docker compose -f docker-compose.prod.yml build

# Build and tag for registry
docker build -t your-registry/app:latest .
docker push your-registry/app:latest
```

## Deployment

### Staging Deployment
```bash
# Deploy to staging
make deploy-staging

# Or using deployment script
./scripts/deploy.sh staging
```

### Production Deployment
```bash
# Deploy to production
make deploy-prod

# Or using deployment script
./scripts/deploy.sh production
```

### Database Migrations in Production
```bash
# Apply migrations in production
supabase db push --config supabase/config.toml --db-url $PRODUCTION_DB_URL

# Or using migration script
./scripts/migrate.sh production
```

### Environment-Specific Builds
```bash
# Build for different environments
ENV=staging make build
ENV=production make build

# With environment variables
export NODE_ENV=production
export API_URL=https://api.example.com
make build
```

## CI/CD Pipeline

### GitHub Actions
The project uses GitHub Actions for continuous integration and deployment.

#### Workflows
- **Build and Test**: Runs on every push and pull request
- **Deploy Staging**: Automatically deploys to staging on merge to `develop`
- **Deploy Production**: Deploys to production on merge to `main` (with approval)

#### Triggering Workflows
```bash
# Push to trigger CI
git push origin feature-branch

# Create pull request to trigger full CI/CD
gh pr create --base main --head feature-branch
```

### Local CI Testing
```bash
# Run CI checks locally
make ci

# Or individual steps
make lint
make test
make build
```

## Build Artifacts

### Output Directories
- `dist/`: Production build output
- `build/`: Development build output
- `coverage/`: Test coverage reports
- `.next/`: Next.js build cache (if using Next.js)
- `node_modules/`: Dependencies

### Cleaning Build Artifacts
```bash
# Clean all build artifacts
make clean

# Or manually
rm -rf dist/ build/ coverage/ .next/
```

## Troubleshooting

### Common Build Issues

#### Issue: Dependencies fail to install
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

#### Issue: Docker build fails
```bash
# Clean Docker cache
docker system prune -a

# Rebuild without cache
docker compose build --no-cache
```

#### Issue: Port already in use
```bash
# Find process using port
lsof -i :3000

# Kill process
kill -9 <PID>
```

#### Issue: Out of memory during build
```bash
# Increase Node.js memory limit
NODE_OPTIONS="--max-old-space-size=4096" npm run build
```

### Getting Help
- Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for more issues
- Review build logs: `make logs`
- Check CI/CD pipeline logs in GitHub Actions
- Consult team documentation or create an issue

## Performance Optimization

### Build Performance
- Use build caching in CI/CD
- Enable incremental builds
- Parallelize test execution
- Use Docker layer caching

### Development Experience
- Use watch mode for faster feedback
- Enable hot module replacement (HMR)
- Use development server with live reload
- Optimize IDE configuration

## Additional Resources

- [Architecture Documentation](./ARCHITECTURE.md)
- [Testing Documentation](./TESTING.md)
- [Deployment Documentation](./DEPLOYMENT.md)
- [Contributing Guidelines](../CONTRIBUTING.md)
