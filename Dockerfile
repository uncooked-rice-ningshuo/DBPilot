FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
ENV DBPILOT_HOST=0.0.0.0 DBPILOT_PORT=3000 DBPILOT_DATA_DIR=/data DBPILOT_SERVE_WEB=1
EXPOSE 3000
CMD ["node", "dist/server/apps/server/src/index.js"]
