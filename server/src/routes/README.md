# Routes

Express route modules for API and root endpoints.

Guidelines:

- keep route modules focused by domain (`cards`, `auth`, `tags`, etc.)
- keep request parsing/response shape in routes
- keep data/business logic in `server/src/services`
- use shared error helpers for consistent API error responses

Most routes are mounted under `/api` in `server/src/app.ts`.
