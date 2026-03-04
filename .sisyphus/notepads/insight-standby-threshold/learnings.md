# Learnings

## 2026-02-26 Session Start
- Plan: insight-standby-threshold (4 tasks, sequential)
- Momus-reviewed: OKAY on first pass
- Key patterns verified by 3 explore agents + Metis review

## Wave 2: API Routes (Task 2) — Completed
- TDD RED→GREEN for 3 threshold routes: GET, PUT, POST reset
- 17 tests all passing, zero regressions on full suite
- Mock pattern for route tests: mock.module for db, discovery, insight, device, scheduler BEFORE importing deviceRoutes; create Hono test app with error handler; use app.request() for HTTP assertions
- Fixture data must use WemoDeviceType enum (not string literals) to satisfy strict typing
- The `supportsInsight` mock needs the actual WemoDevice type to satisfy the mock.module replacement
- Hono app.request() returns Response where .json() is typed as unknown — cast with `as ThresholdBody` or `as ErrorBody`
- ValidationError already imported in devices.ts — no new imports needed
- Pre-existing test failures: playwright e2e (missing dep), soap.test.ts (extractNumericValue), threshold.test.ts Wave 1 SOAP-level tests (mock.module not intercepting correctly) — none caused by our changes
