# Ppomppu Jina Reader final fix report

## 결과

- 상태: `DONE_WITH_CONCERNS`
- 최종 commit message: `Fix final Ppomppu Reader review defects`
- Commit SHA: 이 보고서를 포함하는 최종 commit의 SHA이며 자기 참조 특성상 파일 내부에 고정할 수 없어 최종 응답과 `git rev-parse HEAD`로 기록한다.

## Finding별 root cause와 수정

### 1. malformed Reader 2xx 및 빈 board 결과

- Root cause: `fetchReaderMarkdown()`가 모든 2xx body를 검증 없이 반환했고, `fetchBoardPosts()`가 parse 0건을 정상 `[]`로 반환했다.
- 수정:
  - body가 비어 있지 않은 문자열인지 확인한다.
  - `URL Source:`와 `Markdown Content:` 경계 및 순서를 확인한다.
  - 요청 URL과 Reader `URL Source`를 Ppomppu host, path, 정렬된 query 기준으로 비교하되 Jina의 `http` canonicalization과 `www` 차이는 허용한다.
  - 구조 검증 실패를 기존 bounded retry/backoff 안에서 재시도한다.
  - board parse 0건은 기본 실패로 만들고, JJizzle 검색만 `{ allowEmpty: true }`로 유효한 빈 결과를 허용한다.
  - 상세 fixture를 실제 Reader metadata/Markdown 구조로 보강했다.

### 2. NaverPay missing secret CLI exit status

- Root cause: direct CLI의 `run().catch()`가 오류를 출력했지만 `process.exitCode`를 설정하지 않았다.
- 수정: Quiz/JJizzle과 동일하게 CLI catch에서 `process.exitCode = 1`을 설정했다. import guard는 유지했다.

### 3. NaverPay DB duplicate terminal cache

- Root cause: DB check가 source post URL에 한 번만 적용되고 외부 URL outcome에는 반영되지 않아, 외부 URL의 확정 duplicate를 terminal 결과로 집계할 수 없었다.
- 수정:
  - 각 외부 URL마다 DB check를 수행한다.
  - DB duplicate는 `'duplicate'`, DB check 오류는 `'failed'`, 등록 성공/409/실패는 기존 outcome으로 집계한다.
  - 모든 외부 URL이 `registered` 또는 `duplicate`일 때만 canonical source URL을 cache한다.
  - DB check 오류, 등록 실패, URL 없음, 빈 본문은 cache하지 않는다.

### 4. JJizzle canonical Desktop URL

- Root cause: canonical URL을 계산한 뒤에도 local duplicate, DB check, registration, cache에서 `normalizedUrl`을 사용해 Reader의 `http` scheme이 실제 동작에 전파될 수 있었다.
- 수정: exclusion 검사에만 기존 normalized 원본을 사용하고, local duplicate/post key, DB check, registration payload, terminal cache에는 모두 canonical Desktop `https` URL을 사용한다.

### 5. Quiz API 오류 로그 sanitization

- Root cause: 일반 registration 오류에서 `error.response.data` 전체 object를 출력했다.
- 수정:
  - raw response body와 일반 `error.message`를 출력하지 않는다.
  - response가 있으면 status와 primitive string인 `code`/`message`만 제어문자 제거 및 200자 제한 후 기록한다.
  - response가 없으면 안전한 일반 실패 메시지만 기록한다.

### 6. bare URL trailing punctuation

- Root cause: bare URL 정규식이 문장 끝 `.`, `,`, `;`, `:`, `!`, `?` 등의 punctuation을 URL 일부로 포함할 수 있었다.
- 수정:
  - bare URL 끝의 일반 문장 punctuation과 닫는 quote/bracket을 제거한다.
  - Markdown link target 범위를 별도로 추적해 명시적 target은 수정하지 않는다.
  - percent encoding, Ppomppu redirect decode, decoded internal-host filtering은 유지한다.

### 7. Quiz batch cache/dry-run 전이

- Root cause: success/409, 일반 failure, DB duplicate, dry-run, import side-effect 전이가 run-level 회귀 테스트로 충분히 고정되지 않았다.
- 수정: 각 전이를 실제 `run()` 경로로 검증하는 테스트를 추가했다. 기존 동작인 success/409 batch cache, failure 보류, DB duplicate canonical cache와 `lastRegistered`, unrelated DB-check failure 격리 정책은 유지했다.

### 8. Reader detail pacing

- Root cause: NaverPay와 Quiz의 detail 처리 후 기본 간격이 2000ms이고 sleep 주입 지점이 없었다.
- 수정: 두 crawler에 production 기본 `3000ms` detail delay와 injectable `wait`/`detailDelayMs`를 추가했다. retry backoff는 변경하지 않았고 JJizzle에는 불필요한 per-post delay를 추가하지 않았다.

## TDD RED/GREEN

### RED

초기 focused 통합 실행 결과: **41 tests 중 27 pass, 14 fail**.

기존 구현에서 실패한 핵심 assertion:

- Reader: malformed 2xx rejection 없음, 구조 오류 retry 없음, unrelated/mismatched `URL Source` rejection 없음, 기본 empty board rejection 없음, `allowEmpty`의 malformed rejection 없음.
- URL 추출: bare URL의 마침표/쉼표와 percent-encoded bare URL 뒤 마침표가 남음.
- NaverPay: external URL 대신 source URL을 DB check함, terminal cache 기대 불일치, injectable 3000ms pacing 호출 없음, missing-secret CLI가 exit 0.
- JJizzle: `http` URL이 DB check/API/cache로 전달됨, 검색 fetch에 `allowEmpty` 정책이 전달되지 않음.
- Quiz: injectable 3000ms pacing 호출 없음, sanitized batch registration function/export 및 안전 로그 없음.

Quiz의 기존 batch 409 cache, 일반 batch failure 보류, DB duplicate cache/`lastRegistered`, import guard 테스트는 RED 단계부터 통과해 기존 정책 보존을 확인했다.

### GREEN

- `node --test test/ppomppu-reader.test.js`: **18/18 pass**
- `node --test test/ppomppu-naverpay.test.js`: **7/7 pass**
- `node --test test/quiz-crawler.test.js`: **11/11 pass**
- `node --test test/ppomppu-jjizzle.test.js`: **5/5 pass**

추가/보강한 회귀 범위:

- Reader metadata/source/empty policy와 bounded retry
- bare URL punctuation 및 Markdown target/percent encoding 보존
- NaverPay DB duplicate, registered+409, DB check/registration failure, dry-run, pacing, CLI/import
- Quiz 409/failure/dry-run/DB duplicate/로그 sanitization/pacing/import
- JJizzle `http` 입력의 canonical DB/API/cache와 `allowEmpty`

## 전체 검증

- `npm test`: **43/43 pass**
- `node --check crawlers/shared/ppomppu-reader.js`: pass
- `node --check crawlers/ppomppu-naverpay/crawler.js`: pass
- `node --check crawlers/quiz/crawler.js`: pass
- `node --check crawlers/ppomppu-jjizzle/crawler.js`: pass
- `git diff --check`: pass

## Local dry-run 및 cache hash

### SHA-256 before/after

| Cache | Before | After |
|---|---|---|
| `crawlers/ppomppu-naverpay/crawled_posts.json` | `c36056d410f4e0391be8434b477ee7d7989d38f04356ee3e9ee867025ed8911f` | `c36056d410f4e0391be8434b477ee7d7989d38f04356ee3e9ee867025ed8911f` |
| `crawlers/quiz/crawled_quiz_posts.json` | `e65497234b5a710ad503881771568c7a3d448e690b0917f33ee8902aa5e63deb` | `e65497234b5a710ad503881771568c7a3d448e690b0917f33ee8902aa5e63deb` |
| `crawlers/ppomppu-jjizzle/crawled_posts.json` | `ac85ca487d97d55d1bf0743a1828a2acc570f259743645dca19227eb67c05093` | `ac85ca487d97d55d1bf0743a1828a2acc570f259743645dca19227eb67c05093` |

세 cache 모두 dry-run 전후 hash가 동일했다.

### `DRY_RUN=true npm run crawl:naverpay`

- Reader 목록에서 NaverPay post **10건** 파싱.
- 각 상세 body를 실제 수집했고 외부 URL **32개**를 `[DRY_RUN]` payload로 출력.
- DB check, registration, cache write 없음.
- `[수집실패]` 없음. Reader retry 발생 없음.

### `DRY_RUN=true npm run crawl:quiz`

- Reader 목록에서 quiz post **6건** 파싱.
- 날짜/카테고리 정책 후 상세 **4건**의 answer를 수집하고 통합 `[DRY_RUN] 전송 데이터`를 출력.
- DB check, registration, cache write 없음.
- `[수집실패]` 없음. Reader retry 발생 없음.

### `DRY_RUN=true npm run crawl:jjizzle`

- phone **30건**, money **30건** 파싱.
- 기존 cache로 59건을 local duplicate 처리하고 money 신규 후보 1건의 canonical `https` payload를 출력.
- DB check, registration, cache write 없음.
- `[수집실패]` 없음. Reader retry 발생 없음.

## Self-review

- retry/backoff, cache tolerance header, request/wait dependency injection 계약을 보존했다.
- Puppeteer를 추가하지 않았다.
- malformed Reader/개별 수집 실패는 caller의 `[수집실패]` 정책으로 처리되고 schedule 자체를 의도적으로 실패시키지 않는다.
- non-dry missing secret만 설정 오류로 non-zero 종료한다.
- dry-run은 실제 Reader 수집/파싱/payload 구성 후 API/cache side effect를 만들지 않는다.
- canonical source URL과 post key 정책, Quiz 6개 category/KST 정책, JJizzle title/description/thumbnail 및 exclusion 정책을 보존했다.
- 사용자 소유 미추적 파일은 읽거나 수정하거나 stage하지 않았다.

## 남은 concern

라이브 Quiz dry-run에서 현재 정답 정규식이 일부 게시글의 Markdown 강조/부가 문구까지 answer에 포함했다. 이는 이번 brief가 보존하도록 한 기존 answer 추출 정책의 범위 밖이므로 변경하지 않았으며 후속 parser 개선 대상으로 남긴다.
