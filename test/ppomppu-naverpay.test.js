const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const axios = require('axios');
const {
  selectNaverPayPosts,
  createPostKeySet,
} = require('../crawlers/ppomppu-naverpay/crawler');
const reader = require('../crawlers/shared/ppomppu-reader');

const crawlerPath = require.resolve('../crawlers/ppomppu-naverpay/crawler');
const cachePath = path.join(__dirname, '../crawlers/ppomppu-naverpay/crawled_posts.json');

function createPost(postNo, title = `[네이버페이] ${postNo}`) {
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
    createPost(1, '[네이버페이] 빈 본문'),
    createPost(2, '[네이버페이] 정상 본문'),
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

  try {
    const { run } = reloadCrawler();
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

test('외부 URL의 DB duplicate와 registered/409만 terminal cache하고 DB/등록 failure는 남긴다', async () => {
  const originalFetchBoardPosts = reader.fetchBoardPosts;
  const originalFetchPostBody = reader.fetchPostBody;
  const originalExtractExternalUrls = reader.extractExternalUrls;
  const originalAxiosPost = axios.post;
  const originalExistsSync = fs.existsSync;
  const originalReadFileSync = fs.readFileSync;
  const originalWriteFileSync = fs.writeFileSync;
  const originalSetTimeout = global.setTimeout;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  const originalApiSecretKey = process.env.API_SECRET_KEY;
  const checkUrls = [];
  const registrationUrls = [];
  const cacheWrites = [];
  const delays = [];

  reader.fetchBoardPosts = async () => [
    createPost(10),
    createPost(11),
    createPost(12),
    createPost(13),
  ];
  reader.fetchPostBody = async url => `body-${new URL(url).searchParams.get('no')}`;
  reader.extractExternalUrls = body => ({
    'body-10': ['https://external.example/db-duplicate'],
    'body-11': [
      'https://external.example/registered',
      'https://external.example/http-409',
    ],
    'body-12': ['https://external.example/failure'],
    'body-13': ['https://external.example/db-error'],
  }[body]);
  axios.post = async (url, payload) => {
    if (url.endsWith('/links/check')) {
      checkUrls.push(payload.url);
      if (payload.url.endsWith('/db-error')) {
        throw new Error('DB check timeout');
      }
      return { data: { exists: payload.url.endsWith('/db-duplicate') } };
    }
    if (!url.endsWith('/links')) {
      throw new Error(`Unexpected URL: ${url}`);
    }

    registrationUrls.push(payload.url);
    if (payload.url.endsWith('/registered')) {
      return { status: 201 };
    }
    if (payload.url.endsWith('/http-409')) {
      const error = new Error('already exists');
      error.response = { status: 409 };
      throw error;
    }
    throw new Error('LinkHub unavailable');
  };
  fs.existsSync = filePath => (filePath === cachePath ? true : originalExistsSync(filePath));
  fs.readFileSync = (filePath, ...args) => (
    filePath === cachePath ? '[]' : originalReadFileSync(filePath, ...args)
  );
  fs.writeFileSync = (filePath, contents, ...args) => {
    if (filePath === cachePath) {
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

  try {
    const { run } = reloadCrawler();
    await run({ wait: async delay => delays.push(delay) });

    assert.deepEqual(checkUrls, [
      'https://external.example/db-duplicate',
      'https://external.example/registered',
      'https://external.example/http-409',
      'https://external.example/failure',
      'https://external.example/db-error',
    ]);
    assert.deepEqual(registrationUrls, [
      'https://external.example/registered',
      'https://external.example/http-409',
      'https://external.example/failure',
    ]);
    assert.deepEqual(cacheWrites, [[
      'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=10',
      'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=11',
    ]]);
    assert.equal(delays.filter(delay => delay >= 3000).length, 4);
  } finally {
    reader.fetchBoardPosts = originalFetchBoardPosts;
    reader.fetchPostBody = originalFetchPostBody;
    reader.extractExternalUrls = originalExtractExternalUrls;
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
});

test('dry-run은 상세 수집과 payload 출력을 수행하지만 DB, 등록, cache write는 하지 않는다', async () => {
  const originalFetchBoardPosts = reader.fetchBoardPosts;
  const originalFetchPostBody = reader.fetchPostBody;
  const originalExtractExternalUrls = reader.extractExternalUrls;
  const originalAxiosPost = axios.post;
  const originalExistsSync = fs.existsSync;
  const originalReadFileSync = fs.readFileSync;
  const originalWriteFileSync = fs.writeFileSync;
  const originalSetTimeout = global.setTimeout;
  const originalConsoleLog = console.log;
  const originalApiSecretKey = process.env.API_SECRET_KEY;
  const logs = [];
  const detailUrls = [];
  const delays = [];
  let apiCalls = 0;
  let cacheWrites = 0;

  reader.fetchBoardPosts = async () => [createPost(20), createPost(21)];
  reader.fetchPostBody = async url => {
    detailUrls.push(url);
    return '본문';
  };
  reader.extractExternalUrls = () => ['https://external.example/dry-run'];
  axios.post = async () => {
    apiCalls += 1;
    throw new Error('dry-run must not call API');
  };
  fs.existsSync = filePath => (filePath === cachePath ? true : originalExistsSync(filePath));
  fs.readFileSync = (filePath, ...args) => (
    filePath === cachePath ? '[]' : originalReadFileSync(filePath, ...args)
  );
  fs.writeFileSync = (filePath, contents, ...args) => {
    if (filePath === cachePath) {
      cacheWrites += 1;
      return;
    }
    return originalWriteFileSync(filePath, contents, ...args);
  };
  global.setTimeout = callback => {
    callback();
    return 0;
  };
  console.log = (...args) => logs.push(args.join(' '));
  delete process.env.API_SECRET_KEY;

  try {
    const { run } = reloadCrawler();
    await run({ dryRun: true, wait: async delay => delays.push(delay) });

    assert.deepEqual(detailUrls, [createPost(20).url, createPost(21).url]);
    assert.equal(logs.filter(message => message.includes('[DRY_RUN] https://external.example/dry-run')).length, 2);
    assert.equal(apiCalls, 0);
    assert.equal(cacheWrites, 0);
    assert.equal(delays.filter(delay => delay >= 3000).length, 2);
  } finally {
    reader.fetchBoardPosts = originalFetchBoardPosts;
    reader.fetchPostBody = originalFetchPostBody;
    reader.extractExternalUrls = originalExtractExternalUrls;
    axios.post = originalAxiosPost;
    fs.existsSync = originalExistsSync;
    fs.readFileSync = originalReadFileSync;
    fs.writeFileSync = originalWriteFileSync;
    global.setTimeout = originalSetTimeout;
    console.log = originalConsoleLog;
    restoreApiSecret(originalApiSecretKey);
    delete require.cache[crawlerPath];
  }
});

test('API secret이 없는 non-dry CLI 실행은 non-zero로 종료한다', () => {
  const result = spawnSync(process.execPath, ['crawlers/ppomppu-naverpay/crawler.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, API_SECRET_KEY: '' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /API_SECRET_KEY 환경변수가 설정되지 않았습니다/);
});

test('module import만으로 실행하거나 파일을 쓰지 않는다', () => {
  const script = [
    "const fs = require('node:fs');",
    "fs.writeFileSync = () => { throw new Error('unexpected write'); };",
    "require('./crawlers/ppomppu-naverpay/crawler');",
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
