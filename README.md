# SillyCharacters

Hosted multi-user character library with Nextcloud OAuth login and Nextcloud-backed card storage.

## Attribution

This project is heavily based on the original
[SillyInnkeeper](https://github.com/dmitryplyaskin/SillyInnkeeper) by
[Dmitry Plyaskin](https://github.com/dmitryplyaskin).

## Architecture

- `server` (Express + TypeScript): API, auth, indexing, metadata cache
- `client` (React + Vite): web UI
- Nextcloud is the source of truth for character PNG files
- SQLite stores per-user metadata, filters/preferences, sessions, and OAuth state

## Requirements

- Node.js 24+
- Bun (recommended for local workspace scripts) or npm for package-local scripts
- A Nextcloud OAuth app

## Configuration

Copy env file and fill required values:

```bash
cp .env.example .env
```

Required variables:

- `SESSION_SECRET`
- `NEXTCLOUD_BASE_URL`
- `NEXTCLOUD_APP_ID`
- `NEXTCLOUD_APP_SECRET`
- `NEXTCLOUD_REDIRECT_URI`

Common runtime variables:

- `SILLYCHARACTERS_HOST` (default `127.0.0.1`)
- `SILLYCHARACTERS_PORT` (default `48912`)
- `WEB_ORIGIN` (used for auth callback redirects)

## Local Development

```bash
bun install
bun run dev
```

Open `http://127.0.0.1:5173` and sign in with Nextcloud.

Useful scripts:

- `bun run dev`
- `bun run dev:api`
- `bun run dev:web`
- `bun run typecheck`
- `bun run build`

## Container

Build:

```bash
docker build -f Containerfile -t sillycharacters:local .
```

Run:

```bash
docker run --rm \
  -p 48912:48912 \
  --env-file .env \
  -v sillycharacters-data:/app/data \
  sillycharacters:local
```

Then open `http://127.0.0.1:48912`.

## Container Publishing CI

A GitHub Actions workflow at `.github/workflows/container.yml` builds and pushes
an image to GHCR on every push to `main`.

Published tags:

- `latest`
- `sha-<commit>`

Image name:

- `ghcr.io/<owner>/<repo>`

## License

Licensed under `AGPL-3.0`, same as the parent/original project.
See [LICENSE](./LICENSE).
