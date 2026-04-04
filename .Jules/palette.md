## 2025-03-27 - [Performance Optimization: Batch Upserts in Drizzle]
**Learning:** Replacing N+1 loops with batched `onConflictDoUpdate` (upsert) operations significantly reduces database round-trips. For entities without unique natural keys (like `integrations`), fetching existing records once and using a Map for ID resolution in memory is an efficient middle ground.
**Action:** Always prefer batched operations over individual queries in loops. When a natural key isn't unique, pre-fetch and map IDs to enable batched upserts.
