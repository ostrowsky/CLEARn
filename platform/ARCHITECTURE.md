# SOFTskills Platform Architecture

This folder is the new production-ready foundation for the product.

## Goals

- one TypeScript domain model shared by web and mobile
- one React/React Native frontend codebase with Expo for Android, iOS, and web reuse
- stateless API layer that can scale horizontally
- pluggable AI providers for chat, speech-to-text, and text-to-speech
- current low-cost default based on Hugging Face free monthly credits, with direct upgrade paths to paid inference, self-hosted models, or OpenAI

## Monorepo layout

- `apps/client` - Expo Router app for web, Android, and iOS
- `apps/api` - Fastify-based API service in TypeScript
- `packages/domain` - shared content, practice, media, and session types
- `packages/contracts` - shared request and response contracts
- `infra` - local infrastructure for Postgres, Redis, and S3-compatible storage

## Scaling model

The API service is intentionally stateless.

- session state belongs in Redis
- content belongs in Postgres
- uploaded media belongs in S3-compatible object storage
- provider configuration comes from environment variables and secrets
- every instance can serve any request behind a load balancer

## Provider strategy

Default development routing:

- `text` -> Hugging Face
- `speech-to-text` -> Hugging Face
- `text-to-speech` -> Hugging Face

Planned promotion path:

- paid Hugging Face inference for higher limits
- OpenAI for premium chat / TTS / STT flows
- self-hosted open-source models behind OpenAI-compatible APIs for cost control and data residency

## Notes

The existing PowerShell prototype in `../web` is kept intact for immediate manual testing.
This `platform` folder is the migration target for the scalable web/mobile stack.
