# Quiver web

## Railway deployment

Deploy the repository root as the web service and `/services/backend` as the
engine service. Both build from their Dockerfiles. Expose the web service
publicly and set `QUIVER_API_INTERNAL` to the engine's Railway private address
ending in `/v1`, with `QUIVER_RAILWAY_PRIVATE=1` on the web service.

Set `PUBLIC_BASE_URL` to the web HTTPS origin and use that origin for
`CORS_ORIGINS` and `SIWE_ORIGIN` on the engine. Set the Privy application
ID as `NEXT_PUBLIC_PRIVY_APP_ID` on the web service and configure the
corresponding Privy credentials on the engine. Add the web HTTPS origin
to the Privy application's allowed origins.

Reference the Postgres service's private `DATABASE_URL` from the engine.
Mount the Replay volume at `/var/data/quiver` and the web volume at
`/var/data/quiver-web`, with `QUIVER_WEB_DB_PATH=/var/data/quiver-web/preview.sqlite`.
Use one engine replica and allow it to shut down before its replacement
starts so the PostgreSQL writer lock can transfer. The web readiness route
is `/api/health` and the engine readiness route is `/v1/ready`.

Run the engine with `QUIVR_MODE=testnet`, `CHAIN_ID=46630`,
`PRICE_SOURCE=mainnet-readonly` and `QUIVR_MAINNET_ENABLED=false` for
paper trading with observed mainnet prices. Mainnet authorization requires
signed edge location proof, wallet authorization and venue checks.

### Release operations

- The hosted Paper release reports reference and simulated data separately.
  Set `QUIVER_TIINGO_REDISTRIBUTION_LICENSED=true` on the engine and web
  services only when the shared data license permits public redistribution.
  Robinhood Paper can use a verified underlying reference when available.
- The production uptime workflow checks public web readiness, PostgreSQL,
  the Paper driver heartbeat, Privy and the expected execution gate.
  The same check runs locally with `node ops/readiness.mjs`.
- The private database backup job uses `ops/backup/Dockerfile`. Its
  PostgreSQL connection and bucket credentials are Railway references.
  The job restores each archive into a local disposable PostgreSQL instance
  with execution held, then uploads it and verifies the stored checksum.
- To put Railway behind an attesting domain, configure the Worker in
  `ops/railway-edge.wrangler.jsonc` on the production domain. Set its
  `QUIVER_PUBLIC_ORIGIN` and `QUIVER_RAILWAY_ORIGIN`, and install its
  Ed25519 PKCS#8 signing key as a Worker secret. Install the corresponding
  SPKI public key as `QUIVER_EDGE_PUBLIC_KEY` in the engine. Set
  `QUIVER_EXTERNAL_EDGE_ATTESTATION=1` on the web and configure the exact
  public origin in both Railway services and in Privy. Verify
  `originVerified` through that domain and reject direct or forged requests
  before enabling mainnet. Run `ops/check-railway-edge.ts` with the engine's
  tsx loader to test the signature path locally.
- Before enabling real orders, run the read-only Railway preflight through
  both origins. The custom domain must prove the location while the direct
  Railway domain rejects a forged proof.

  ```sh
  node services/backend/scripts/ops/preflight.mjs --railway --profile=paper \
    --site=https://trading.example.com --direct-origin=https://your-web.up.railway.app
  ```

  Check the mainnet engine variables with `--railway --profile=live --env`.
  Set `SOLANA_READ_RPC`, `MAINNET_READONLY_RPC_URL` and the server-only
  `JUPITER_API_KEY`. The Jupiter queue defaults to the free server tier
  cadence with `JUPITER_MIN_INTERVAL_MS=1100`. Lower the interval only if the
  configured plan supports that request rate. After switching profiles, repeat
  the two-origin preflight with `--profile=live` and set the uptime workflow's
  origin and expected execution to the verified site and `paper_and_mainnet`.

## Local development

    npm install
    npm run dev -- -p 4317          # dev
    npx next build && npx next start -p 4317   # prod preview (scripts/restart.sh does this)

- Default mode is mock (`lib/mock.ts`, marked `// MOCK`): no backend calls. Live mode talks to the backend, see below.
- Placeholder motion lives in `src/motion/` (see its README) behind `data-motion` hooks; Ellis owns the final motion. Every page works with motion off.
- Screenshots: `python3 scripts/shots.py <outdir> <width> [reduce] /path:name ...` → `shots/` (gitignored).
- Page map + wireframes: `docs/`.

## Data & motion
- `NEXT_PUBLIC_API_MODE=mock|live` (default mock), `NEXT_PUBLIC_API_BASE` (default /v1). Adapters in lib/api/{mock,live}.ts, all payloads zod-parsed against lib/contracts.
- Motion lives in src/motion (Ellis). Disabled for reduced motion / coarse pointers; every page works without it.
- Dev: `sh scripts/restart.sh` (build + start on :4317).

## Running against a local backend
The backend's CORS is a strict allowlist (api-contracts §17): `CORS_ORIGINS` must list exact origins (scheme + host + port, comma-separated). Wildcards (`*`) make the server refuse to start. Use the web origin exactly as the browser sees it:

    # backend/  (pick your own free port; 8793 belongs to someone else)
    DEV_LOGIN_ENABLED=true CORS_ORIGINS=http://localhost:4317 PORT=8795 QUIVR_DEV_PERSIST=0 npx tsx src/main.ts

    # web/
    NEXT_PUBLIC_API_MODE=live NEXT_PUBLIC_DEV_LOGIN=1 NEXT_PUBLIC_API_BASE=http://localhost:8795/v1 sh scripts/restart.sh

`http://127.0.0.1:4317` is a different origin from `http://localhost:4317`. List both if you use both. See `.env.example` (no secrets). Keep real values in an untracked `.env.local`.

Auth rate limits: `/auth/exchange` and `/auth/refresh` can return 429. The client backs off (it uses Retry-After, otherwise 2s, 4s, 8s, up to 3 retries) and shows a quiet "Retrying in Ns" pill.

### M3.5 backend notes (api-contracts §19)

- **Dev login is off by default.** `NEXT_PUBLIC_DEV_LOGIN=1` only shows the web Sign in button; the backend must also run with `DEV_LOGIN_ENABLED=true` (refused when `NODE_ENV=production` or on mainnet). Without it, Sign in shows an error and screens stay signed out. A preview with dev login on must sit behind HTTP basic auth.
- **Stream tickets are single-use.** `api.streamRun` reads SSE with `fetch` (never native `EventSource`), fetches a new `POST /stream-tickets` ticket on every connect and reconnect, and resumes with `since` + `Last-Event-ID`.
- **Caps.** 429 `limit_exceeded`: 5 active paper runs and 10 open streams per user; streams retry after `retryAfter` (5 s).
- **Assets.** The API sends `Content-Security-Policy: default-src 'none'` and `Cross-Origin-Resource-Policy: same-site`. Never load images, fonts or scripts from the API origin; serve them from `public/`.

## Server-side environment

The hosted preview can suspend its daily AI quotas during development with
`QUIVER_PREVIEW_AI_DAILY_LIMITS_ENABLED=false` in its runtime environment.
This disables the preview's total daily spend cap, shared anonymous spend cap
and per-caller daily call count for drafting, refinement and chart AI. Existing
usage does not need to be reset. Provider charges are still recorded; database
availability, concurrency, token bounds and timeouts remain enforced. Set the
value to `true` or remove it to restore daily limits using the retained usage.
It defaults to enabled and does not change the separate Render backend's limits.

| Variable | Used by | Default | Notes |
|---|---|---|---|
| `QUIVER_API_INTERNAL` | Server-side fetches: `/c/[token]` page, its OG image, `/leaderboard` first render | absolute `NEXT_PUBLIC_API_BASE`, else `http://127.0.0.1:8987/v1` | Must be absolute. Required in spirit when `NEXT_PUBLIC_API_BASE` is relative (`/v1`, VPS proxy). VPS `web-start.bat`: `set QUIVER_API_INTERNAL=http://127.0.0.1:8987/v1` |
| `INTERNAL_PROXY_TOKEN` | Server-side calls only (`proxy.ts` checks for `/u`, `/r`, `/c`; `/r`, `/c`, `/leaderboard` server fetches) send it as `X-Quiver-Internal-Token`, and only when the API base is loopback (`127.0.0.1`/`localhost`) | unset → no header | Server-only secret: never prefix with `NEXT_PUBLIC_`; must match the backend value (≥32 chars). Robin generates it; never commit it. The visitor's `X-Forwarded-For` is never forwarded. `/u/:handle` lookups are cached in-process ~30 s (200/404 only). |
| `PUBLIC_BASE_URL` | `metadataBase` in `app/layout.tsx` → absolute `og:image` / `twitter:image` | unset (Next falls back to localhost) | Set at **build and start** time (static pages read it at build, dynamic ones like `/c/[token]` at runtime). |

## Sign-in and wallet linking (M5.2)

- The sign-in UI reads `GET /v1/auth/config`. Privy (`@privy-io/react-auth`, loaded on demand) shows only when `privy.enabled`; otherwise the dev login (`NEXT_PUBLIC_DEV_LOGIN=1`) is the fallback. A `503 auth_unavailable` from `/auth/exchange` is shown as a calm status.
- `NEXT_PUBLIC_PRIVY_APP_ID` (optional, empty by default) is a fallback for the public app id. Privy secrets (`PRIVY_*`) live only on the backend; see backend docs. Never put them in the web env.
- Chain: Robinhood Chain **testnet 46630** only. No mainnet is configured.
- Wallet link (Wallets page and the "Connect wallet" menu): challenge → `personal_sign` after an explicit click → verify. Unlink asks for confirmation. Max 5 wallets.
