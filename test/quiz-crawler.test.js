const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const axios = require('axios');
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

test('정답 없는 DB-check 실패 글은 다른 collected 퀴즈의 terminal batch cache를 막지 않는다', async () => {
  const reader = require('../crawlers/shared/ppomppu-reader');
  const crawlerPath = require.resolve('../crawlers/quiz/crawler');
  const originalFetchBoardPosts = reader.fetchBoardPosts;
  const originalFetchPostBody = reader.fetchPostBody;
  const originalAxiosPost = axios.post;
  const originalExistsSync = fs.existsSync;
  const originalReadFileSync = fs.readFileSync;
  const originalWriteFileSync = fs.writeFileSync;
  const originalSetTimeout = global.setTimeout;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  const originalApiSecretKey = process.env.API_SECRET_KEY;
  const cacheWrites = [];
  const registrationPayloads = [];
  const quizCachePath = path.join(__dirname, '../crawlers/quiz/crawled_quiz_posts.json');

  reader.fetchBoardPosts = async () => [
    {
      boardId: 'coupon',
      postNo: '1',
      title: '[KB Pay] 정답 없음',
      url: 'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=1',
    },
    {
      boardId: 'coupon',
      postNo: '2',
      title: '[Hpoint] 정답 있음',
      url: 'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=2',
    },
  ];
  reader.fetchPostBody = async url => (url.endsWith('no=1') ? '본문' : '정답: 4');
  axios.post = async (url, payload) => {
    if (url.endsWith('/links/check') && payload.url.endsWith('no=1')) {
      throw new Error('DB check timeout');
    }
    if (url.endsWith('/links/check')) {
      return { data: { exists: false } };
    }
    if (url.endsWith('/links')) {
      registrationPayloads.push(payload);
      return { status: 201 };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  fs.existsSync = () => true;
  fs.readFileSync = (filePath, ...args) => (
    filePath === quizCachePath
      ? JSON.stringify({ posts: [], metadata: { lastRegistered: {} } })
      : originalReadFileSync(filePath, ...args)
  );
  fs.writeFileSync = (filePath, contents, ...args) => {
    if (filePath === quizCachePath) {
      cacheWrites.push(JSON.parse(contents));
      return;
    }
    return originalWriteFileSync(filePath, contents, ...args);
  };
  global.setTimeout = callback => {
    callback();
    return 0;
  };
  console.error = () => {};
  console.log = () => {};
  process.env.API_SECRET_KEY = 'test-secret';
  delete require.cache[crawlerPath];

  try {
    const { run } = require(crawlerPath);
    await run();

    assert.deepEqual(registrationPayloads, [{ url: '[Hpoint] : 4', tags: ['퀴즈'] }]);
    assert.equal(cacheWrites.length, 1);
    assert.deepEqual(cacheWrites[0].posts, [
      'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=2',
    ]);
    assert.match(cacheWrites[0].metadata.lastRegistered.Hpoint, /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    reader.fetchBoardPosts = originalFetchBoardPosts;
    reader.fetchPostBody = originalFetchPostBody;
    axios.post = originalAxiosPost;
    fs.existsSync = originalExistsSync;
    fs.readFileSync = originalReadFileSync;
    fs.writeFileSync = originalWriteFileSync;
    global.setTimeout = originalSetTimeout;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    if (originalApiSecretKey === undefined) {
      delete process.env.API_SECRET_KEY;
    } else {
      process.env.API_SECRET_KEY = originalApiSecretKey;
    }
    delete require.cache[crawlerPath];
  }
});

test('API secret이 없는 non-dry CLI 실행은 non-zero로 종료한다', () => {
  const result = spawnSync(process.execPath, ['crawlers/quiz/crawler.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, API_SECRET_KEY: '' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /API_SECRET_KEY 환경변수가 설정되지 않았습니다/);
});
