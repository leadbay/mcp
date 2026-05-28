# syntax=docker/dockerfile:1.7
# Multi-stage build for the self-hosted Leadbay MCP HTTP server.
#
# Stage 1 (builder): install full monorepo dev deps, build core + promptforge
#   + mcp, then copy only the bundled dist/ + production deps into the runner.
# Stage 2 (runner):  Node 22 slim, runs `dist/http-server.js` on $PORT.
#
# Build context = repo root (the leadclaw monorepo).
# Build:  docker build -t leadbay-mcp .
# Run:    docker run --rm -p 8080:8080 leadbay-mcp

ARG NODE_VERSION=22.12.0

# ---------- Stage 1: builder ----------
FROM node:${NODE_VERSION}-slim AS builder

WORKDIR /repo

# pnpm via corepack — pinned to the version in packageManager (if set) or
# falls back to a known-good 10.x.
RUN npm install -g pnpm@10.30.3

# Copy lockfile + workspace manifests first so `pnpm install` can be cached
# across source-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/promptforge/package.json packages/promptforge/
COPY packages/mcp/package.json packages/mcp/
COPY packages/leadclaw/package.json packages/leadclaw/
COPY packages/dxt/package.json packages/dxt/

# Install everything needed to build the mcp package. Skip leadclaw + dxt —
# they're not on the runtime path for the HTTP server.
RUN pnpm install --frozen-lockfile \
  --filter @leadbay/core... \
  --filter @leadbay/promptforge... \
  --filter @leadbay/mcp...

# Copy sources (after install so source edits don't bust the install cache).
COPY packages/core packages/core
COPY packages/promptforge packages/promptforge
COPY packages/mcp packages/mcp

# Build core first so its dist/ exists when tsup resolves @leadbay/core.
# mcp's prebuild script handles @leadbay/promptforge.
RUN pnpm --filter @leadbay/core build
RUN pnpm --filter @leadbay/mcp build

# Emit a stripped runtime package.json that npm (in the runner) can install
# without choking on workspace: refs. Drops devDependencies entirely (they
# carry the @leadbay/core workspace ref) and keeps only what http-server.js
# actually imports at runtime.
RUN node -e "const p=require('./packages/mcp/package.json'); \
  const out={name:p.name,version:p.version,type:p.type,dependencies:p.dependencies}; \
  require('fs').writeFileSync('/repo/runtime-package.json', JSON.stringify(out,null,2));"

# ---------- Stage 2: runner ----------
FROM node:${NODE_VERSION}-slim AS runner

WORKDIR /app

COPY --from=builder /repo/runtime-package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=builder /repo/packages/mcp/dist ./dist

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# Node handles SIGTERM/SIGINT correctly — no tini needed (no shell, no child
# processes that would need reaping).
CMD ["node", "dist/http-server.js"]
