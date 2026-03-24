# Runtime Storage

This directory stores local runtime artifacts that we want to inspect directly during development.

- `runtime/postgres/data`: live PostgreSQL cluster data for the local compose stack
- `runtime/redis/data`: live Redis persistence data for the local compose stack

These paths are bind-mounted into the local compose stack so storage remains visible from the repo during development.
