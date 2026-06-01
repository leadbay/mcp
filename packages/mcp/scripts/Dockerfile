# MCP telemetry dashboard server (issue #3688).
# Self-contained: only needs the two .ts files + tsx. NO secrets are baked in —
# POSTHOG_PERSONAL_API_KEY / DASHBOARD_USER / DASHBOARD_PASSWORD are provided at
# runtime via Fly secrets.
FROM node:20-slim

WORKDIR /app

# Install deps first for layer caching.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy the generator + server.
COPY posthog-dashboard.ts dashboard-server.ts ./

ENV PORT=8080
EXPOSE 8080

# The server spawns tsx from ./node_modules to run the generator on an interval.
CMD ["node", "node_modules/tsx/dist/cli.mjs", "dashboard-server.ts"]
