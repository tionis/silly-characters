# Characters

Hosted multi-user character library with Nextcloud as the storage backend.

## Attribution

This project is heavily based on the original
[SillyInnkeeper](https://github.com/dmitryplyaskin/SillyInnkeeper) by
[Dmitry Plyaskin](https://github.com/dmitryplyaskin).

## Stack

- Bun-first monorepo
- `server`: Express + TypeScript API
- `client`: React + Vite frontend
- Nextcloud as source-of-truth for card PNG files (no local mirror)
- SQLite as per-user metadata/index cache
- `apps/*`, `packages/*`: early experimental workspace scaffolding

## Quick Start

1. Copy env file:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
bun install
```

3. Start API and web in parallel:

```bash
bun run dev
```

4. Configure Nextcloud OAuth app:
- Redirect URI must match `NEXTCLOUD_REDIRECT_URI` (for example:
  `http://127.0.0.1:48912/api/auth/callback`)
- Set `NEXTCLOUD_BASE_URL`, `NEXTCLOUD_APP_ID`, `NEXTCLOUD_APP_SECRET` in
  `.env`
- Open the web app and sign in via Nextcloud OAuth

## Scripts

- `dev`: run API and web in parallel
- `dev:api`: run only API
- `dev:web`: run only web client
- `build`: build server and client
- `typecheck`: run TypeScript checks for server and client

## License

Licensed under `AGPL-3.0`, same as the parent/original project.
See [LICENSE](./LICENSE).
