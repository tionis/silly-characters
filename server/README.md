# SillyCharacters Server

Express + TypeScript backend for SillyCharacters.

## Responsibilities

- Nextcloud OAuth login/session handling
- Per-user Nextcloud connection management
- Indexing character PNG metadata into SQLite cache
- Card CRUD APIs backed by direct Nextcloud file operations
- User-scoped preferences/filter state and background jobs

## Runtime

Build:

```bash
npm run build
```

Start:

```bash
npm run start
```

The server expects the client build output at `../client/dist`.

## Attribution

This server is heavily based on the original
[SillyInnkeeper](https://github.com/dmitryplyaskin/SillyInnkeeper) codebase by
[Dmitry Plyaskin](https://github.com/dmitryplyaskin).

## License

`AGPL-3.0` (same as upstream SillyInnkeeper). See `../LICENSE`.
