FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN VITE_SUPABASE_URL=__VITE_SUPABASE_URL__ \
  VITE_API_URL=__VITE_API_URL__ \
  VITE_SUPABASE_ANON_KEY=__VITE_SUPABASE_ANON_KEY__ \
  npm run build

FROM node:22-alpine AS dev
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]

FROM nginx:alpine AS runtime

# Upgrade all Alpine packages to get the latest security patches; fixes
# OS-level CVEs that Trivy detects in the base image.  This step is
# intentionally placed before COPY so layer caching still works for the
# content layers below.
RUN apk upgrade -U --no-cache

COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.sh /docker/entrypoint.sh

RUN apk update && apk upgrade --no-cache \
  && chmod +x /docker/entrypoint.sh \
  && sed -i 's|/run/nginx.pid|/tmp/nginx.pid|' /etc/nginx/nginx.conf \
  && mkdir -p /tmp/frontend-dist \
  && chown -R nginx:nginx /usr/share/nginx/html /docker /var/cache/nginx /var/run /tmp/frontend-dist \
  && rm -rf /var/cache/apk/*

ENV DIST_SRC_DIR=/usr/share/nginx/html
ENV DIST_DIR=/tmp/frontend-dist

EXPOSE 8080
USER nginx
ENTRYPOINT ["/docker/entrypoint.sh"]
