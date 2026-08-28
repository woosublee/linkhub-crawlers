const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const axios = require('axios');
const reader = require('../crawlers/shared/ppomppu-reader');
const registrationOutcome = require('../crawlers/shared/registration-outcome');
const { normalizeUrl } = require('../crawlers/ppomppu-jjizzle/crawler');

const crawlerPath = require.resolve('../crawlers/ppomppu-jjizzle/crawler');
const cachePath = path.join(__dirname, '../crawlers/ppomppu-jjizzle/crawled_posts.json');

function createPost(boardId, postNo, title, extraParams = '') {
  return {
    boardId,
    postNo: String(postNo),
    title,
    url: `https://www.ppomppu.co.kr/zboard/view.php?id=${boardId}${extraParams}&no=${postNo}`,
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

test('검색과 pagination 파라미터를 제거한다', () => {
  const normalized = normalizeUrl(
    'https://www.ppomppu.co.kr/zboard/view.php?id=money&page=1&divpage=98&search_type=name&keyword=x&no=547011'
  );

  assert.equal(
    normalized,
    'https://www.ppomppu.co.kr/zboard/view.php?id=money&no=547011'
  );
});

test('실제 run 경로에서 등록 성공, 409, DB 중복만 캐시하고 실패는 재시도 대상으로 남긴다', async () => {
  const originalFetchBoardPosts = reader.fetchBoardPosts;
  const originalAxiosPost = axios.post;
  const originalShouldCacheSingleResult = registrationOutcome.shouldCacheSingleResult;
  const originalExistsSync = fs.existsSync;
  const originalReadFileSync = fs.readFileSync;
  const originalWriteFileSync = fs.writeFileSync;
  const originalSetTimeout = global.setTimeout;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  const originalApiSecretKey = process.env.API_SECRET_KEY;
  const cacheWrites = [];
  const registrationPayloads = [];
  const cacheDecisions = [];

  reader.fetchBoardPosts = async (_sourceUrl, boardId) => {
    if (boardId === 'money') {
      return [];
    }

    return [
      createPost('phone', 50, '기존 legacy 캐시'),
      createPost('phone', 100, '등록 성공', '&page=1&divpage=2&search_type=name&keyword=x'),
      createPost('phone', 101, '409 중복'),
      createPost('phone', 102, '등록 실패'),
      createPost('phone', 103, 'DB 중복'),
      createPost('phone', 104, 'sponsor 제외', '&sponsor=1'),
    ];
  };
  axios.post = async (url, payload) => {
    if (url.endsWith('/links/check')) {
      return { data: { exists: payload.url.endsWith('no=103') } };
    }
    if (!url.endsWith('/links')) {
      throw new Error(`Unexpected URL: ${url}`);
    }

    registrationPayloads.push(payload);
    if (payload.url.endsWith('no=100')) {
      return { status: 201 };
    }
    if (payload.url.endsWith('no=101')) {
      const error = new Error('already exists');
      error.response = { status: 409 };
      throw error;
    }
    throw new Error('LinkHub unavailable');
  };
  registrationOutcome.shouldCacheSingleResult = result => {
    cacheDecisions.push(result);
    return originalShouldCacheSingleResult(result);
  };
  fs.existsSync = filePath => (
    filePath === cachePath ? true : originalExistsSync(filePath)
  );
  fs.readFileSync = (filePath, ...args) => (
    filePath === cachePath
      ? JSON.stringify([
        'https://www.ppomppu.co.kr/zboard/view.php?id=phone&page=7&divpage=3&no=50',
      ])
      : originalReadFileSync(filePath, ...args)
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
    await run();

    assert.deepEqual(
      registrationPayloads.map(payload => payload.url),
      [
        'https://www.ppomppu.co.kr/zboard/view.php?id=phone&no=100',
        'https://www.ppomppu.co.kr/zboard/view.php?id=phone&no=101',
        'https://www.ppomppu.co.kr/zboard/view.php?id=phone&no=102',
      ]
    );
    assert.deepEqual(registrationPayloads[0], {
      url: 'https://www.ppomppu.co.kr/zboard/view.php?id=phone&no=100',
      title: '등록 성공',
      description: '휴대폰포럼 - 쥐즐',
      thumbnail: '/icon_app_20160427.png',
    });
    assert.deepEqual(cacheDecisions, ['registered', 'duplicate', 'failed']);
    assert.deepEqual(cacheWrites, [[
      'https://www.ppomppu.co.kr/zboard/view.php?id=phone&page=7&divpage=3&no=50',
      'https://www.ppomppu.co.kr/zboard/view.php?id=phone&no=100',
      'https://www.ppomppu.co.kr/zboard/view.php?id=phone&no=101',
      'https://www.ppomppu.co.kr/zboard/view.php?id=phone&no=103',
    ]]);
  } finally {
    reader.fetchBoardPosts = originalFetchBoardPosts;
    axios.post = originalAxiosPost;
    registrationOutcome.shouldCacheSingleResult = originalShouldCacheSingleResult;
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

test('dry-run은 두 Reader 목록과 후보를 수집하지만 DB, 등록 API, 캐시를 변경하지 않는다', async () => {
  const originalFetchBoardPosts = reader.fetchBoardPosts;
  const originalAxiosPost = axios.post;
  const originalExistsSync = fs.existsSync;
  const originalReadFileSync = fs.readFileSync;
  const originalWriteFileSync = fs.writeFileSync;
  const originalConsoleLog = console.log;
  const originalApiSecretKey = process.env.API_SECRET_KEY;
  const readerCalls = [];
  const logs = [];
  let apiCalls = 0;
  let cacheWrites = 0;

  reader.fetchBoardPosts = async (sourceUrl, boardId) => {
    readerCalls.push([sourceUrl, boardId]);
    return [createPost(boardId, boardId === 'phone' ? 200 : 300, `${boardId} 후보`)];
  };
  axios.post = async () => {
    apiCalls += 1;
    throw new Error('dry-run must not call API');
  };
  fs.existsSync = filePath => (
    filePath === cachePath ? true : originalExistsSync(filePath)
  );
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
  console.log = (...args) => logs.push(args.join(' '));
  delete process.env.API_SECRET_KEY;

  try {
    const { run } = reloadCrawler();
    await run({ dryRun: true });

    assert.deepEqual(readerCalls, [
      [
        'https://www.ppomppu.co.kr/zboard/zboard.php?search_type=name&id=phone&page_num=30&keyword=%C1%E3%C1%F1',
        'phone',
      ],
      [
        'https://www.ppomppu.co.kr/zboard/zboard.php?search_type=name&id=money&page_num=30&keyword=%C1%E3%C1%F1',
        'money',
      ],
    ]);
    assert.equal(apiCalls, 0);
    assert.equal(cacheWrites, 0);
    assert.equal(
      logs.some(message => message.includes('[DRY_RUN] phone 후보') && message.includes('id=phone&no=200')),
      true
    );
    assert.equal(
      logs.some(message => message.includes('[DRY_RUN] money 후보') && message.includes('id=money&no=300')),
      true
    );
  } finally {
    reader.fetchBoardPosts = originalFetchBoardPosts;
    axios.post = originalAxiosPost;
    fs.existsSync = originalExistsSync;
    fs.readFileSync = originalReadFileSync;
    fs.writeFileSync = originalWriteFileSync;
    console.log = originalConsoleLog;
    restoreApiSecret(originalApiSecretKey);
    delete require.cache[crawlerPath];
  }
});

test('한 board Reader 수집 실패를 기록하고 다른 board를 계속 처리한다', async () => {
  const originalFetchBoardPosts = reader.fetchBoardPosts;
  const originalConsoleError = console.error;
  const originalConsoleLog = console.log;
  const errors = [];
  const logs = [];

  reader.fetchBoardPosts = async (_sourceUrl, boardId) => {
    if (boardId === 'phone') {
      throw new Error('Reader timeout');
    }
    return [createPost('money', 400, '재테크 후보')];
  };
  console.error = (...args) => errors.push(args.join(' '));
  console.log = (...args) => logs.push(args.join(' '));

  try {
    const { run } = reloadCrawler();
    await run({ dryRun: true });

    assert.equal(errors.some(message => message.includes('[수집실패]') && message.includes('휴대폰포럼')), true);
    assert.equal(
      logs.some(message => message.includes('[DRY_RUN] 재테크 후보') && message.includes('id=money&no=400')),
      true
    );
  } finally {
    reader.fetchBoardPosts = originalFetchBoardPosts;
    console.error = originalConsoleError;
    console.log = originalConsoleLog;
    delete require.cache[crawlerPath];
  }
});

test('API secret이 없는 non-dry CLI 실행은 non-zero로 종료한다', () => {
  const result = spawnSync(process.execPath, ['crawlers/ppomppu-jjizzle/crawler.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, API_SECRET_KEY: '' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /API_SECRET_KEY 환경변수가 설정되지 않았습니다/);
});
