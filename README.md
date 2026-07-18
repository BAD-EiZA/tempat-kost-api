# Tempat Kost — API

NestJS REST API (`/v1`) untuk platform SaaS manajemen kos multi-property.

## Stack

- NestJS + TypeScript
- Prisma + PostgreSQL (Supabase)
- Clerk auth
- Cloudinary files
- Gemini 3.5 Flash (AI adapter)
- Midtrans (Phase 2)

## Setup

1. Copy env:

```bash
cp .env.example .env
```

2. Isi semua nilai di `.env` (lihat root `ENV.md`).

3. Install & generate Prisma client:

```bash
npm install
npm run prisma:generate
```

4. Migrasi (butuh `DATABASE_URL` + `DIRECT_URL` valid):

```bash
npm run prisma:migrate
```

5. Dev server:

```bash
npm run start:dev
```

- Health: `GET http://localhost:4000/health`
- Docs: `http://localhost:4000/docs`
- Auth me: `GET /v1/auth/me` (Bearer Clerk session JWT)

## Scripts

| Command | Keterangan |
|---|---|
| `npm run start:dev` | Watch mode |
| `npm run build` | Compile |
| `npm run prisma:generate` | Generate client |
| `npm run prisma:migrate` | Dev migration |
| `npm run prisma:deploy` | Prod migrate |

## Phase 0 endpoints

- `GET /health`
- `GET /v1/auth/me`
- `GET /v1/workspaces`
- `POST /v1/workspaces`
- `POST /v1/files/signed-upload`
- `GET /v1/internal/cron/ping` (header `x-cron-secret`)
