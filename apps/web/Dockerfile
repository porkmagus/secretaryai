FROM node:24-bookworm-slim AS deps
WORKDIR /workspace

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/core-runtime/package.json packages/core-runtime/package.json

RUN npm ci

FROM deps AS builder
WORKDIR /workspace
COPY . .

RUN npm run build --workspace @secretary/core-runtime \
  && npm run build --workspace @secretary/web

FROM node:24-bookworm-slim AS runner
WORKDIR /workspace

ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=builder /workspace/package.json ./package.json
COPY --from=builder /workspace/package-lock.json ./package-lock.json
COPY --from=builder /workspace/tsconfig.base.json ./tsconfig.base.json
COPY --from=builder /workspace/apps/web ./apps/web
COPY --from=builder /workspace/packages/core-runtime ./packages/core-runtime

RUN useradd -m -s /bin/bash secretary && chown -R secretary:secretary /workspace
USER secretary

EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=10s --retries=5 --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then((r)=>{if(!r.ok)process.exit(1);}).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "--workspace", "@secretary/web", "--", "--hostname", "0.0.0.0", "--port", "3000"]
