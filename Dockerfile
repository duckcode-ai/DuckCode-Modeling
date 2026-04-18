# syntax=docker/dockerfile:1.6

FROM node:20-bookworm-slim AS web-build
WORKDIR /app/packages/web-app
COPY packages/web-app/package*.json ./
RUN npm ci
COPY packages/web-app/ ./
RUN npm run build

FROM node:20-bookworm-slim AS api-deps
WORKDIR /app/packages/api-server
COPY packages/api-server/package*.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements.txt
RUN python3 -m venv /app/.venv \
  && /app/.venv/bin/pip install --no-cache-dir --upgrade pip \
  && /app/.venv/bin/pip install --no-cache-dir -r /app/requirements.txt

COPY packages/api-server/ ./packages/api-server/
COPY packages/cli/ ./packages/cli/
COPY packages/core_engine/ ./packages/core_engine/
COPY --from=api-deps /app/packages/api-server/node_modules ./packages/api-server/node_modules
COPY --from=web-build /app/packages/web-app/dist ./packages/web-app/dist
COPY model-examples/ ./model-examples/
COPY schemas/ ./schemas/
COPY dm ./datalex
RUN chmod +x ./datalex

ENV PORT=3001
ENV REPO_ROOT=/app
ENV WEB_DIST=/app/packages/web-app/dist
ENV PATH="/app/.venv/bin:${PATH}"

EXPOSE 3001
WORKDIR /app
CMD ["node", "packages/api-server/index.js"]
