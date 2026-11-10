# Single production image: the bundled Hono API, which also serves the built React app.
# The runtime stage holds only Node, one bundled JS file and the static web build (no node_modules).

FROM node:26-slim AS build
RUN npm install -g pnpm@12.18.0
WORKDIR /app

# Install dependencies first so this layer is cached until a manifest or the lockfile changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter "@picks/api..." --filter "@picks/web..."

COPY . .
RUN pnpm --filter @picks/web build && pnpm --filter @picks/api build

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
ENV WEB_DIST_DIR=/app/web
WORKDIR /app
COPY --from=build /app/apps/api/dist ./api
COPY --from=build /app/apps/web/dist ./web
USER node
EXPOSE 8787
CMD ["node", "--enable-source-maps", "api/index.js"]
