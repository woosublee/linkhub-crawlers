# Quiz Reader Markdown 정답 정규화 보고서

## 상태

- 상태: DONE
- 기준 HEAD: `32c18ff79cf03fea59a41cc05146ad1bed2ff6dc`
- 브랜치: `fix/ppomppu-jina-reader`
- 원격 증거: GitHub Actions dry-run `33188785275` (`quiz.yml`, success)

## Root cause와 실제 Reader 경계

기존 `extractQuizAnswer()`는 `정답` 뒤를 문장부호/줄바꿈까지 정규식으로 캡처하고, 첫 줄과 연속 공백만 정리했다. 이 방식은 Markdown 구조를 해석하지 않아 link/image/emphasis와 뒤 안내 문구를 answer에 섞었고, 반대로 합법적인 내부 마침표가 있는 `4. 15000 P`는 `4`에서 잘랐다.

원격 로그와 2026-08-29 공개 Jina Reader detail body를 대조한 실제 경계는 다음과 같다.

- Hpoint, `coupon:117872`: `정답 : PLAY [* **해피포인트 ...** * 여기를 눌러 ...](...)` — `PLAY` 뒤 Markdown link opener가 경계다.
- KB스타뱅킹, `coupon:117863`: `**정답:**2번 2 ![Image ...](...)` — label의 closing `**`를 제거하고 image opener 앞에서 끝난다.
- 신한쏠야구, `coupon:117862`: `**정답:****디트로이트 타이거스** PS. ...` — 앞의 `****`는 label close `**`와 answer open `**`가 붙은 것이며, answer closing `**` 뒤 prose는 제외한다.
- 신한SOL퀴즈팡팡, `coupon:117861`: `**정답:****보이스피싱, 카드 분실 피해** **정답 입력 전 참고:** ...` — 완결된 answer emphasis 뒤 advisory span은 제외하고 answer 내부 쉼표는 보존한다.

수정 구현은 현재 answer literal이 아니라 marker 주변 label emphasis, answer emphasis의 완결 여부, Markdown link/image/heading/list/footer, 명시적 advisory 경계를 기준으로 동작한다. 신뢰할 수 없는 미완결 emphasis, advisory-only, `정보 없음` 계열은 `null`을 반환한다.

## TDD

### RED

production 수정 전에 실제 Reader 구조 fixture와 regression test를 추가했다.

- 명령: `node --test test/ppomppu-reader.test.js`
- 결과: 23 tests, 17 pass, 6 fail
- 실패: `4. 15000 P`가 `4`로 잘림, Hpoint link fragment 혼입, KB leading `**` 잔존, 신한쏠야구 `PS` 혼입, 퀴즈팡팡 advisory 혼입, advisory-only 오인식

### GREEN

- `node --test test/ppomppu-reader.test.js`: 24 pass, 0 fail
- `node --test test/quiz-crawler.test.js`: 11 pass, 0 fail
- `npm test`: 49 pass, 0 fail
- `node --check crawlers/shared/ppomppu-reader.js`: pass
- `git diff --check`: pass

## Fixture와 테스트

추가한 공개 Reader 최소 fixture:

- `test/fixtures/ppomppu/quiz-hpoint-link-detail.md`
- `test/fixtures/ppomppu/quiz-kb-star-image-detail.md`
- `test/fixtures/ppomppu/quiz-shinhan-baseball-prose-detail.md`
- `test/fixtures/ppomppu/quiz-shinhan-pang-advisory-detail.md`

검증 범위:

- Hpoint `PLAY`
- KB스타뱅킹 `2번 2`
- 신한쏠야구 `디트로이트 타이거스`
- 신한SOL퀴즈팡팡 `보이스피싱, 카드 분실 피해`
- 기존 `정답: 4. 15000 P`
- `*`, `**`, `_` wrapper 제거
- Markdown/advisory negative assertions
- advisory-only, 미완결 emphasis, `정보 없음`의 `null`

## Local Quiz dry-run과 cache

- 명령: `env -u API_SECRET_KEY DRY_RUN=true npm run crawl:quiz`
- cache SHA-256 before: `e65497234b5a710ad503881771568c7a3d448e690b0917f33ee8902aa5e63deb`
- cache SHA-256 after: `e65497234b5a710ad503881771568c7a3d448e690b0917f33ee8902aa5e63deb`
- `[수집실패]`: 없음
- plain-text answers: `Hpoint=PLAY`, `KB스타뱅킹=2번 2`, `신한쏠야구=디트로이트 타이거스`, `신한SOL퀴즈팡팡=보이스피싱, 카드 분실 피해`
- `[DRY_RUN] 전송 데이터`: 동일한 네 plain-text answer만 포함
- 종료 집계: cache 완료 0, 등록 0, DB skip 0; cache hash 불변

## Self-review

- production parser에 현재 네 answer literal을 넣지 않았다.
- 숫자/영문/한글, 내부 공백, 마침표, 쉼표를 보존한다.
- 닫힌 emphasis span은 그 span만 answer로 사용하고, 미완결 span은 추측하지 않는다.
- shared Reader의 board/body/URL/retry 로직과 Quiz category/date/cache/API/workflow 로직은 변경하지 않았다.
- 수정 범위는 허용된 parser, parser test, 공개 fixture, 이 보고서뿐이다.
- 남은 concern: 현재 확인된 Reader Markdown 구조에는 없음. 향후 upstream Markdown 구조가 새 형태로 바뀌면 새 실제 fixture로 회귀 검증이 필요하다.

## Commit

- Message: `Fix Quiz answer Markdown parsing`
- SHA: 이 보고서를 포함하는 `HEAD`; 최종 40자 SHA는 커밋 후 최종 응답에 기록한다.
- Trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`

## Fix Round 1

### 재검토 finding과 root cause

`quiz-answer-re-review.md`의 verified finding 3건을 재현했다.

1. KB스타뱅킹 full Reader tail에는 본문 `추천`/`#### 공유하기` pair 뒤에 별도 `추천 앱 다운로드`가 다시 나타난다. 기존 `extractPostBody()`는 global-last `추천`을 선택해 `태블릿 PC 비교` 이후 footer를 body로 반환했다.
2. marker 앞에서 열린 whole-span emphasis(`*정답: 값*`, `**정답: 값**`, `_정답: 값_`)를 추적하지 않아 complete span은 손상하고 incomplete span은 승인했다. sanitizer도 남은 `_`를 거부하지 않았다.
3. `정답:` marker가 붙은 `댓글에서 확인하세요`, `아래 이미지를 확인하세요`, `링크를 확인하세요`, `아래 내용을 참고하세요`를 answer로 오인했다.

수정 내용:

- `extractPostBody()`는 순서대로 `추천` marker를 찾고, 그 marker 뒤 첫 `#### 공유하기`가 존재하는 첫 pair의 내부만 반환한다. footer 뒤의 두 번째 `추천`은 더 이상 시작점이 아니다.
- KB fixture를 공개 full Reader tail과 재검토에서 확인된 두 번째 `추천 앱 다운로드`/`태블릿 PC 비교`까지 확장했다.
- marker 앞 emphasis는 marker 직후 matching close가 있는 label-only 구조와 answer 끝 matching close가 필요한 whole-span 구조로 구분한다. matching close가 없거나 answer에 `*`/`_`가 남으면 `null`이다.
- advisory candidate는 댓글/이미지/사진/링크/아래/하단/본문/내용 reference와 확인/참고/누르기/보기/입력 action의 조합으로 구조적으로 거부한다. 정상 한글 answer는 그대로 보존한다.

### RED → GREEN

- RED: `node --test test/ppomppu-reader.test.js` → 25 tests, 22 pass, 3 fail
  - KB full Reader body가 `태블릿 PC 비교` footer로 잘못 선택됨
  - whole-span emphasis complete matrix가 `null`/marker 누출
  - marker-bearing advisory-only가 answer로 승인됨
- GREEN: `node --test test/ppomppu-reader.test.js` → 25 pass, 0 fail
- Quiz focused: 11 pass, 0 fail
- NPay focused: 7 pass, 0 fail
- JJizzle focused: 5 pass, 0 fail
- Full: `npm test` → 50 pass, 0 fail
- Syntax: `node --check crawlers/shared/ppomppu-reader.js` → pass
- Diff: `git diff --check` → pass

### 세 crawler local dry-run과 cache

모두 `env -u API_SECRET_KEY DRY_RUN=true`로 실행했고 `[수집실패]`/crawler error/API registration/cache write가 없었다.

- Quiz
  - answers: `Hpoint=PLAY`, `KB스타뱅킹=2번 2`, `신한쏠야구=디트로이트 타이거스`, `신한SOL퀴즈팡팡=보이스피싱, 카드 분실 피해`
  - cache before/after: `e65497234b5a710ad503881771568c7a3d448e690b0917f33ee8902aa5e63deb`
  - 종료: cache 완료 0, 등록 0, DB skip 0
- NPay
  - 10개 게시글의 공개 detail body와 외부 URL을 dry-run 출력
  - cache before/after: `c36056d410f4e0391be8434b477ee7d7989d38f04356ee3e9ee867025ed8911f`
  - 종료: cache 완료 0, URL 등록 0, DB skip 0
- JJizzle
  - phone 30개와 money 30개를 파싱하고 money 신규 후보 1개를 dry-run 출력
  - cache before/after: `ac85ca487d97d55d1bf0743a1828a2acc570f259743645dca19227eb67c05093`
  - 종료: 총 새 등록 0, cache 완료 0, DB skip 0

### Fix Round 1 self-review와 commit

- production source에 현재 answer literal을 hardcode하지 않았다.
- `extractPostBody()` 외 board/URL/retry 로직과 세 crawler category/date/cache/API/workflow 로직은 변경하지 않았다.
- complete emphasis만 승인하고 incomplete/잔여 marker는 거부한다.
- advisory 구조 거부와 정상 한글/영문/숫자/공백/마침표/쉼표 보존을 함께 검증했다.
- 남은 concern: 현재 확인된 공개 Reader 구조에는 없음. upstream 구조 변화는 새 공개 fixture로 검증해야 한다.
- Message: `Fix Reader body and Quiz boundaries`
- SHA: Fix Round 1을 포함하는 새 `HEAD`; 최종 40자 SHA는 커밋 후 최종 응답에 기록한다.
- Trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`
