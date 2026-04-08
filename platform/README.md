# SOFTskills Platform

This is the shared learner + admin foundation for the product.

## Why this stack

- `TypeScript` everywhere for shared domain contracts
- `Expo + React Native` for maximum web / Android / iOS reuse
- `Fastify` API for a stateless horizontally scalable backend
- provider abstraction for `Hugging Face`, `OpenAI`, and `self-hosted` models

## Recommended rollout

1. Use `platform/` as the shared learner + admin web surface for current previews.
2. Keep `web/` only as the legacy fallback while the migration is being completed.
3. Move persistence from dev filesystem to Postgres/Redis/S3 before production.
4. Promote provider routing from Hugging Face free credits to paid inference or self-hosted/OpenAI as traffic grows.

## Local commands

```bash
pnpm install
pnpm --dir platform dev:api
pnpm --dir platform dev:client
```

## Persisted Hugging Face token

If you want live Hugging Face replies without entering the token before each run, save it once:

```powershell
powershell -ExecutionPolicy Bypass -File .\platform\save-hf-token.ps1
```

This stores `HF_TOKEN` in the Windows user environment. Both `open-share-preview.ps1` and `open-mobile-preview.ps1` load the saved token automatically.

## Preview modes

### Phone on the same Wi-Fi

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\platform\open-mobile-preview.ps1
```

This starts the API with your local LAN IP and opens Expo in mobile preview mode so Expo Go can use the QR code.

### Shareable link for a customer

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\platform\open-share-preview.ps1
```

Or use the Windows wrapper:

```bat
.\start-cloudflare-preview.bat
```

Requirements:
- `cloudflared` must be installed
- the API and Expo windows must stay open while the customer is testing

This script creates:
- a public tunnel for the API
- a public tunnel for the Expo web preview
- a learner URL at `/sections`
- an admin URL at `/admin`
- a summary file saved to [share-preview-links.txt](D:/Projects/SOFTskills/platform/share-preview-links.txt)

## Infrastructure

Use [docker-compose.yml](D:/Projects/SOFTskills/platform/infra/docker-compose.yml) for local Postgres, Redis, and MinIO.
