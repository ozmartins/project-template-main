export DOCKER_BUILDKIT=0

COMPOSE_BASE=docker-compose.yml
COMPOSE_DEV=docker-compose.dev.yml
USE_DEV?=0

ifeq ($(USE_DEV),1)
COMPOSE_FILES=$(COMPOSE_BASE) $(COMPOSE_DEV)
else
COMPOSE_FILES=$(COMPOSE_BASE)
endif

COMPOSE_CMD=docker compose $(foreach file,$(COMPOSE_FILES),-f $(file))

.PHONY: up up-https down reset logs logs-temporal logs-frontend supabase-status test-temporal setup lint certs bootstrap-users

# Install git hooks and dev tooling. Run once after cloning.
setup:
	@command -v lefthook >/dev/null 2>&1 || (echo "Installing lefthook..." && brew install lefthook)
	@command -v gitleaks >/dev/null 2>&1 || (echo "Installing gitleaks..." && brew install gitleaks)
	lefthook install
	cd frontend && npm install
	cd temporal && npm install
	@echo "Setup complete. Git hooks are active."

# Run linters across all TypeScript packages
lint:
	cd frontend && npm run lint
	cd temporal && npm run lint

# `up` starts the full local Supabase stack (Postgres + API/Kong + Auth +
# Storage) via the Supabase CLI, applying migrations and seed, THEN brings up
# Temporal + worker + frontend via docker compose.
# Studio is excluded: it has no authentication — use `make bootstrap-users` instead.
up:
	supabase start --exclude studio
	@eval "$$(./scripts/supabase-env.sh)"; $(COMPOSE_CMD) up -d
	@echo ""
	@echo "Stack up. Frontend http://localhost:3000 | Temporal UI http://localhost:8081"
	@echo "Run 'make bootstrap-users' to create dev users."

# Start stack with HTTPS reverse proxy (Traefik + self-signed cert).
# Run `make up-https` — certs are generated automatically on first run.
up-https:
	supabase start --exclude studio
	@$(MAKE) --no-print-directory certs
	@eval "$$(./scripts/supabase-env.sh)"; \
	  docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d
	@echo ""
	@echo "Stack up (HTTPS). App https://localhost (cert is self-signed — accept the browser warning)"
	@echo "Run 'make bootstrap-users' to create dev users."

# Generate a self-signed TLS certificate for localhost using openssl inside Docker.
# No host tools required. Skips generation if cert already exists.
certs:
	@if [ ! -f certs/local/cert.pem ]; then \
	  echo "Generating self-signed cert for localhost..."; \
	  mkdir -p certs/local; \
	  docker run --rm -v "$$(pwd)/certs/local:/out" alpine/openssl req -x509 -nodes \
	    -newkey rsa:2048 -days 825 \
	    -keyout /out/key.pem -out /out/cert.pem \
	    -subj "/CN=localhost" \
	    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1"; \
	  echo "Cert written to certs/local/."; \
	fi

down:
	$(COMPOSE_CMD) down
	supabase stop

# Full wipe: tear down compose volumes AND the Supabase stack (incl. its DB),
# then recreate everything from scratch (migrations + seed re-applied).
reset:
	$(COMPOSE_CMD) down -v
	-supabase stop --no-backup
	$(MAKE) up

logs:
	$(COMPOSE_CMD) logs -f

logs-temporal:
	$(COMPOSE_CMD) logs -f temporal temporal-worker

logs-frontend:
	$(COMPOSE_CMD) logs -f frontend

# Supabase is CLI-managed, not a compose service -- use this for its status/keys.
supabase-status:
	supabase status

test-temporal:
	cd temporal && npm test

# Create (or reset) local dev users with known credentials and TOTP secrets.
# Requires supabase to be running (`make up` or `supabase start`).
# Prints email, password, and TOTP URI for each user. Re-running resets all credentials.
bootstrap-users:
	@command -v npx >/dev/null 2>&1 || (echo "npx not found — install Node.js" && exit 1)
	cd temporal && npx ts-node --project tsconfig.json ../scripts/bootstrap-users.ts
