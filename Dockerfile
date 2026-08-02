# syntax=docker/dockerfile:1
# Railway test instance (ADR-0019): build both SPAs, serve them with deploy/server.mjs.
# Node 24 mirrors CI (.github/workflows/ci.yml NODE_VERSION).

FROM node:24-slim AS build
WORKDIR /app

# pnpm pinned to the workspace's packageManager version; plain npm install avoids
# depending on corepack being present in future base images.
RUN npm install -g pnpm@11.12.0

# Workspace postinstall policy lives in pnpm-workspace.yaml (allowBuilds); belt and
# braces against any dependency trying to fetch browsers at install time.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY . .
RUN pnpm install --frozen-lockfile

# Editor at the origin root, player under /player/ — the base MUST match the path
# prefix deploy/server.mjs serves it from.
RUN pnpm -F @w3/editor build \
 && pnpm -F @w3/player exec vite build --base=/player/

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /srv

COPY deploy/server.mjs ./server.mjs
COPY --from=build /app/packages/editor/dist ./editor
COPY --from=build /app/packages/player/dist ./player

USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
