const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const axios = require('axios');
const reader = require('../crawlers/shared/ppomppu-reader');
const {
  categorizeQuiz,
  selectQuizPosts,
  registerQuizBatchToAPI,
} = require('../crawlers/quiz/crawler');

const crawlerPath = require.resolve('../crawlers/quiz/crawler');
const quizCachePath = path.join(__dirname, '../crawlers/quiz/crawled_quiz_posts.json');

function createQuizPost(postNo, title = '[Hpoint] 퀴즈 정답') {
  return {
    boardId: 'coupon',
    postNo: String(postNo),
    title,
    url: `https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=${postNo}`,
  };
}

function reloadCrawler() {
  delete require.cache[crawlerPath];
  return require(crawlerPath);
}

function restoreApiSecret(apiSecretKey) {
  if (apiSecretKey === undefined) {
    delete process.env.API_SECRET_KEY;
  } else {
    process.env.API_SECRET_KEY = apiSecretKey;
  }
}

async function runQuizScenario({
  dryRun = false,
  posts = [createQuizPost(1)],
  body = '정답: 4',
  dbDuplicatePostNos = [],
  batchOutcome = 'success',
} = {}) {
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
  const dbCheckUrls = [];
  const registrationPayloads = [];
  const detailUrls = [];
  const logs = [];
  const delays = [];

  reader.fetchBoardPosts = async () => posts;
  reader.fetchPostBody = async url => {
    detailUrls.push(url);
    return typeof body === 'function' ? body(url) : body;
  };
  axios.post = async (url, payload) => {
    if (url.endsWith('/links/check')) {
      dbCheckUrls.push(payload.url);
      const postNo = new URL(payload.url).searchParams.get('no');
      return { data: { exists: dbDuplicatePostNos.includes(postNo) } };
    }
    if (!url.endsWith('/links')) {
      throw new Error(`Unexpected URL: ${url}`);
    }

    registrationPayloads.push(payload);
    if (batchOutcome === 'success') {
      return { status: 201 };
    }
    const error = new Error(batchOutcome === 'duplicate' ? 'already exists' : 'LinkHub unavailable');
    if (batchOutcome === 'duplicate') {
      error.response = { status: 409 };
    }
    throw error;
  };
  fs.existsSync = filePath => (filePath === quizCachePath ? true : originalExistsSync(filePath));
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
  console.error = (...args) => logs.push(args.join(' '));
  console.log = (...args) => logs.push(args);
  if (dryRun) {
    delete process.env.API_SECRET_KEY;
  } else {
    process.env.API_SECRET_KEY = 'test-secret';
  }

  try {
    const { run } = reloadCrawler();
    await run({ dryRun, wait: async delay => delays.push(delay) });
    return {
      cacheWrites,
      dbCheckUrls,
      registrationPayloads,
      detailUrls,
      logs,
      delays,
    };
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
    restoreApiSecret(originalApiSecretKey);
    delete require.cache[crawlerPath];
  }
}

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

test('batch 409는 collected canonical source를 cache하고 lastRegistered를 갱신한다', async () => {
  const result = await runQuizScenario({ batchOutcome: 'duplicate' });

  assert.deepEqual(result.registrationPayloads, [{ url: '[Hpoint] : 4', tags: ['퀴즈'] }]);
  assert.equal(result.cacheWrites.length, 1);
  assert.deepEqual(result.cacheWrites[0].posts, [
    'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=1',
  ]);
  assert.match(result.cacheWrites[0].metadata.lastRegistered.Hpoint, /^\d{4}-\d{2}-\d{2}$/);
});

test('일반 batch registration failure는 cache와 lastRegistered를 쓰지 않는다', async () => {
  const result = await runQuizScenario({ batchOutcome: 'failure' });

  assert.deepEqual(result.registrationPayloads, [{ url: '[Hpoint] : 4', tags: ['퀴즈'] }]);
  assert.deepEqual(result.cacheWrites, []);
});

test('dry-run은 list/detail/answer/payload를 구성하지만 DB, registration, cache write는 0회다', async () => {
  const posts = [
    createQuizPost(1, '[KB Pay] 오늘의 퀴즈'),
    createQuizPost(2, '[Hpoint] 퀴즈 정답'),
  ];
  const result = await runQuizScenario({ dryRun: true, posts });

  assert.deepEqual(result.detailUrls, posts.map(post => post.url));
  assert.deepEqual(result.dbCheckUrls, []);
  assert.deepEqual(result.registrationPayloads, []);
  assert.deepEqual(result.cacheWrites, []);
  assert.equal(
    result.logs.some(args => Array.isArray(args)
      && args[0] === '[DRY_RUN] 전송 데이터:'
      && args[1]?.url === '[KB Pay] : 4\n[Hpoint] : 4'),
    true
  );
  assert.equal(result.delays.filter(delay => delay >= 3000).length, 2);
});

test('DB duplicate post는 canonical source를 cache하고 category lastRegistered를 갱신한다', async () => {
  const result = await runQuizScenario({ dbDuplicatePostNos: ['1'] });

  assert.deepEqual(result.dbCheckUrls, [
    'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=1',
  ]);
  assert.deepEqual(result.registrationPayloads, []);
  assert.equal(result.detailUrls.length, 0);
  assert.equal(result.cacheWrites.length, 1);
  assert.deepEqual(result.cacheWrites[0].posts, [
    'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=1',
  ]);
  assert.match(result.cacheWrites[0].metadata.lastRegistered.Hpoint, /^\d{4}-\d{2}-\d{2}$/);
});

test('API 오류 로그는 status와 문자열 code/message만 남기고 raw body를 제거한다', async () => {
  const originalAxiosPost = axios.post;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  const errors = [];

  axios.post = async () => {
    const error = new Error('request failed with private context');
    error.response = {
      status: 500,
      data: {
        code: 'BACKEND_FAILURE',
        message: 'temporary failure',
        secret: 'do-not-log-this',
        nested: { token: 'nested-token' },
      },
    };
    throw error;
  };
  console.error = (...args) => errors.push(args.join(' '));
  console.log = () => {};

  try {
    const result = await registerQuizBatchToAPI([
      { category: 'Hpoint', answer: '4' },
    ], 'test-secret');
    const output = errors.join('\n');

    assert.deepEqual(result, { success: 0, failed: 1, skipped: 0 });
    assert.match(output, /500/);
    assert.match(output, /BACKEND_FAILURE/);
    assert.match(output, /temporary failure/);
    assert.doesNotMatch(output, /do-not-log-this|nested-token|secret|nested|private context/);
  } finally {
    axios.post = originalAxiosPost;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
  }
});

test('module import만으로 실행하거나 파일을 쓰지 않는다', () => {
  const script = [
    "const fs = require('node:fs');",
    "fs.writeFileSync = () => { throw new Error('unexpected write'); };",
    "require('./crawlers/quiz/crawler');",
  ].join('');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, API_SECRET_KEY: '' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
