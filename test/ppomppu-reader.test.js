const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const reader = require('../crawlers/shared/ppomppu-reader');

const fixture = name => fs.readFileSync(
  path.join(__dirname, 'fixtures/ppomppu', name),
  'utf8'
);

function readerDocument(sourceUrl, markdownContent = '') {
  return [
    'Title: Ppomppu Reader fixture',
    '',
    `URL Source: ${sourceUrl.replace(/^https:/, 'http:')}`,
    '',
    'Markdown Content:',
    markdownContent,
  ].join('\n');
}

test('쿠폰 공개 probe의 30건과 다중 이미지/강조 제목을 파싱한다', () => {
  const posts = reader.parseBoardPosts(fixture('coupon-list.md'), 'coupon');

  assert.equal(posts.length, 30);
  assert.deepEqual(posts.map(({ postNo }) => postNo), [
    '117849', '117848', '117847', '117846', '117844', '117843',
    '117842', '117841', '117840', '117839', '117838', '117837',
    '117836', '117835', '117834', '117833', '117832', '117831',
    '117830', '117829', '117828', '117827', '117826', '117825',
    '117824', '117823', '117822', '117821', '117820', '117819',
  ]);
  assert.deepEqual(posts.filter(post => [
    '117849', '117841', '117833',
  ].includes(post.postNo)).map(({ postNo, title }) => ({ postNo, title })), [
    {
      postNo: '117849',
      title: '[네이버페이] 쇼핑라이브 오후 일정 (14시 1개, 18시 1개, 20시 2개)',
    },
    { postNo: '117841', title: '[KB Pay] 오늘의 퀴즈 8/28일자 정답' },
    { postNo: '117833', title: '[네이버페이] 네이버 AI탭 20원 받으세요' },
  ]);
  assert.equal(posts[0].boardId, 'coupon');
  assert.equal(reader.getPostKey(posts[15].url), 'coupon:117833');
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
  const redirectUrl = 'https://s.ppomppu.co.kr/?idno=coupon_117847&target=aHR0cHM6Ly9teWNhci5uYXZlci5jb20vP2Zyb209cHVzaDE=&encode=on';

  assert.equal(
    reader.decodePpomppuTarget(redirectUrl),
    'https://mycar.naver.com/?from=push1'
  );
  assert.deepEqual(reader.extractExternalUrls(body), [
    'https://mycar.naver.com/?from=push1',
  ]);
});

test('뽐뿌 redirect가 복원한 내부 URL은 외부 URL로 반환하지 않는다', () => {
  const redirectUrl = 'https://s.ppomppu.co.kr/?target=aHR0cHM6Ly93d3cucHBvbXBwdS5jby5rci96Ym9hcmQvdmlldy5waHA_aWQ9Y291cG9uJm5vPTExNzg0Nw';

  assert.deepEqual(reader.extractExternalUrls(`[내부 링크](${redirectUrl})`), []);
});

test('bare URL 뒤 문장 종결 punctuation만 제거한다', () => {
  const body = [
    '첫 링크 https://example.com/path.',
    '둘째 링크 https://example.org/coupon,',
    '셋째 링크 (https://example.net/deal).',
  ].join('\n');

  assert.deepEqual(reader.extractExternalUrls(body), [
    'https://example.com/path',
    'https://example.org/coupon',
    'https://example.net/deal',
  ]);
});

test('Markdown target과 percent encoding은 trailing punctuation 정리로 손상하지 않는다', () => {
  assert.deepEqual(
    reader.extractExternalUrls('[명시 링크](https://example.com/path.) bare https://example.org/a%2Fb.'),
    ['https://example.com/path.', 'https://example.org/a%2Fb']
  );
});

test('퀴즈 정답의 합법적인 마침표와 공백을 보존한다', () => {
  const body = reader.extractPostBody(fixture('quiz-detail.md'));
  const quiz = reader.extractQuizAnswer(body);

  assert.equal(quiz.answer, '4. 15000 P');
  assert.equal(quiz.fullContent, body);
});

test('Hpoint 정답 뒤 Markdown event link 경계에서 PLAY만 추출한다', () => {
  const body = reader.extractPostBody(fixture('quiz-hpoint-link-detail.md'));
  const quiz = reader.extractQuizAnswer(body);

  assert.equal(quiz.answer, 'PLAY');
  assert.doesNotMatch(quiz.answer, /\*\*|\]\(|\r|\n|정답 입력 전 참고|여기를 눌러/);
});

test('KB스타뱅킹 정답 label emphasis와 뒤 image 경계에서 2번 2만 추출한다', () => {
  const body = reader.extractPostBody(fixture('quiz-kb-star-image-detail.md'));
  const quiz = reader.extractQuizAnswer(body);

  assert.equal(quiz.answer, '2번 2');
  assert.doesNotMatch(quiz.answer, /\*\*|!\[|\r|\n|정답 입력 전 참고|여기를 눌러/);
});

test('신한쏠야구 완결 emphasis 뒤 prose 경계에서 팀명만 추출한다', () => {
  const body = reader.extractPostBody(fixture('quiz-shinhan-baseball-prose-detail.md'));
  const quiz = reader.extractQuizAnswer(body);

  assert.equal(quiz.answer, '디트로이트 타이거스');
  assert.doesNotMatch(quiz.answer, /\*\*|\r|\n|\bPS\b|정답 입력 전 참고|여기를 눌러/i);
});

test('신한SOL퀴즈팡팡 emphasis 뒤 advisory 경계에서 쉼표 포함 정답만 추출한다', () => {
  const body = reader.extractPostBody(fixture('quiz-shinhan-pang-advisory-detail.md'));
  const quiz = reader.extractQuizAnswer(body);

  assert.equal(quiz.answer, '보이스피싱, 카드 분실 피해');
  assert.doesNotMatch(quiz.answer, /\*\*|\r|\n|정답 입력 전 참고|댓글 분위기|여기를 눌러/);
});

test('정답 marker 없는 advisory-only 본문은 정답으로 추측하지 않는다', () => {
  const body = '**정답 입력 전 참고:** 문제 자체가 바뀔 수 있으니 댓글을 확인하세요.';

  assert.equal(reader.extractQuizAnswer(body), null);
});

test('별표와 밑줄 emphasis는 제거하고 닫히지 않은 경계나 없음 표시는 거부한다', () => {
  for (const [body, expected] of [
    ['정답: *ALPHA 123*', 'ALPHA 123'],
    ['정답: _한글 정답_', '한글 정답'],
    ['정답: **쉼표, 포함 정답**', '쉼표, 포함 정답'],
  ]) {
    assert.equal(reader.extractQuizAnswer(body).answer, expected);
  }

  assert.equal(reader.extractQuizAnswer('정답: **닫히지 않은 정답'), null);
  assert.equal(reader.extractQuizAnswer('정답: 정보 없음'), null);
});

test('쥐즐 phone과 money 검색 목록을 공통 게시글 모델로 파싱한다', () => {
  const markdown = fixture('jjizzle-list.md');
  const [phonePost] = reader.parseBoardPosts(markdown, 'phone');
  const [moneyPost] = reader.parseBoardPosts(markdown, 'money');

  assert.deepEqual(
    { postNo: phonePost.postNo, title: phonePost.title },
    { postNo: '3932385', title: '핀다 2970원 창 띄워놓으신 분들은 개통됩니다.' }
  );
  assert.deepEqual(
    { postNo: moneyPost.postNo, title: moneyPost.title },
    { postNo: '547011', title: '올리브영 현대카드 Plus 출시 (만들지 마세요)' }
  );
});

test('503 뒤 200 응답을 재시도하고 cache tolerance를 전달한다', async () => {
  const sourceUrl = 'https://www.ppomppu.co.kr/zboard/zboard.php?id=coupon';
  const statuses = [503, 200];
  const calls = [];
  const expectedMarkdown = readerDocument(sourceUrl, '게시판 본문');
  const markdown = await reader.fetchReaderMarkdown(sourceUrl, {
    cacheToleranceSeconds: 60,
    retryDelays: [0, 1],
    request: async (url, config) => {
      calls.push({ url, config });
      return { status: statuses.shift(), data: expectedMarkdown };
    },
    wait: async () => {},
  });

  assert.equal(markdown, expectedMarkdown);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://r.jina.ai/http://www.ppomppu.co.kr/zboard/zboard.php?id=coupon');
  assert.equal(calls[0].config.headers['X-Cache-Tolerance'], '60');
  assert.equal(calls[0].config.timeout, 45000);
  assert.equal(calls[0].config.validateStatus(503), true);
  assert.equal(calls[0].config.transformResponse('raw markdown'), 'raw markdown');
});

test('malformed 2xx body를 정상 markdown으로 반환하지 않는다', async () => {
  const sourceUrl = 'https://www.ppomppu.co.kr/zboard/zboard.php?id=coupon';

  for (const data of [
    '<html><body>upstream error</body></html>',
    'arbitrary successful response',
    'Title: metadata only\n\nURL Source: http://www.ppomppu.co.kr/zboard/zboard.php?id=coupon',
  ]) {
    await assert.rejects(
      reader.fetchReaderMarkdown(sourceUrl, {
        retryDelays: [0],
        request: async () => ({ status: 200, data }),
      }),
      /Reader 문서 형식 오류/
    );
  }
});

test('구조 검증 실패도 bounded retry 안에서 다시 요청한다', async () => {
  const sourceUrl = 'https://www.ppomppu.co.kr/zboard/zboard.php?id=coupon';
  let calls = 0;

  const markdown = await reader.fetchReaderMarkdown(sourceUrl, {
    retryDelays: [0, 1],
    request: async () => {
      calls += 1;
      return {
        status: 200,
        data: calls === 1 ? 'temporary malformed response' : readerDocument(sourceUrl, '정상 본문'),
      };
    },
    wait: async () => {},
  });

  assert.equal(calls, 2);
  assert.match(markdown, /Markdown Content:/);
});

test('unrelated 또는 요청과 다른 Ppomppu URL Source를 거부한다', async () => {
  const sourceUrl = 'https://www.ppomppu.co.kr/zboard/zboard.php?id=coupon';

  for (const documentSource of [
    'https://example.com/zboard/zboard.php?id=coupon',
    'http://www.ppomppu.co.kr/zboard/zboard.php?id=phone',
  ]) {
    await assert.rejects(
      reader.fetchReaderMarkdown(sourceUrl, {
        retryDelays: [0],
        request: async () => ({ status: 200, data: readerDocument(documentSource, '본문') }),
      }),
      /URL Source 불일치/
    );
  }
});

test('403은 재시도하지 않고 수집 오류를 던진다', async () => {
  let calls = 0;

  await assert.rejects(
    reader.fetchReaderMarkdown('https://www.ppomppu.co.kr/zboard/zboard.php?id=coupon', {
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

test('네트워크 오류 뒤 지정한 delay로 재시도한다', async () => {
  const sourceUrl = 'https://www.ppomppu.co.kr/zboard/zboard.php?id=coupon';
  let calls = 0;
  const delays = [];
  const expectedMarkdown = readerDocument(sourceUrl, '정상 본문');
  const markdown = await reader.fetchReaderMarkdown(sourceUrl, {
    retryDelays: [0, 1],
    request: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('ECONNRESET');
      }
      return { status: 200, data: expectedMarkdown };
    },
    wait: async delay => {
      delays.push(delay);
    },
  });

  assert.equal(markdown, expectedMarkdown);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1]);
});

test('목록 Reader 요청은 60초 cache tolerance로 게시글을 파싱한다', async () => {
  let headers;
  const posts = await reader.fetchBoardPosts(
    'https://www.ppomppu.co.kr/zboard/zboard.php?id=coupon',
    'coupon',
    {
      request: async (_url, config) => {
        headers = config.headers;
        return { status: 200, data: fixture('coupon-list.md') };
      },
    }
  );

  assert.equal(headers['X-Cache-Tolerance'], '60');
  assert.equal(posts.length, 30);
  assert.equal(posts[0].postNo, '117849');
});

test('유효한 Reader 문서의 0건 board는 기본 실패이고 allowEmpty에서만 허용한다', async () => {
  const sourceUrl = 'https://www.ppomppu.co.kr/zboard/zboard.php?id=phone&search_type=name';
  const data = readerDocument(sourceUrl, '검색 결과가 없습니다.');
  const options = {
    retryDelays: [0],
    request: async () => ({ status: 200, data }),
  };

  await assert.rejects(
    reader.fetchBoardPosts(sourceUrl, 'phone', options),
    /Reader 게시글 0건/
  );
  assert.deepEqual(
    await reader.fetchBoardPosts(sourceUrl, 'phone', { ...options, allowEmpty: true }),
    []
  );
});

test('allowEmpty여도 malformed Reader 문서는 실패한다', async () => {
  await assert.rejects(
    reader.fetchBoardPosts(
      'https://www.ppomppu.co.kr/zboard/zboard.php?id=phone',
      'phone',
      {
        allowEmpty: true,
        retryDelays: [0],
        request: async () => ({ status: 200, data: 'not a Reader document' }),
      }
    ),
    /Reader 문서 형식 오류/
  );
});

test('상세 Reader 요청은 300초 cache tolerance로 본문을 분리한다', async () => {
  let headers;
  const body = await reader.fetchPostBody(
    'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=117847',
    {
      request: async (_url, config) => {
        headers = config.headers;
        return { status: 200, data: fixture('naverpay-detail.md') };
      },
    }
  );

  assert.equal(headers['X-Cache-Tolerance'], '300');
  assert.equal(
    body,
    '본문 [https://mycar.naver.com/?from=push1](https://s.ppomppu.co.kr/?idno=coupon_117847&target=aHR0cHM6Ly9teWNhci5uYXZlci5jb20vP2Zyb209cHVzaDE=&encode=on)'
  );
});
