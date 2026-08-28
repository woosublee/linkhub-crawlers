# 뽐뿌 크롤러 Jina Reader 전환 설계

## 배경

2026-08-27부터 네이버페이, 퀴즈, 쥐즐 크롤러가 워크플로 실패 없이 게시글 목록을 0건으로 반환하기 시작했다. GitHub Actions 로그에서는 로컬·DB 중복 검사 전에 목록 파싱 결과가 비어 있었고, 세 크롤러가 공통으로 뽐뿌 페이지와 `#revolution_main_table` DOM에 의존하고 있었다.

임시 브랜치에서 실제 GitHub-hosted runner를 사용해 수집 경로를 검증했다.

- 직접 Desktop/Mobile HTTP 및 Puppeteer: Ubuntu·macOS 모두 nginx `403 Forbidden`
- Jina Reader Desktop/Mobile: Ubuntu·macOS 모두 `200`
- Linux Node.js 20 dry-run: 목록 30건, 네이버페이 신규 후보 8건과 외부 URL, 퀴즈 6개 카테고리와 정답을 모두 추출

검증 실행:

- 네트워크 경로: GitHub Actions run `33142278699`
- 전체 dry-run: GitHub Actions run `33142718431`

## 목표

1. 세 뽐뿌 크롤러가 GitHub Actions에서 실제 신규 게시글을 다시 수집한다.
2. 목록·상세 수집 방식을 하나의 검증된 공통 모듈로 통합한다.
3. 일시적인 수집·등록 실패를 캐시에 기록해 영구 누락시키지 않는다.
4. Puppeteer 브라우저 누수와 DOM selector 의존을 제거한다.
5. 기존 API payload, 태그, 퀴즈 카테고리, 워크플로 스케줄은 유지한다.

## 비목표

- LinkHub API 또는 `/links/check` 백엔드 변경
- 퀴즈 카테고리 추가 또는 정답 품질 규칙의 전면 개편
- Jina API 키 도입
- 기존 캐시 파일 포맷 마이그레이션
- 뽐뿌 외 사이트 크롤러 변경

## 공통 수집 모듈

`crawlers/shared/ppomppu-reader.js`를 추가한다.

### 공개 기능

- `fetchBoardPosts(sourceUrl, boardId)`
  - Jina Reader에서 게시판 Markdown을 가져온다.
  - 게시글 제목, 원문 URL, 게시판 ID, 게시글 번호를 반환한다.
- `fetchPostBody(sourceUrl)`
  - 상세 Markdown에서 게시글 본문만 분리한다.
- `extractExternalUrls(body)`
  - 본문 Markdown 링크를 추출한다.
  - `s.ppomppu.co.kr`의 Base64 `target`을 실제 목적 URL로 복원한다.
- `extractQuizAnswer(body)`
  - 기존 퀴즈 정답 정규식과 동일한 규칙으로 답을 추출한다.
- `getPostKey(url)`
  - `id:no` 형식의 안정적인 중복 키를 만든다.

### 요청 정책

- Reader URL: `https://r.jina.ai/http://www.ppomppu.co.kr/...`
- 응답 형식: UTF-8 Markdown
- 목록 요청: `X-Cache-Tolerance: 60`
- 상세 요청: `X-Cache-Tolerance: 300`
- timeout: 45초
- 재시도 상태: `429`, `500`, `502`, `503`, `504`, 네트워크 오류
- backoff: 즉시, 2초, 5초, 10초
- 상세 요청 간 기본 간격: 1.5초

무인증 Reader 한도는 20 RPM이다. 각 워크플로는 별도 실행되며 예상 호출량은 다음과 같아 한도 내에 머문다.

- 네이버페이: 목록 1회 + 신규 상세 글
- 퀴즈: 목록 1회 + 최대 6개 상세 글
- 쥐즐: 목록 2회

## 게시글 모델과 중복 키

공통 게시글 모델:

```js
{
  boardId: 'coupon',
  postNo: '117849',
  title: '[네이버페이] ...',
  url: 'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=117849'
}
```

기존 캐시는 URL 배열을 유지한다. 캐시를 읽을 때 URL에서 `id`와 `no`를 추출해 `id:no` Set을 함께 만든다. 이로써 `page`, `divpage`, 검색 파라미터, Desktop/Mobile URL 차이와 무관하게 같은 게시글을 인식한다.

새 캐시 값은 기존 워크플로와의 호환성을 위해 canonical Desktop URL로 저장한다.

## 네이버페이 크롤러

1. 쿠폰게시판 목록을 Jina Reader로 조회한다.
2. 제목에 `네이버페이`가 포함된 게시글만 선택한다.
3. `coupon:postNo`로 로컬 중복을 확인한다.
4. 기존 `/links/check` 검사를 유지한다.
5. 상세 본문에서 외부 URL을 추출하고 뽐뿌 redirect를 실제 URL로 복원한다.
6. 각 외부 URL을 기존 `NPay적립` 태그로 등록한다.
7. 모든 URL이 등록 성공 또는 `409`로 확정된 경우에만 source 게시글을 캐시에 저장한다.
8. URL 없음, Reader 오류, timeout, `5xx`, 예상하지 못한 API 응답은 캐시하지 않는다.

일부 URL만 성공한 경우 source 글을 캐시하지 않는다. 다음 실행에서 성공 URL은 API의 `409`로 정리되고 실패 URL은 다시 등록할 수 있다.

## 퀴즈 크롤러

1. 쿠폰게시판 목록을 Jina Reader로 조회한다.
2. 기존 6개 `QUIZ_CATEGORIES`, 날짜 필터, 카테고리당 1건 정책을 유지한다.
3. 상세 Markdown 본문에 기존 정답 정규식을 적용한다.
4. 수집된 퀴즈를 기존 형식으로 하나의 텍스트 카드에 합친다.
5. batch 등록 성공 또는 `409`일 때만 게시글 캐시와 `lastRegistered`를 갱신한다.
6. 정답 추출 실패와 Reader 오류는 캐시하지 않는다.

Puppeteer를 제거하므로 상세 selector 실패 시 browser가 닫히지 않던 누수 경로도 제거된다.

## 쥐즐 크롤러

1. 기존 phone/money 검색 URL을 그대로 Jina Reader에 전달한다.
2. 목록 Markdown에서 제목과 원문 URL을 추출한다.
3. 기존 URL 정규화, sponsor/consulting 제외, API payload를 유지한다.
4. 등록 성공 또는 `409`일 때만 캐시에 저장한다.
5. 일반 등록 실패는 캐시하지 않아 다음 실행에서 재시도한다.

## 오류 처리

Jina Reader까지 실패해도 반복 스케줄 특성을 고려해 프로세스는 오류를 로그로 남기고 정상 종료한다.

- 정상 목록이지만 대상 글 없음: `[변경없음]`
- Reader, parsing, 비정상 응답: `[수집실패]`
- 실패 시 캐시 파일을 변경하지 않는다.
- 다음 스케줄에서 같은 게시글을 다시 시도한다.

API secret, 상세 응답 전문, 불필요한 토큰은 오류 로그에 출력하지 않는다.

## 테스트

Node.js 내장 `node:test`를 사용한다.

Fixture는 probe에서 수집한 공개 뽐뿌 Markdown을 필요한 최소 구간으로 축소해 저장한다.

테스트 범위:

1. 쿠폰게시판 목록 30건 파싱과 제목·번호·URL 추출
2. phone/money 검색 결과 파싱
3. 다중 이미지·강조 문법이 있는 제목 파싱
4. 상세 Markdown의 게시글 본문 경계 추출
5. `s.ppomppu.co.kr` Base64 target 복원
6. 네이버페이 본문에서 외부 URL만 추출
7. 6개 퀴즈 카테고리 분류와 정답 추출
8. URL 변형 간 동일 `id:no` 키 생성
9. 성공·409·일시 실패별 캐시 가능 여부
10. Reader 재시도 가능/불가능 상태 구분

## 배포 및 검증

1. 공통 모듈과 단위 테스트 작성
2. 네이버페이, 퀴즈, 쥐즐을 순서대로 전환
3. 전체 테스트 실행
4. API 호출을 막은 dry-run을 로컬에서 실행
5. 구현 브랜치를 GitHub Actions에서 dry-run 실행
6. 사용자 확인 후 실제 API를 호출하는 세 워크플로를 수동 실행
7. 신규 등록, 캐시 커밋, 프로세스 종료를 확인
8. 검증용 임시 원격 브랜치를 삭제

## 외부 의존성 위험

Jina Reader는 검증 시점에 GitHub Actions에서 정상 작동했지만 외부 서비스이므로 가용성과 정책이 바뀔 수 있다. 이를 완화하기 위해 다음을 적용한다.

- 제한된 재시도와 backoff
- 캐시 허용 시간 명시
- 호출 간격 유지
- 실패한 게시글을 로컬 캐시에 저장하지 않음
- 수집 실패와 실제 신규 글 없음 로그 분리

향후 Reader가 장기간 불가하면 API 키 도입, 별도 수집 서버 또는 self-hosted runner를 다음 대안으로 검토한다.
