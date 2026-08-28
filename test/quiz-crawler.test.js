const test = require('node:test');
const assert = require('node:assert/strict');
const {
  categorizeQuiz,
  selectQuizPosts,
} = require('../crawlers/quiz/crawler');

test('6개 퀴즈 카테고리를 제목으로 분류한다', () => {
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
});

test('카테고리 미일치 게시글을 제외한다', () => {
  const posts = [
    { title: '[KB Pay] 오늘의 퀴즈', postNo: '1' },
    { title: '[네이버페이] 포인트 적립', postNo: '2' },
  ];

  assert.deepEqual(selectQuizPosts(posts).map(post => post.postNo), ['1']);
});

test('빈 Reader 본문을 수집 실패로 분류하고 다음 퀴즈를 dry-run으로 수집한다', async () => {
  const reader = require('../crawlers/shared/ppomppu-reader');
  const crawlerPath = require.resolve('../crawlers/quiz/crawler');
  const originalFetchBoardPosts = reader.fetchBoardPosts;
  const originalFetchPostBody = reader.fetchPostBody;
  const originalSetTimeout = global.setTimeout;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  const errors = [];
  const logs = [];

  reader.fetchBoardPosts = async () => [
    {
      boardId: 'coupon',
      postNo: '1',
      title: '[KB Pay] 빈 본문',
      url: 'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=1',
    },
    {
      boardId: 'coupon',
      postNo: '2',
      title: '[Hpoint] 정상 본문',
      url: 'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=2',
    },
  ];
  reader.fetchPostBody = async url => (url.endsWith('no=1') ? '  ' : '정답: 4');
  global.setTimeout = callback => {
    callback();
    return 0;
  };
  console.error = (...args) => errors.push(args.join(' '));
  console.log = (...args) => logs.push(args);
  delete require.cache[crawlerPath];

  try {
    const { run } = require(crawlerPath);
    await run({ dryRun: true });

    assert.equal(errors.some(message => message.includes('[수집실패]') && message.includes('빈 본문')), true);
    assert.equal(
      logs.some(args => args[0] === '[DRY_RUN] 전송 데이터:' && args[1]?.url === '[Hpoint] : 4'),
      true
    );
  } finally {
    reader.fetchBoardPosts = originalFetchBoardPosts;
    reader.fetchPostBody = originalFetchPostBody;
    global.setTimeout = originalSetTimeout;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    delete require.cache[crawlerPath];
  }
});
