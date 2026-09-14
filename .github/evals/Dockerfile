# Generic agent sandbox and format validators. No case or product code is copied.
FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/validation \
    && /opt/validation/bin/pip install --no-cache-dir PyYAML==6.0.2 jsonschema==4.23.0 \
    && npm install --global @anthropic-ai/claude-code@2.1.247
ENV PATH="/opt/validation/bin:${PATH}"
USER node
WORKDIR /scratch
