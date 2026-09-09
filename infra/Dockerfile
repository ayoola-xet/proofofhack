FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS source
WORKDIR /app
RUN npm install --global pnpm@10.32.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN --mount=type=cache,id=proofofhack-pnpm,target=/root/.local/share/pnpm/store pnpm fetch --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
COPY services ./services
COPY tsconfig.json ./
COPY scripts/migrate.ts ./scripts/migrate.ts
COPY infra/container-entry.ts infra/healthcheck.ts ./infra/
RUN --mount=type=cache,id=proofofhack-pnpm,target=/root/.local/share/pnpm/store pnpm install --offline --frozen-lockfile

FROM source AS service
RUN mkdir -p /app/.local/keys
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node", "--import", "tsx", "infra/container-entry.ts"]

FROM source AS web-build
ARG VITE_PRIVY_APP_ID
RUN test -n "$VITE_PRIVY_APP_ID" && pnpm --filter @proofofhack/web build

FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d AS gateway
RUN setcap -r /usr/bin/caddy
COPY --from=web-build /app/apps/web/dist /srv
COPY infra/Caddyfile /etc/caddy/Caddyfile
USER 1000:1000
