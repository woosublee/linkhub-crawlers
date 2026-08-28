const axios = require('axios');
const fs = require('fs');
const path = require('path');
const {
  fetchBoardPosts,
  fetchPostBody,
  extractExternalUrls,
  getPostKey,
  toCanonicalPostUrl,
} = require('../shared/ppomppu-reader');
const { shouldCacheAllResults } = require('../shared/registration-outcome');

const COUPON_URL = 'https://www.ppomppu.co.kr/zboard/zboard.php?id=coupon';
const POSTS_PATH = path.join(__dirname, 'crawled_posts.json');
const API_BASE_URL = 'https://linkhub-dev.vercel.app/api';
const DEFAULT_DETAIL_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function selectNaverPayPosts(posts) {
  return Array.isArray(posts)
    ? posts.filter(post => typeof post.title === 'string' && post.title.includes('네이버페이'))
    : [];
}

function createPostKeySet(urls) {
  return new Set(
    (Array.isArray(urls) ? urls : [])
      .map(getPostKey)
      .filter(Boolean)
  );
}

function loadCrawledPosts() {
  if (!fs.existsSync(POSTS_PATH)) {
    console.log('[새파일] 크롤링 히스토리 파일이 없습니다. 새로 생성합니다.');
    return [];
  }

  try {
    const crawledPosts = JSON.parse(fs.readFileSync(POSTS_PATH, 'utf-8'));
    if (!Array.isArray(crawledPosts)) {
      throw new Error('크롤링 히스토리가 배열이 아닙니다.');
    }
    console.log(`[로드완료] 기존 크롤링된 포스트 ${crawledPosts.length}개`);
    return crawledPosts;
  } catch (error) {
    console.error('[로드실패] 기존 파일 파싱 오류:', error.message);
    return [];
  }
}

function getPostCacheKey(post) {
  return getPostKey(post.url)
    || (post.boardId && post.postNo ? `${post.boardId}:${post.postNo}` : null);
}

function isCachedPost(post, crawledPostUrls, crawledPostKeys) {
  return crawledPostUrls.has(post.url) || crawledPostKeys.has(getPostCacheKey(post));
}

async function checkPostExists(postUrl, apiSecretKey) {
  try {
    const response = await axios.post(`${API_BASE_URL}/links/check`, { url: postUrl }, {
      headers: { 'x-api-key': apiSecretKey },
    });
    return { exists: response.data.exists, failed: false };
  } catch (error) {
    console.error(`[게시글체크실패] ${postUrl}`, error.message);
    return { exists: false, failed: true };
  }
}

async function registerExternalUrl(url, apiSecretKey) {
  try {
    const response = await axios.post(`${API_BASE_URL}/links`, {
      url,
      tags: ['NPay적립'],
    }, {
      headers: { 'x-api-key': apiSecretKey },
    });

    if (response.status >= 200 && response.status < 300) {
      console.log(`[등록완료] ${url.substring(0, 50)}... → ${response.status}`);
      return 'registered';
    }

    console.error(`[등록실패] ${url.substring(0, 50)}... → ${response.status}`);
    return 'failed';
  } catch (error) {
    if (error.response?.status === 409) {
      console.log(`[중복스킵] ${url.substring(0, 50)}... → 이미 등록됨`);
      return 'duplicate';
    }

    console.error(`[등록실패] ${url.substring(0, 50)}...`, error.message);
    return 'failed';
  }
}

async function run({
  dryRun = false,
  wait = sleep,
  detailDelayMs = DEFAULT_DETAIL_DELAY_MS,
} = {}) {
  console.log(`[시작] 네이버페이 크롤러 실행 - ${new Date().toISOString()}`);

  const apiSecretKey = process.env.API_SECRET_KEY;
  if (!dryRun && !apiSecretKey) {
    throw new Error('API_SECRET_KEY 환경변수가 설정되지 않았습니다.');
  }

  const crawledPosts = loadCrawledPosts();
  const crawledPostUrls = new Set(crawledPosts.filter(url => typeof url === 'string'));
  const crawledPostKeys = createPostKeySet(crawledPosts);
  const initialSize = crawledPostUrls.size;
  let totalSkippedPosts = 0;
  let totalDbSkippedPosts = 0;
  let totalUrlsRegistered = 0;
  let totalCachedPosts = 0;

  console.log(`[현재상태] 기존 크롤링된 URL 수: ${crawledPostUrls.size}`);
  console.log('[크롤링시작] 네이버페이 게시글 검색');

  let posts;
  try {
    posts = selectNaverPayPosts(await fetchBoardPosts(COUPON_URL, 'coupon'));
  } catch (error) {
    console.error('[수집실패] 쿠폰 게시판', error.message);
    return;
  }

  console.log(`[파싱완료] 네이버페이 게시글 ${posts.length}개 발견`);

  for (const post of posts) {
    const postUrl = toCanonicalPostUrl(post.boardId, post.postNo);
    const postLabel = post.title.substring(0, 30);

    if (!dryRun && isCachedPost(post, crawledPostUrls, crawledPostKeys)) {
      console.log(`[로컬중복] ${postLabel}...`);
      totalSkippedPosts += 1;
      continue;
    }

    try {
      console.log(`[본문파싱] ${postLabel}...`);
      const body = await fetchPostBody(post.url);
      if (typeof body !== 'string' || body.trim() === '') {
        console.error(`[수집실패] ${postUrl} 빈 본문`);
        continue;
      }

      const urls = extractExternalUrls(body);
      if (urls.length === 0) {
        console.log(`[URL없음] ${postLabel}... → URL 없음`);
        continue;
      }

      console.log(`[URL발견] ${urls.length}개 URL 발견`);
      if (dryRun) {
        for (const url of urls) {
          console.log(`[DRY_RUN] ${url}`);
        }
        continue;
      }

      const results = [];
      for (const url of urls) {
        const dbCheck = await checkPostExists(url, apiSecretKey);
        let result;
        if (dbCheck.failed) {
          result = 'failed';
        } else if (dbCheck.exists) {
          console.log(`[DB중복] ${url.substring(0, 50)}...`);
          totalDbSkippedPosts += 1;
          result = 'duplicate';
        } else {
          result = await registerExternalUrl(url, apiSecretKey);
        }

        results.push(result);
        if (result === 'registered') {
          totalUrlsRegistered += 1;
        }
        await wait(1000);
      }

      if (shouldCacheAllResults(results)) {
        crawledPostUrls.add(postUrl);
        crawledPostKeys.add(getPostCacheKey(post));
        totalCachedPosts += 1;
        console.log(`[게시글완료] ${postLabel}... → ${results.length}개 URL 처리`);
      } else {
        console.log(`[캐시보류] ${postLabel}... → 등록 결과를 다시 확인합니다.`);
      }
    } catch (error) {
      console.error(`[수집실패] ${postUrl}`, error.message);
    } finally {
      await wait(detailDelayMs);
    }
  }

  if (!dryRun && crawledPostUrls.size > initialSize) {
    fs.writeFileSync(POSTS_PATH, JSON.stringify(Array.from(crawledPostUrls), null, 2));
    console.log(`[저장완료] 크롤링 히스토리 업데이트: ${crawledPostUrls.size}개 URL 저장`);
  } else if (!dryRun) {
    console.log('[변경없음] 새로운 네이버페이 게시글이 없습니다.');
  }

  console.log(`[종료] 캐시완료 게시글: ${totalCachedPosts}개, 총 URL등록: ${totalUrlsRegistered}개, 총 로컬스킵: ${totalSkippedPosts}개, 총 DB스킵: ${totalDbSkippedPosts}개`);
}

if (require.main === module) {
  run({ dryRun: process.env.DRY_RUN === 'true' }).catch(error => {
    console.error('[크롤러실행오류]', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  run,
  selectNaverPayPosts,
  createPostKeySet,
};
