# Decisions

## 2026-02-26 Planning Phase
- TDD approach (user choice)
- Number input with stepper, not slider (user choice)
- Separate threshold.test.ts file to avoid polluting existing pure-function insight.test.ts with mock.module()
- Use extractNumericValue() not extractTextValue() for SOAP numeric responses
- Confirm-after-reset pattern: resetPowerThreshold() then getPowerThreshold() to return truth
- Pre-populate threshold UI from existing /insight response (no extra fetch)
- PUT for set threshold (spec says PUT; semantically correct for idempotent replacement)
