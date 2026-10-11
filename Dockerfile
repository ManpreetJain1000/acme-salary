# Single image running the API (internal :4000) and Next.js (public $PORT).
# The browser only reaches Next; Next proxies /api/* to the API on localhost.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace api && npm run build --workspace web \
 && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_PATH=/app/data/acme.db SEED_ON_BOOT=true \
    API_URL=http://127.0.0.1:4000 CORS_ORIGIN=http://localhost:3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/package.json /app/apps/web/next.config.mjs ./apps/web/
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY scripts/start.sh ./scripts/start.sh
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
CMD ["sh", "scripts/start.sh"]
