# EpcProcurement

Production-quality prototype for vertical industrial procurement intelligence in pipeline, oil & gas, EPC, and industrial procurement markets.

## Cloud demo

See [Free cloud demo setup](docs/demo-cloud-setup.md) for Render, Neon, Resend and the single-inbox email flow. `render.yaml` configures a Free Node Web Service; `pnpm start:cloud` applies the MVP database migrations before starting the server. Do not commit API keys or local database files.

## Stack

- Next.js, React, TypeScript, Tailwind CSS
- Managed auth, PostgreSQL, RLS-ready migrations
- Replaceable search, extraction, AI, and trade-intelligence provider adapters

## Quick Start

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `.env.local` and fill credentials when available. Without database tables, the app uses a local fallback so the interface remains testable during setup.

## Architecture

The app is split into modules under `src/modules`:

- `auth`
- `companies`
- `discovery`
- `sources`
- `ai`
- `signals`
- `scoring`
- `trade`
- `dashboard`
- `jobs`

Shared contracts live in `src/types`. External APIs are behind provider interfaces so the data stack can be replaced without touching UI code.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
```
