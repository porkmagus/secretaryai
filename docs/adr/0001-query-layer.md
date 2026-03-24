# ADR 0001: Query Layer for Phase 1

## Status

Accepted

## Context

The project needs a database/query layer that is type-safe enough for a TypeScript monorepo, migration-friendly, and practical for PostgreSQL plus `pgvector`.

## Decision

Use **Drizzle ORM** with PostgreSQL for the initial query and migration layer.

## Why

- keeps schema close to TypeScript without hiding SQL too aggressively
- stays lightweight for a self-hosted single-user system
- supports a gradual path from scaffold to explicit production queries
- works well with custom SQL where `pgvector` needs lower-level control

## Consequences

- the `@secretary/db` package will own schema and migration definitions
- early migrations should remain simple and explicit
- advanced vector and extension-specific pieces may still use raw SQL helpers

## Revisit Trigger

Revisit this decision only if:
- migration ergonomics become a consistent pain point
- `pgvector` support proves too awkward for the needed retrieval model
- the repo moves toward a very different persistence strategy
