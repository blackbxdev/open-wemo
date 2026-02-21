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
