# Deployment Runbook

This project now supports a packaged always-on deployment topology built around:

- `proxy`: Caddy reverse proxy with automatic HTTPS when `SECRETARY_PUBLIC_HOST` resolves publicly
- `web`: Next.js app
- `worker`: Fastify runtime
- `stt`: faster-whisper speech-to-text service
- `tts`: Chatterbox text-to-speech service
- `postgres`: pgvector-backed PostgreSQL
- `redis`: Redis

## 1. Prepare the deployment env file

1. Copy [`.env.deploy.example`](../../.env.deploy.example) to `.env.deploy`
2. Set:
   - `APP_BASE_URL=https://your-public-host`
   - `WORKER_BASE_URL=http://worker:4000`
   - `DATABASE_URL=postgres://postgres:...@postgres:5432/secretary`
   - `REDIS_URL=redis://redis:6379`
   - `STT_BASE_URL=http://stt:5001`
   - `TTS_BASE_URL=http://tts:5002`
   - `TELEGRAM_WEBHOOK_URL=https://your-public-host/integrations/telegram/webhook`
   - `SECRETARY_PUBLIC_HOST=your-public-host`
   - `CADDY_EMAIL=you@example.com`
3. Set a strong `APP_AUTH_PASSWORD`
4. Set a long random `APP_SESSION_SECRET`
5. Keep all secrets only in `.env.deploy`

## 2. Prepare storage

Run:

```powershell
npm run storage:prepare
```

Visible runtime paths used by the deployment stack:

- `runtime/postgres/data`
- `runtime/redis/data`
- `runtime/speech`
- `runtime/caddy/data`
- `runtime/caddy/config`
- `runtime/backups`
- `runtime/exports`

## 3. Bring the deployment stack up

Run:

```powershell
npm run deploy:up
```

That starts:

- `postgres`
- `redis`
- `stt`
- `tts`
- `worker`
- `web`
- `proxy`

## 4. Apply migrations

Run once after first boot, and again after schema changes:

```powershell
npm run deploy:migrate
```

## 5. Check the running stack

Useful commands:

```powershell
npm run deploy:config
npm run deploy:logs
npm run deploy:down
```

Public traffic should land on Caddy:

- app UI and web-facing APIs: proxied to `web`
- Telegram webhook: proxied directly to `worker` at `/integrations/telegram/webhook`

## 6. Telegram

For stable inbound Telegram:

- point DNS for `SECRETARY_PUBLIC_HOST` at the deployment machine
- keep ports `80` and `443` reachable to Caddy
- keep `TELEGRAM_WEBHOOK_URL` aligned with the public host
- after the stack is healthy, sync the webhook from `/channels`

## 7. Operational guidance

- use `runtime/backups` and `runtime/exports` as operator-visible working folders
- run `npm run backup:create` before risky upgrades or imports
- keep Postgres and Redis on the bind-mounted runtime paths if you want visible local state
- if you want GPU speech later, that should be a follow-up deployment variant, not a silent change to this CPU-first baseline
