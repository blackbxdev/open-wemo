# Decisions — timer-schedules

## 2026-02-21 Task 1
- Keep timer day constants as bitmask values `SUN=1, MON=2, TUE=4, WED=8, THU=16, FRI=32, SAT=64`, with `DAILY=-1`, `WEEKDAYS=62`, `WEEKENDS=65`, `ALL=127`.
- Treat `Database.serialize()` output as valid input for Bun SQLite reopen in implementation planning; prefer `Database.deserialize()` in future production code to align with Bun docs wording.
- Do not implement temp-file workaround for Bun SQLite at this stage because direct buffer reopen is verified working.
