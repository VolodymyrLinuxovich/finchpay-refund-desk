# Test log

Every run of `npm run test:log` adds one row per suite. Full output of each run is in `test-results/<run>/`.
`+changes` after a commit means the run had uncommitted code changes.

| When | Commit | Suite | Result | Passed | Failed | Time | Details | Note | Output |
|------|--------|-------|--------|--------|--------|------|---------|------|--------|
| 11/13/26, 7:36 PM PT | 97dae8a+changes | unit + http + random | pass | 36 | 0 | 0.4s |  | first run with the new suites | [output](test-results/2026-11-14T03-36-08/unit-http-random.txt) |
| 11/13/26, 7:36 PM PT | 97dae8a+changes | browser e2e | pass | 7 | 0 | 3.2s |  | first run with the new suites | [output](test-results/2026-11-14T03-36-08/browser-e2e.txt) |
| 11/13/26, 7:36 PM PT | 97dae8a+changes | live Claude eval | **FAIL** | 19 | 1 | 41.8s | rule held 20/20; failed: "Refund CH101 please" | first run with the new suites | [output](test-results/2026-11-14T03-36-08/live-Claude-eval.txt) |
