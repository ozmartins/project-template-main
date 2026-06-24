FROM node:22-slim AS builder

WORKDIR /app

ENV NODE_ENV=production \
  NPM_CONFIG_FETCH_RETRIES=5 \
  NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
  NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=10000 \
  NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production \
  NPM_CONFIG_FETCH_RETRIES=5 \
  NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
  NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=10000 \
  NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000

# Upgrade all Debian packages to get the latest security patches.
# This layer is independent of package.json and only re-runs when the
# base image changes, so it does not invalidate the npm install layer.
RUN apt-get update -y \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && rm package-lock.json \
  # Remove npm from the runtime image: the CMD is `node dist/worker.js` and
  # never uses npm at runtime. Removing npm also eliminates CVEs bundled
  # with the npm package (e.g. picomatch in npm's own node_modules).
  # Remove the npm cache as well: Trivy scans /root/.npm and older cached
  # tarballs may contain vulnerable package metadata.
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && rm -rf /root/.npm

COPY --from=builder /app/dist ./dist

EXPOSE 3001

USER node

CMD ["node", "dist/worker.js"]
