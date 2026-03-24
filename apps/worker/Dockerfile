FROM node:24-bookworm-slim AS deps
WORKDIR /workspace

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/core-runtime/package.json packages/core-runtime/package.json
COPY packages/integrations/package.json packages/integrations/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/observability/package.json packages/observability/package.json

RUN npm ci

FROM deps AS builder
WORKDIR /workspace
COPY . .

RUN npm run build --workspace @secretary/config \
  && npm run build --workspace @secretary/core-runtime \
  && npm run build --workspace @secretary/integrations \
  && npm run build --workspace @secretary/db \
  && npm run build --workspace @secretary/observability \
  && npm run build --workspace @secretary/worker

FROM node:24-bookworm-slim AS runner
WORKDIR /workspace

ENV NODE_ENV=production

COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=builder /workspace/package.json ./package.json
COPY --from=builder /workspace/package-lock.json ./package-lock.json
COPY --from=builder /workspace/tsconfig.base.json ./tsconfig.base.json
COPY --from=builder /workspace/apps/worker ./apps/worker
COPY --from=builder /workspace/packages/config ./packages/config
COPY --from=builder /workspace/packages/core-runtime ./packages/core-runtime
COPY --from=builder /workspace/packages/integrations ./packages/integrations
COPY --from=builder /workspace/packages/db ./packages/db
COPY --from=builder /workspace/packages/observability ./packages/observability

EXPOSE 4000

CMD ["npm", "run", "start", "--workspace", "@secretary/worker"]
