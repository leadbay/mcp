# MCP telemetry dashboard server (issue #3688).
# Self-contained: only needs the two .ts files. NO secrets are baked in —
# POSTHOG_PERSONAL_API_KEY / DASHBOARD_USER / DASHBOARD_PASSWORD are provided at
# runtime via Fly secrets.
#
# The TS is compiled to plain JS at BUILD time (esbuild), so the running
# container never invokes tsx/esbuild. That keeps steady-state memory flat —
# the per-refresh tsx JIT compile was what OOM-killed the 256MB machine.
FROM node:20-slim

WORKDIR /app

# Build deps (esbuild + tsx) — used only to compile, not at runtime.
COPY package.json ./
RUN npm install --no-audit --no-fund

# Compile both entrypoints to ESM JS bundles in ./dist.
COPY posthog-dashboard.ts dashboard-server.ts ./
RUN node_modules/.bin/esbuild posthog-dashboard.ts dashboard-server.ts \
      --bundle --platform=node --format=esm --target=node20 \
      --packages=external --outdir=dist \
  # Prune build-only deps to shrink the image; nothing is needed at runtime.
  && npm prune --omit=dev || true

ENV PORT=8080
EXPOSE 8080

# Run the compiled server with plain node — no tsx, no per-refresh compile.
CMD ["node", "dist/dashboard-server.js"]
