# NaverPay direct registration report

## Root cause and call flow

`/api/links/check` queried all historical rows with a `maybeSingle()` URL lookup. Reused NaverPay URLs with multiple historical rows caused that precheck to return HTTP 500, preventing otherwise valid registration attempts.

- Before: collect Reader body → extract each external URL → `POST /api/links/check` → skip/register based on precheck → cache source only after terminal results.
- After: collect Reader body → extract each external URL → `POST /api/links` directly → treat 2xx as `registered`, HTTP 409 as `duplicate`, and all other HTTP/network outcomes as `failed` → cache canonical source only when every extracted URL is terminal.

The precheck function and its call path were removed. The completion log now reports `총 중복스킵`, which counts only direct-registration 409 outcomes.

## TDD

- RED: `node --test test/ppomppu-naverpay.test.js` failed as expected before the crawler change: source inspection found `/links/check`, and the direct-registration run-level test observed six precheck calls.
- GREEN: the same focused suite passed after the implementation change (9/9).
- The run-level mock covers one all-409 source, a 201+409 source, HTTP 500 and network failures, and a URL after a failure. It verifies direct `/api/links` calls, zero prechecks, canonical cache writes only for terminal sources, registered/duplicate counters, and 1000ms URL plus 3000ms detail pacing.
- Regression coverage verifies URL-less, empty-body, and Reader-failure cache holds; dry-run has zero check/registration/cache writes; missing-secret CLI exit and import no-side-effect behavior remain covered.

## Verification

| Check | Result |
| --- | --- |
| Focused `node --test test/ppomppu-naverpay.test.js` | PASS — 9 tests |
| Full `npm test` | PASS — 53 tests |
| `node --check crawlers/ppomppu-naverpay/crawler.js` | PASS |
| `git diff --check` | PASS |
| Crawler source `/links/check` search | PASS — no match |

## Local dry-run and cache integrity

Command: `env -u API_SECRET_KEY DRY_RUN=true npm run crawl:naverpay`

- Completed successfully without `[수집실패]`.
- Reader collected 10 NaverPay posts and extracted 32 external URLs.
- Dry-run printed payload URLs only; it made no LinkHub check/registration request and made no cache write.
- NaverPay cache SHA-256 before: `90ff3661b24ad6329953a28d5d8992b147b90c97607b77d1fa2f4e8e2745ba21`
- NaverPay cache SHA-256 after:  `90ff3661b24ad6329953a28d5d8992b147b90c97607b77d1fa2f4e8e2745ba21`
- Cache hash is unchanged.

## Self-review and concern

Self-review confirmed the tracked crawler has no `/links/check` route or `checkPostExists` function, direct results cache only when all URLs are `registered` or `duplicate`, and canonical-source caching plus the 1000ms URL/3000ms detail pacing are preserved. The tracked diff is limited to the NaverPay crawler, its test, and this report; no cache JSON or other crawler is included.

No production LinkHub call was made, per the task constraint. The remaining operational dependency is the existing LinkHub `/api/links` contract: it must continue returning HTTP 409 for active/today duplicates. General registration failures deliberately retain the source for a later run.

## Commit

- Message: `Register NaverPay URLs without precheck`
- SHA: recorded in the final task response because a Git commit cannot contain its own final object ID in the committed report content.
