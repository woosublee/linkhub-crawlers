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
