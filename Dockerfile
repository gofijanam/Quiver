FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod=false
COPY . .
ARG NEXT_PUBLIC_API_MODE=live
ARG NEXT_PUBLIC_API_BASE=/v1
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG PUBLIC_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build:vps

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build /app/scripts/railway-web-entrypoint.sh /usr/local/bin/railway-web-entrypoint
RUN chmod +x /usr/local/bin/railway-web-entrypoint
ENTRYPOINT ["/usr/local/bin/railway-web-entrypoint"]
CMD ["node", "server.js"]
