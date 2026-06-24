# Troubleshooting

Common issues and fixes for local development. Each entry follows **Symptom → Cause → Fix**.

---

## Docker / `make up` Issues

### Supabase port already in use (54321, 54322, 54323)

- **Symptom:** `supabase start` fails with `bind: address already in use` on port 54321, 54322, or 54323.
- **Cause:** A previous Supabase instance did not stop cleanly, or another service has claimed the port.
- **Fix:**
  ```bash
  supabase stop        # stop any running Supabase processes
  make down            # stop Compose services
  lsof -i :54321       # identify the conflicting process
  kill -9 <PID>        # terminate it, then re-run make up
  ```

### `supabase start` fails — Docker Desktop not running

- **Symptom:** `Error: Cannot connect to the Docker daemon` when running `make up`.
- **Cause:** Docker Desktop is not started (or the Docker socket is unavailable).
- **Fix:** Open Docker Desktop and wait for it to report "running", then retry `make up`.

### Worker cannot reach `host.docker.internal:54321`

- **Symptom:** Temporal worker logs show `Connection refused` or `getaddrinfo ENOTFOUND host.docker.internal`.
- **Cause:** The worker container failed to resolve `host.docker.internal`, which is pre-configured in `docker-compose.yml` via `extra_hosts: ["host.docker.internal:host-gateway"]`. This can fail if the container was started before Docker fully initialised, or if the compose file was modified.
- **Fix:** Confirm the entry is present in `docker-compose.yml` under the `temporal-worker` service, then recreate the container:
  ```bash
  grep "host.docker.internal" docker-compose.yml   # should show host-gateway entry
  docker compose up -d --force-recreate temporal-worker
  docker compose logs -f temporal-worker            # confirm SUPABASE_URL resolves
  ```

---

## MFA / First Login

### TOTP code rejected — clock drift

- **Symptom:** Login succeeds but the MFA step rejects every 6-digit code with `Invalid TOTP code`.
- **Cause:** The system clock on the device running the authenticator app is skewed more than ±30 seconds from UTC.
- **Fix:** Sync your device clock (macOS: *System Settings → General → Date & Time → Set automatically*; Linux: `sudo timedatectl set-ntp true`). If the problem recurs inside a Docker container, restart Docker Desktop to resync the VM clock.

### Lost TOTP secret — cannot log in

- **Symptom:** The authenticator app was reset, lost, or reinstalled and the TOTP URI is no longer available.
- **Cause:** The TOTP factor is stored in Supabase; the URI is only printed once at enrollment time.
- **Fix:** Re-run `make bootstrap-users` to reset all dev credentials and re-enrol TOTP. The command prints a fresh TOTP URI and the current 6-digit code for each account.

---

## HTTPS / Traefik (`make up-https`)

### Browser shows a certificate error on first visit

- **Symptom:** Chrome/Edge shows *Your connection is not private*, Firefox shows *Warning: Potential Security Risk*.
- **Cause:** `make certs` generates a self-signed certificate; browsers do not trust it by default.
- **Fix:** This is expected. Click through the one-time browser warning:
  - **Chrome/Edge:** *Advanced → Proceed to localhost (unsafe)*
  - **Firefox:** *Advanced → Accept the Risk and Continue*
  - **Safari:** *Show Details → visit this website*

  The warning will not reappear until the cert is regenerated. For a fully trusted cert, install mkcert and run:
  ```bash
  brew install mkcert && mkcert -install
  mkcert -cert-file certs/local/cert.pem -key-file certs/local/key.pem localhost 127.0.0.1 ::1
  ```

### `make certs` fails

- **Symptom:** `make certs` errors out with `docker: command not found` or `Cannot connect to the Docker daemon`.
- **Cause:** `make certs` uses `alpine/openssl` inside a Docker container — Docker must be running; no host-level tools (e.g. mkcert, openssl) are required.
- **Fix:** Ensure Docker Desktop is running (`docker info`), then retry `make certs`. To regenerate an existing cert, delete `certs/local/` first:
  ```bash
  rm -rf certs/local/
  make certs
  ```

---

## Temporal

### Worker not connecting — namespace or task queue mismatch

- **Symptom:** Workflows queue but never start; Temporal UI shows the task queue with zero pollers.
- **Cause:** The worker's `TEMPORAL_NAMESPACE` or `TEMPORAL_TASK_QUEUE` environment variable does not match the value used when starting workflows.
- **Fix:** Check `.env.temporal` and `docker-compose.yml` for consistent values. The default template (`.env.temporal.example`) uses `10x-stack-dev` (namespace) and `10x-stack-dev-main` (task queue) to mirror dev K8s. For classic local naming, set `.env.temporal` to `default` / `main`. Restart the worker after any change:
  ```bash
  docker compose restart temporal-worker
  docker compose logs -f temporal-worker   # confirm "Worker started" message
  ```

### Temporal UI blank — worker not started

- **Symptom:** The Temporal UI at `http://localhost:8081` loads but shows no workflows or namespaces.
- **Cause:** The `temporal-worker` container exited or was never started (often after a partial `make up`).
- **Fix:**
  ```bash
  docker compose ps                        # verify temporal-worker is running
  docker compose logs temporal-worker      # inspect startup errors
  docker compose up -d temporal-worker     # restart if stopped
  ```

---

## CI / GitHub Actions

### `action_required` stuck on a Copilot PR

- **Symptom:** A Copilot coding-agent PR stays at `action_required`; CI does not start even after pushing new commits.
- **Cause:** GitHub gates same-repository Copilot PR workflows until a trusted actor triggers a re-run.
- **Fix:** First, run **Actions → PR - Trusted rerun for Copilot gate** with the affected pull request number. The workflow re-runs every `action_required` `pull_request` run for that PR head SHA using a trusted maintainer-triggered `GITHUB_TOKEN`.
  - If the backstop workflow reports **no matched runs**, confirm you entered the right PR number and that the blocked runs are on the current head SHA.
  - If the re-run starts normally, record the first non-`action_required` run ID on the issue/PR so the incident has closure evidence.
  - If new same-repo Copilot PR runs keep landing in `action_required` after successful trusted reruns, escalate to a repository/org maintainer to change the GitHub Actions approval settings. The workflow is only a governed backstop, not the root-cause settings fix.

### Missing secrets (`COPILOT_TOKEN`, `PROJECT_MANAGER_PAT`) — workflows pass but do nothing

- **Symptom:** All pipeline workflow runs show green but no labels are applied, no Copilot assignments happen, and no PRs are opened.
- **Cause:** The factory agents exit early when the required tokens are absent (`"COPILOT_GITHUB_TOKEN not set — skipping"`).
- **Fix:** Set the two required secrets on the repository:
  ```bash
  gh secret set COPILOT_TOKEN --repo <org>/<repo>
  gh secret set PROJECT_MANAGER_PAT --repo <org>/<repo>
  ```
  See the [GitHub Factory Setup](../README.md#github-factory-setup) section in `README.md` for the required token scopes.
