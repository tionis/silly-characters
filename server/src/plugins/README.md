# Plugins

This folder contains shared server infrastructure modules.

Current plugins include:

- database initialization/migrations
- scanner/bootstrap helpers (legacy/local mode)

These modules are initialized by the Express app/server bootstrap and expose
cross-cutting services through `app.locals`.
