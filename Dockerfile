# syntax=docker/dockerfile:1
FROM node:24.20.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/application-ports/package.json packages/application-ports/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/fixtures/package.json packages/fixtures/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/audio-client/package.json packages/audio-client/package.json
COPY infra/package.json infra/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @devday/api build
RUN pnpm --filter @devday/api deploy --prod --legacy /runtime
RUN mkdir -p /runtime/certs && node --input-type=module -e "import {writeFile} from 'node:fs/promises'; const r=await fetch('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem'); if(!r.ok) throw new Error('RDS CA download failed'); await writeFile('/runtime/certs/global-bundle.pem',await r.text());"

FROM node:24.20.0-bookworm-slim AS runtime
ENV NODE_ENV=production API_HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /runtime /app/apps/api
COPY --from=build --chown=node:node /runtime/certs /app/certs
COPY --chown=node:node pnpm-workspace.yaml /app/pnpm-workspace.yaml
RUN mkdir -p /app/.local/media && chown -R node:node /app/.local
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
