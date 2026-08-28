const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selectNaverPayPosts,
  createPostKeySet,
} = require('../crawlers/ppomppu-naverpay/crawler');
const reader = require('../crawlers/shared/ppomppu-reader');
const crawlerPath = require.resolve('../crawlers/ppomppu-naverpay/crawler');

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

test('빈 Reader 본문을 수집 실패로 분류하고 다음 게시글을 계속 처리한다', async () => {
  const originalFetchBoardPosts = reader.fetchBoardPosts;
  const originalFetchPostBody = reader.fetchPostBody;
  const originalExtractExternalUrls = reader.extractExternalUrls;
  const originalSetTimeout = global.setTimeout;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  const errors = [];
  const logs = [];
  let extractCalls = 0;

  reader.fetchBoardPosts = async () => [
    {
      boardId: 'coupon',
      postNo: '1',
      title: '[네이버페이] 빈 본문',
      url: 'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=1',
    },
    {
      boardId: 'coupon',
      postNo: '2',
      title: '[네이버페이] 정상 본문',
      url: 'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=2',
    },
  ];
  reader.fetchPostBody = async url => (url.endsWith('no=1') ? '' : '본문');
  reader.extractExternalUrls = body => {
    extractCalls += 1;
    return body ? ['https://example.com'] : [];
  };
  global.setTimeout = callback => {
    callback();
    return 0;
  };
  console.error = (...args) => errors.push(args.join(' '));
  console.log = (...args) => logs.push(args.join(' '));
  delete require.cache[crawlerPath];

  try {
    const { run } = require(crawlerPath);
    await run({ dryRun: true });

    assert.equal(extractCalls, 1);
    assert.equal(errors.some(message => message.includes('[수집실패]') && message.includes('본문')), true);
    assert.equal(logs.some(message => message.includes('[DRY_RUN] https://example.com')), true);
  } finally {
    reader.fetchBoardPosts = originalFetchBoardPosts;
    reader.fetchPostBody = originalFetchPostBody;
    reader.extractExternalUrls = originalExtractExternalUrls;
    global.setTimeout = originalSetTimeout;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    delete require.cache[crawlerPath];
  }
});
