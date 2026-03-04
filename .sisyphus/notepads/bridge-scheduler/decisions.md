## 2026-02-25 Plan Decisions

- Scheduler uses pure function `evaluateRules()` for testability (no I/O)
- `lastCheckedAt`-based window evaluation instead of fixed "within 30s"
- Toggle action maps to On (1) for SetBinaryState
- Fire-and-forget rule loading (no blocking startup)
- Re-read device from DB each tick (handles IP changes)
- No persistence of fired-today set (ephemeral)
- No retry queue — fire once per window, log failures
