# Ppomppu Jina Reader Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Actions에서 nginx 403으로 중단된 네이버페이·퀴즈·쥐즐 크롤러를 검증된 Jina Reader 기반 수집으로 전환한다.

**Architecture:** `crawlers/shared/ppomppu-reader.js`가 Jina Reader 요청, Markdown 목록 파싱, 상세 본문 분리, redirect URL 복원, 퀴즈 정답 추출을 담당한다. 세 크롤러는 공통 게시글 모델과 `boardId:postNo` 중복 키를 사용하며, 성공 또는 확정 중복만 캐시에 기록한다. 각 워크플로는 `workflow_dispatch`의 `dry_run` 입력으로 실제 GitHub Actions 환경에서 API·캐시 변경 없이 검증할 수 있다.

**Tech Stack:** Node.js 20, CommonJS, Axios, Node 내장 `node:test`, GitHub Actions, Jina Reader API

**Spec:** `docs/superpowers/specs/2026-08-28-ppomppu-jina-reader-design.md`

## Global Constraints

- 기존 LinkHub API endpoint와 payload 형식을 변경하지 않는다.
- 기존 네이버페이 태그 `NPay적립`, 퀴즈 태그 `퀴즈`, 쥐즐 description 형식을 유지한다.
- 퀴즈 카테고리는 현재 6개를 그대로 유지한다.
- Reader 무인증 한도 20 RPM을 넘지 않도록 상세 요청 사이에 최소 1.5초 간격을 둔다.
- 목록 요청은 `X-Cache-Tolerance: 60`, 상세 요청은 `X-Cache-Tolerance: 300`을 사용한다.
- `429`, `500`, `502`, `503`, `504`, 네트워크 오류만 재시도하며 간격은 0초, 2초, 5초, 10초다.
- 수집·본문 파싱·API 등록의 일시 실패는 source 게시글 캐시에 기록하지 않는다.
- Reader 실패를 실제 신규 글 없음과 구분하되 반복 스케줄이므로 워크플로를 의도적으로 실패시키지 않는다.
- 사용자 소유의 미추적 파일 `.claude/`, `check_duplicates.js`, `npay_similar_duplicates_20260309.md`는 수정하거나 커밋하지 않는다.
- 원격 push, 실제 API 호출 워크플로 실행, 원격 브랜치 삭제는 해당 체크포인트에서 별도 확인 후 수행한다.

## File Map

- Create: `crawlers/shared/ppomppu-reader.js` — Reader 요청, 파싱, 본문·URL·정답 추출, 게시글 키
- Create: `crawlers/shared/registration-outcome.js` — 등록 결과의 캐시 가능 여부 판단
- Create: `test/fixtures/ppomppu/coupon-list.md` — 쿠폰게시판 목록 최소 fixture
- Create: `test/fixtures/ppomppu/naverpay-detail.md` — 네이버페이 상세 최소 fixture
- Create: `test/fixtures/ppomppu/quiz-detail.md` — 퀴즈 상세 최소 fixture
- Create: `test/fixtures/ppomppu/jjizzle-list.md` — 쥐즐 검색 목록 최소 fixture
- Create: `test/ppomppu-reader.test.js` — 공통 파서와 Reader 재시도 테스트
- Create: `test/registration-outcome.test.js` — 캐시 정책 테스트
- Modify: `package.json` — Node test runner 스크립트
- Modify: `crawlers/ppomppu-naverpay/crawler.js` — Reader 기반 목록·상세 수집과 캐시 정책
- Modify: `crawlers/quiz/crawler.js` — Reader 기반 목록·상세 수집과 Puppeteer 제거
- Modify: `crawlers/ppomppu-jjizzle/crawler.js` — Reader 기반 검색 목록 수집과 캐시 정책
- Modify: `.github/workflows/ppomppu-naverpay.yml` — `dry_run` 입력과 commit 단계 보호
- Modify: `.github/workflows/quiz.yml` — `dry_run` 입력과 commit 단계 보호
- Modify: `.github/workflows/ppomppu-jjizzle.yml` — `dry_run` 입력과 commit 단계 보호

---

### Task 1: 공통 Markdown 파서와 게시글 키

**Files:**
- Create: `crawlers/shared/ppomppu-reader.js`
- Create: `test/fixtures/ppomppu/coupon-list.md`
- Create: `test/fixtures/ppomppu/naverpay-detail.md`
- Create: `test/fixtures/ppomppu/quiz-detail.md`
- Create: `test/fixtures/ppomppu/jjizzle-list.md`
- Create: `test/ppomppu-reader.test.js`
- Modify: `package.json:6-10`

**Interfaces:**
- Produces: `parseBoardPosts(markdown, boardId) -> Array<{boardId, postNo, title, url}>`
- Produces: `extractPostBody(markdown) -> string`
- Produces: `decodePpomppuTarget(url) -> string`
- Produces: `extractExternalUrls(body) -> string[]`
- Produces: `extractQuizAnswer(body) -> {answer, fullContent} | null`
- Produces: `getPostKey(url) -> string | null`
- Produces: `toCanonicalPostUrl(boardId, postNo) -> string`

- [ ] **Step 1: 테스트 스크립트를 Node test runner로 변경**

`package.json`의 `scripts.test`를 다음으로 변경한다.

```json
"test": "node --test test/*.test.js"
```

- [ ] **Step 2: 최소 공개 fixture 작성**

`test/fixtures/ppomppu/coupon-list.md`에 실제 Reader 형식을 축소해 저장한다.

```markdown
Title: 뽐뿌 - 쿠폰게시판

Markdown Content:
117849![Image 1: 이미지](https://cdn2.ppomppu.co.kr/images/icon_04.png)[_[네이버페이]_ 쇼핑라이브 오후 일정](https://www.ppomppu.co.kr/zboard/view.php?id=coupon&page=1&divpage=21&no=117849)[Shampoo](http://www.ppomppu.co.kr/zboard/zboard.php?id=coupon#)
117841![Image 2: 이미지](https://cdn2.ppomppu.co.kr/images/icon_04.png)[[KB Pay] 오늘의 퀴즈 8/28일자 정답](https://www.ppomppu.co.kr/zboard/view.php?id=coupon&page=1&divpage=21&no=117841)[Shampoo](http://www.ppomppu.co.kr/zboard/zboard.php?id=coupon#)
```

`test/fixtures/ppomppu/naverpay-detail.md`:

```markdown
# [네이버페이] 마이카 혜택 방문

추천 _1_[공유하기](http://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=117847)

본문 [https://mycar.naver.com/?from=push1](https://s.ppomppu.co.kr/?idno=coupon_117847&target=aHR0cHM6Ly9teWNhci5uYXZlci5jb20vP2Zyb209cHVzaDE=&encode=on)

#### 공유하기
```

`test/fixtures/ppomppu/quiz-detail.md`:

```markdown
# [신한슈퍼SOL] 출석 퀴즈 정답 8/28

추천 _1_[공유하기](http://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=117834)

정답: 4. 15000 P

#### 공유하기
```

`test/fixtures/ppomppu/jjizzle-list.md`:

```markdown
3932385[핀다 2970원 창 띄워놓으신 분들은 개통됩니다.](https://www.ppomppu.co.kr/zboard/view.php?id=phone&page=1&divpage=710&search_type=name&keyword=%C1%E3%C1%F1&no=3932385)
```

- [ ] **Step 3: 파서 실패 테스트 작성**

`test/ppomppu-reader.test.js`에 다음 검증을 작성한다.

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const reader = require('../crawlers/shared/ppomppu-reader');

const fixture = name => fs.readFileSync(
  path.join(__dirname, 'fixtures/ppomppu', name),
  'utf8'
);

test('쿠폰 목록의 제목과 게시글 번호를 파싱한다', () => {
  const posts = reader.parseBoardPosts(fixture('coupon-list.md'), 'coupon');
  assert.deepEqual(posts.map(({ postNo, title }) => ({ postNo, title })), [
    { postNo: '117849', title: '[네이버페이] 쇼핑라이브 오후 일정' },
    { postNo: '117841', title: '[KB Pay] 오늘의 퀴즈 8/28일자 정답' },
  ]);
});

test('검색 파라미터와 무관하게 canonical URL과 post key를 만든다', () => {
  const url = 'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&page=1&divpage=21&no=117849';
  assert.equal(reader.getPostKey(url), 'coupon:117849');
  assert.equal(
    reader.toCanonicalPostUrl('coupon', '117849'),
    'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=117849'
  );
});

test('게시글 본문만 분리하고 뽐뿌 redirect를 복원한다', () => {
  const body = reader.extractPostBody(fixture('naverpay-detail.md'));
  assert.deepEqual(reader.extractExternalUrls(body), [
    'https://mycar.naver.com/?from=push1',
  ]);
});

test('퀴즈 정답을 기존 정규식 규칙으로 추출한다', () => {
  const body = reader.extractPostBody(fixture('quiz-detail.md'));
  assert.equal(reader.extractQuizAnswer(body).answer, '4');
});

test('phone 검색 목록을 공통 게시글 모델로 파싱한다', () => {
  const [post] = reader.parseBoardPosts(fixture('jjizzle-list.md'), 'phone');
  assert.equal(post.postNo, '3932385');
  assert.equal(post.title, '핀다 2970원 창 띄워놓으신 분들은 개통됩니다.');
});
```

- [ ] **Step 4: 테스트를 실행해 실패 확인**

Run: `npm test`

Expected: FAIL with `Cannot find module '../crawlers/shared/ppomppu-reader'`.

- [ ] **Step 5: 최소 파서 구현**

`crawlers/shared/ppomppu-reader.js`에 위 인터페이스를 구현한다. 목록 파서는 각 줄의 `view.php?id=<boardId>...no=<number>` 링크를 기준으로 제목 Markdown 링크를 찾고, `_` 강조 표시는 제거하되 제목의 대괄호는 보존한다.

본문 경계는 마지막 `추천 ...` 줄 다음부터 첫 `#### 공유하기` 전까지다. redirect target은 URL-safe Base64를 표준 Base64로 정규화한 후 UTF-8로 디코딩한다.

- [ ] **Step 6: 파서 테스트 통과 확인**

Run: `npm test`

Expected: 5 tests PASS.

- [ ] **Step 7: 커밋**

```bash
git add package.json crawlers/shared/ppomppu-reader.js test/fixtures/ppomppu test/ppomppu-reader.test.js
git commit -m "Add shared Ppomppu Markdown parser

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Reader 요청 재시도와 등록 결과 정책

**Files:**
- Modify: `crawlers/shared/ppomppu-reader.js`
- Create: `crawlers/shared/registration-outcome.js`
- Modify: `test/ppomppu-reader.test.js`
- Create: `test/registration-outcome.test.js`

**Interfaces:**
- Consumes: Task 1의 파서 함수
- Produces: `fetchReaderMarkdown(sourceUrl, options) -> Promise<string>`
- Produces: `fetchBoardPosts(sourceUrl, boardId, options) -> Promise<Post[]>`
- Produces: `fetchPostBody(sourceUrl, options) -> Promise<string>`
- Produces: `shouldCacheSingleResult(result) -> boolean`
- Produces: `shouldCacheAllResults(results) -> boolean`
- 등록 결과 값: `'registered' | 'duplicate' | 'failed'`

- [ ] **Step 1: 재시도와 헤더 테스트 작성**

`test/ppomppu-reader.test.js`에 fake request와 wait를 주입한다.

```js
test('503 뒤 200 응답을 재시도하고 cache tolerance를 전달한다', async () => {
  const statuses = [503, 200];
  const calls = [];
  const markdown = await reader.fetchReaderMarkdown(
    'https://www.ppomppu.co.kr/zboard/zboard.php?id=coupon',
    {
      cacheToleranceSeconds: 60,
      retryDelays: [0, 1],
      request: async (_url, config) => {
        calls.push(config.headers);
        return { status: statuses.shift(), data: 'ok' };
      },
      wait: async () => {},
    }
  );
  assert.equal(markdown, 'ok');
  assert.equal(calls.length, 2);
  assert.equal(calls[0]['X-Cache-Tolerance'], '60');
});

test('403은 재시도하지 않고 수집 오류를 던진다', async () => {
  let calls = 0;
  await assert.rejects(
    reader.fetchReaderMarkdown('https://example.com', {
      request: async () => {
        calls += 1;
        return { status: 403, data: 'Forbidden' };
      },
      wait: async () => {},
    }),
    /Reader 응답 오류: 403/
  );
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: 등록 결과 정책 실패 테스트 작성**

`test/registration-outcome.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldCacheSingleResult,
  shouldCacheAllResults,
} = require('../crawlers/shared/registration-outcome');

test('성공과 확정 중복만 단일 게시글 캐시를 허용한다', () => {
  assert.equal(shouldCacheSingleResult('registered'), true);
  assert.equal(shouldCacheSingleResult('duplicate'), true);
  assert.equal(shouldCacheSingleResult('failed'), false);
});

test('네이버페이는 모든 URL이 terminal 상태일 때만 캐시한다', () => {
  assert.equal(shouldCacheAllResults([]), false);
  assert.equal(shouldCacheAllResults(['registered', 'duplicate']), true);
  assert.equal(shouldCacheAllResults(['registered', 'failed']), false);
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test`

Expected: FAIL because network and outcome functions are undefined.

- [ ] **Step 4: Reader 요청 구현**

`fetchReaderMarkdown` 기본값:

```js
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS = [0, 2000, 5000, 10000];
```

Reader URL은 원본 URL의 protocol을 `http:`로 바꾸고 `https://r.jina.ai/`를 앞에 붙인다. Axios에는 `validateStatus: () => true`, `timeout: 45000`, `transformResponse: value => value`를 사용한다.

`fetchBoardPosts`는 cache tolerance 60, `fetchPostBody`는 300을 기본값으로 사용한다.

- [ ] **Step 5: 등록 결과 정책 구현**

`registration-outcome.js`:

```js
const TERMINAL_RESULTS = new Set(['registered', 'duplicate']);

function shouldCacheSingleResult(result) {
  return TERMINAL_RESULTS.has(result);
}

function shouldCacheAllResults(results) {
  return results.length > 0 && results.every(shouldCacheSingleResult);
}

module.exports = { shouldCacheSingleResult, shouldCacheAllResults };
```

- [ ] **Step 6: 전체 테스트 통과 확인**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 7: 커밋**

```bash
git add crawlers/shared/ppomppu-reader.js crawlers/shared/registration-outcome.js test/ppomppu-reader.test.js test/registration-outcome.test.js
git commit -m "Add Reader retry and cache outcome policies

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 네이버페이 크롤러 전환

**Files:**
- Modify: `crawlers/ppomppu-naverpay/crawler.js`
- Create: `test/ppomppu-naverpay.test.js`

**Interfaces:**
- Consumes: `fetchBoardPosts`, `fetchPostBody`, `extractExternalUrls`, `getPostKey`, `toCanonicalPostUrl`
- Consumes: `shouldCacheAllResults`
- Produces: `selectNaverPayPosts(posts) -> Post[]`
- Produces: `run({ dryRun }) -> Promise<void>`

- [ ] **Step 1: 선택과 기존 캐시 호환 테스트 작성**

`test/ppomppu-naverpay.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selectNaverPayPosts,
  createPostKeySet,
} = require('../crawlers/ppomppu-naverpay/crawler');

test('네이버페이 제목만 선택한다', () => {
  const posts = selectNaverPayPosts([
    { title: '[네이버페이] 10원', postNo: '1' },
    { title: '[KB Pay] 퀴즈', postNo: '2' },
  ]);
  assert.deepEqual(posts.map(post => post.postNo), ['1']);
});

test('기존 page/divpage URL을 post key로 인식한다', () => {
  const keys = createPostKeySet([
    'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&page=1&divpage=21&no=117849',
  ]);
  assert.equal(keys.has('coupon:117849'), true);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test test/ppomppu-naverpay.test.js`

Expected: FAIL because exports are missing and current module exits without `API_SECRET_KEY`.

- [ ] **Step 3: module-load API secret 종료 제거**

`API_SECRET_KEY` 검사는 `run()` 시작 시 `dryRun === false`인 경우에만 수행한다. `require.main === module`에서는 다음을 호출한다.

```js
run({ dryRun: process.env.DRY_RUN === 'true' }).catch(error => {
  console.error('[크롤러실행오류]', error.message);
});
```

- [ ] **Step 4: Puppeteer 목록·상세 수집을 Reader로 교체**

- `fetchNaverPayPosts()` 대신 `fetchBoardPosts(COUPON_URL, 'coupon')` 후 `selectNaverPayPosts()` 사용
- `extractUrlsFromPost()` 대신 `fetchPostBody(post.url)`와 `extractExternalUrls(body)` 사용
- local cache는 원본 URL Set과 post key Set을 함께 유지
- 새 캐시 URL은 `toCanonicalPostUrl(post.boardId, post.postNo)` 사용

- [ ] **Step 5: 등록 결과와 dry-run 처리 구현**

각 URL 결과를 다음 값으로 기록한다.

```js
'registered' // 2xx
'duplicate'  // 409
'failed'     // 그 외 오류
```

`dryRun`에서는 DB와 등록 API를 호출하지 않고 URL 목록만 `[DRY_RUN]`으로 출력한다. 캐시 파일도 쓰지 않는다.

실제 실행에서는 `shouldCacheAllResults(results)`가 true일 때만 source 게시글을 캐시에 추가한다.

- [ ] **Step 6: 단위 테스트와 dry-run 실행**

Run:

```bash
node --test test/ppomppu-naverpay.test.js
DRY_RUN=true npm run crawl:naverpay
```

Expected:

- tests PASS
- dry-run에서 현재 네이버페이 게시글과 외부 URL 출력
- `crawled_posts.json` 변경 없음

- [ ] **Step 7: 전체 테스트 실행**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 8: 커밋**

```bash
git add crawlers/ppomppu-naverpay/crawler.js test/ppomppu-naverpay.test.js
git commit -m "Migrate NaverPay crawler to Jina Reader

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 퀴즈 크롤러 전환

**Files:**
- Modify: `crawlers/quiz/crawler.js`
- Create: `test/quiz-crawler.test.js`

**Interfaces:**
- Consumes: `fetchBoardPosts`, `fetchPostBody`, `extractQuizAnswer`, `getPostKey`, `toCanonicalPostUrl`
- Produces: 기존 `categorizeQuiz(title)`
- Produces: `selectQuizPosts(posts) -> Post[]`
- Produces: `run({ dryRun }) -> Promise<void>`

- [ ] **Step 1: 6개 카테고리 선택 테스트 작성**

`test/quiz-crawler.test.js`에 다음 제목을 모두 검증한다.

```js
const cases = [
  ['[KB Pay] 오늘의 퀴즈', 'KB Pay'],
  ['[KB스타뱅킹] 스타퀴즈', 'KB스타뱅킹'],
  ['[신한슈퍼SOL] 출석 퀴즈', '신한슈퍼SOL'],
  ['[신한쏠] 야구상식 쏠퀴즈', '신한쏠야구'],
  ['[신한플레이] 퀴즈팡팡', '신한SOL퀴즈팡팡'],
  ['[Hpoint] 퀴즈 정답', 'Hpoint'],
];

for (const [title, expected] of cases) {
  assert.equal(categorizeQuiz(title), expected);
}
```

`selectQuizPosts`가 카테고리 미일치 글을 제외하는 테스트도 추가한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test test/quiz-crawler.test.js`

Expected: FAIL because module exits without secret and functions are not exported.

- [ ] **Step 3: Puppeteer와 browser lifecycle 제거**

- `puppeteer` import와 user-agent 배열 삭제
- `fetchQuizPosts()`를 공통 Reader 목록 호출로 교체
- `extractQuizAnswer(postLink, title)` browser 구현을 삭제하고 `fetchPostBody` + 공통 `extractQuizAnswer` 사용
- module-load API secret 종료를 `run({ dryRun })` 내부로 이동

- [ ] **Step 4: 기존 정책 유지와 post key 적용**

- 6개 카테고리, 날짜 검사, 카테고리당 1건, `lastRegistered` 유지
- URL 문자열 대신 `getPostKey`로 local duplicate 확인
- DB duplicate와 batch 성공/409만 canonical URL로 캐시
- Reader·정답 추출 실패는 캐시하지 않음

- [ ] **Step 5: dry-run 구현**

`dryRun`에서는 DB/API 호출 없이 수집된 6개 카테고리와 combined description을 출력하고 캐시를 쓰지 않는다.

- [ ] **Step 6: 단위 테스트와 dry-run 실행**

Run:

```bash
node --test test/quiz-crawler.test.js
DRY_RUN=true npm run crawl:quiz
```

Expected:

- category tests PASS
- dry-run에서 최대 6개 카테고리와 답 출력
- Chromium 프로세스 생성 없음
- `crawled_quiz_posts.json` 변경 없음

- [ ] **Step 7: 전체 테스트 실행**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 8: 커밋**

```bash
git add crawlers/quiz/crawler.js test/quiz-crawler.test.js
git commit -m "Migrate quiz crawler to Jina Reader

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 쥐즐 크롤러 전환

**Files:**
- Modify: `crawlers/ppomppu-jjizzle/crawler.js`
- Create: `test/ppomppu-jjizzle.test.js`

**Interfaces:**
- Consumes: `fetchBoardPosts`, `getPostKey`, `toCanonicalPostUrl`
- Consumes: `shouldCacheSingleResult`
- Produces: 기존 `normalizeUrl(url)`
- Produces: `run({ dryRun }) -> Promise<void>`

- [ ] **Step 1: URL 정규화와 캐시 결과 테스트 작성**

`test/ppomppu-jjizzle.test.js`:

```js
test('검색과 pagination 파라미터를 제거한다', () => {
  const normalized = normalizeUrl(
    'https://www.ppomppu.co.kr/zboard/view.php?id=money&page=1&divpage=98&search_type=name&keyword=x&no=547011'
  );
  assert.equal(
    normalized,
    'https://www.ppomppu.co.kr/zboard/view.php?id=money&no=547011'
  );
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test test/ppomppu-jjizzle.test.js`

Expected: FAIL because module exits without secret and `normalizeUrl` is not exported.

- [ ] **Step 3: Reader 목록으로 교체**

각 target에 `boardId`를 명시한다.

```js
{ name: 'phone', boardId: 'phone', url: '...', displayName: '휴대폰포럼' }
{ name: 'money', boardId: 'money', url: '...', displayName: '재테크포럼' }
```

`fetchPostsFromBoard()` Puppeteer 구현을 삭제하고 `fetchBoardPosts(target.url, target.boardId)`를 호출한다.

- [ ] **Step 4: 등록 실패 캐시 오염 제거**

- 성공: `'registered'`, 캐시 추가
- 409: `'duplicate'`, 캐시 추가
- 그 외: `'failed'`, 캐시 추가 금지
- DB duplicate는 기존처럼 캐시 추가
- sponsor/consulting 제외는 유지

- [ ] **Step 5: dry-run 구현**

`dryRun`에서는 DB/API 호출 없이 신규 후보 제목과 canonical URL을 출력하고 캐시 파일을 쓰지 않는다.

- [ ] **Step 6: 테스트와 dry-run 실행**

Run:

```bash
node --test test/ppomppu-jjizzle.test.js
DRY_RUN=true npm run crawl:jjizzle
npm test
```

Expected:

- tests PASS
- phone/money 목록에서 쥐즐 게시글 출력
- `crawled_posts.json` 변경 없음

- [ ] **Step 7: 커밋**

```bash
git add crawlers/ppomppu-jjizzle/crawler.js test/ppomppu-jjizzle.test.js
git commit -m "Migrate JJizzle crawler to Jina Reader

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: GitHub Actions dry-run과 전체 검증

**Files:**
- Modify: `.github/workflows/ppomppu-naverpay.yml`
- Modify: `.github/workflows/quiz.yml`
- Modify: `.github/workflows/ppomppu-jjizzle.yml`

**Interfaces:**
- Consumes: 세 crawler의 `DRY_RUN=true` 동작
- Produces: `workflow_dispatch.inputs.dry_run` boolean

- [ ] **Step 1: 세 워크플로에 dry-run 입력 추가**

각 워크플로의 `workflow_dispatch`를 다음 형식으로 변경한다.

```yaml
workflow_dispatch:
  inputs:
    dry_run:
      description: Collect and parse without API or cache writes
      required: false
      type: boolean
      default: false
```

crawler step env에 추가한다.

```yaml
DRY_RUN: ${{ inputs.dry_run && 'true' || 'false' }}
```

- [ ] **Step 2: dry-run에서 commit 단계를 건너뛰도록 보호**

각 commit step에 추가한다.

```yaml
if: ${{ github.event_name != 'workflow_dispatch' || !inputs.dry_run }}
```

schedule 이벤트는 기존과 동일하게 commit을 수행한다.

- [ ] **Step 3: 로컬 정적 검증**

Run:

```bash
npm test
node --check crawlers/shared/ppomppu-reader.js
node --check crawlers/ppomppu-naverpay/crawler.js
node --check crawlers/quiz/crawler.js
node --check crawlers/ppomppu-jjizzle/crawler.js
git diff --check
```

Expected: 모든 명령 exit 0.

- [ ] **Step 4: 로컬 세 크롤러 dry-run**

Run:

```bash
DRY_RUN=true npm run crawl:naverpay
DRY_RUN=true npm run crawl:quiz
DRY_RUN=true npm run crawl:jjizzle
```

Expected:

- 세 실행 모두 Reader에서 실제 게시글을 출력
- API 호출 없음
- 캐시 JSON diff 없음
- `[수집실패]` 없음

확인:

```bash
git status --short
```

Expected: 테스트·구현 파일만 변경되고 세 cache JSON은 표시되지 않음.

- [ ] **Step 5: 커밋**

```bash
git add .github/workflows/ppomppu-naverpay.yml .github/workflows/quiz.yml .github/workflows/ppomppu-jjizzle.yml
git commit -m "Add crawler dry-run workflow inputs

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 6: 구현 브랜치 push 승인 요청**

사용자에게 `fix/ppomppu-jina-reader` 원격 push와 세 dry-run 워크플로 실행 승인을 요청한다. 승인 전에는 push하지 않는다.

- [ ] **Step 7: 승인 후 원격 dry-run 실행**

```bash
git push -u origin fix/ppomppu-jina-reader
gh workflow run ppomppu-naverpay.yml --ref fix/ppomppu-jina-reader -f dry_run=true
gh workflow run quiz.yml --ref fix/ppomppu-jina-reader -f dry_run=true
gh workflow run ppomppu-jjizzle.yml --ref fix/ppomppu-jina-reader -f dry_run=true
```

각 run을 완료까지 확인하고 다음을 검증한다.

- NaverPay: 게시글과 외부 URL 발견
- Quiz: 6개 카테고리 또는 현재 미등록 카테고리의 답 발견
- JJizzle: phone/money 목록 발견
- API 등록·캐시 commit 없음
- workflow 성공

- [ ] **Step 8: 실제 API 실행 승인 요청**

세 dry-run 결과를 사용자에게 보고하고 실제 API 등록을 수행할 워크플로 수동 실행 승인을 별도로 요청한다.

- [ ] **Step 9: 승인 후 실제 워크플로 실행과 결과 검증**

```bash
gh workflow run ppomppu-naverpay.yml --ref fix/ppomppu-jina-reader -f dry_run=false
gh workflow run quiz.yml --ref fix/ppomppu-jina-reader -f dry_run=false
gh workflow run ppomppu-jjizzle.yml --ref fix/ppomppu-jina-reader -f dry_run=false
```

검증:

- API 성공 또는 409 로그
- 성공·확정 중복 source만 캐시 파일에 추가
- 일반 실패 source는 캐시 미추가
- quiz 프로세스 정상 종료
- commit/push 단계 완료

- [ ] **Step 10: probe 브랜치 정리 승인 및 삭제**

실제 실행까지 확인한 뒤 임시 probe 브랜치가 더 필요하지 않음을 사용자에게 확인하고 삭제한다.

```bash
git push origin --delete probe/ppomppu-20260828
git branch -D probe/ppomppu-20260828
```

- [ ] **Step 11: 최종 전체 검증**

Run:

```bash
npm test
git status --short --branch
git log --oneline --decorate -8
```

Expected:

- 모든 테스트 PASS
- 사용자 소유 미추적 파일만 남음
- 구현 커밋들이 `fix/ppomppu-jina-reader`에 존재
