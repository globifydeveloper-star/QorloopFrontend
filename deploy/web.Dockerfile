# Static build of the web app, served by Caddy on :80 inside each client's stack. The edge proxy terminates HTTPS
# and sends /api to that client's API on the same host, so one build serves every client.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV VITE_REAL_UPLOADS=true \
    VITE_REAL_CATALOGUE=true \
    VITE_REAL_PRICING=true \
    VITE_REAL_RECON=true \
    VITE_REAL_FILES=true \
    VITE_REAL_SETTINGS=true \
    VITE_REAL_ONBOARDING=true \
    VITE_REAL_MARKETPLACE_VALUES=true \
    VITE_API_BASE_URL=
RUN npm run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=$GIT_SHA
EXPOSE 80
