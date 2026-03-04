# Learnings — timer-schedules

## 2026-02-21 Session Start
- Plan has 9 tasks across 3 waves
- Wave 1: Tasks 1→2→3→4 (sequential chain)
- Wave 2: Tasks 5+6 (parallel)
- Wave 3: Tasks 7→8→9 (sequential)
- Key constraint: DO NOT modify soap.ts
- Only new dependency: fflate
- All work on feature/timer-schedules branch

## 2026-02-21 Task 1 Findings
- Installed `fflate@0.8.2` in `packages/bridge` via `bun add fflate`; root `bun install` reported no further changes.
- bun:sqlite buffer round-trip works in this environment: create in-memory DB -> `serialize()` -> reopen from serialized `Uint8Array` with `new Database(serialized)` -> query returned inserted row.
- Temporary spike script was created at `packages/bridge/scripts/tmp-sqlite-buffer-spike.ts`, executed successfully, then deleted (not left in repo).
- Bun docs (Context7 `/oven-sh/bun`) document `const contents = db.serialize(); const newdb = Database.deserialize(contents);`; constructor-with-buffer also works in runtime despite docs emphasizing `Database.deserialize`.
- pywemo source verification: `pywemo/ouimeaux_device/api/rules_db.py` defines `DayID` as integer schema field and `pywemo/ouimeaux_device/api/long_press.py` uses `DayID=-1` for daily rules.
- pywemo repository source does not include explicit named constants for per-day bit values (Sun=1..Sat=64); bitmask mapping retained from existing timer research docs and is consistent with community-referenced behavior.
- Gotcha: the current `bun add` operation refreshed workspace lock resolution and surfaced additional listed packages during install output; no extra dependency was intentionally added.

## 2026-02-21 Task 2 Findings
- `Database.deserialize(buffer)` + `db.serialize()` was used for all SQLite CRUD helpers; wrapping DB access in `try/finally` is required to guarantee `db.close()` on every path.
- `unzipSync(zipBytes)` returns a filename-to-`Uint8Array` map; selecting `temppluginRules.db` first and falling back to the first entry handles firmware variance in inner ZIP filenames.
- WeMo `StoreRules` payload requires literal entity-encoded CDATA markers (`&lt;![CDATA[` and `]]&gt;`) in the SOAP body; raw `<![CDATA[` risks malformed envelope handling on device parsers.

## 2026-02-21 Rules Unit Test Findings
- Unit tests for pure `rules.ts` helpers are stable when each DB fixture is created with `createEmptyRulesDb()` and each opened `Database.deserialize(...)` handle is explicitly closed.
- For direct RULEDEVICES fixture inserts, all 18 non-PK columns must be supplied to mirror schema expectations and avoid brittle partial-row assumptions.
- ZIP round-trip validation is straightforward with `zipSync`/`unzipSync` against `temppluginRules.db`, and re-opening the unzipped bytes with `Database.deserialize(...)` confirms payload integrity.

## 2026-02-21 Timer API Routes Task Findings
- Added rules-specific API errors in `packages/bridge/src/server/errors.ts`: `RULES_NOT_SUPPORTED`, `RULES_FETCH_FAILED`, and `RULES_STORE_FAILED` with `RulesNotSupportedError`, `RulesFetchError`, and `RulesStoreError` classes.
- Implemented `packages/bridge/src/server/routes/timers.ts` with five routes mounted under `/api/devices/:id/timers`; route handlers follow existing `devices.ts` helper style (`requireDevice`) and map rule operation failures to typed API errors.
- Route-level validation covers required create payload fields, `startTime` bounds (0-86400), action enum bounds (0/1/2), numeric `ruleId`, and boolean toggle input.
- Server registration updates in `packages/bridge/src/server/index.ts` include route mount and `/api` endpoint listing for all timer CRUD/toggle endpoints.
