// ppomppu_jjizzle_crawler.js
// 뽐뿌 phone, money 게시판에서 새 글의 제목/URL을 추출해 description에 '쥐즐'을 넣어 linkhub API에 등록

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const {
  fetchBoardPosts,
  getPostKey,
  toCanonicalPostUrl,
} = require('../shared/ppomppu-reader');
const { shouldCacheSingleResult } = require('../shared/registration-outcome');

const POSTS_PATH = path.join(__dirname, 'crawled_posts.json');
const API_BASE_URL = 'https://linkhub-dev.vercel.app/api';

const targets = [
  {
    name: 'phone',
    boardId: 'phone',
    url: 'https://www.ppomppu.co.kr/zboard/zboard.php?search_type=name&id=phone&page_num=30&keyword=%C1%E3%C1%F1',
    displayName: '휴대폰포럼',
  },
  {
    name: 'money',
    boardId: 'money',
    url: 'https://www.ppomppu.co.kr/zboard/zboard.php?search_type=name&id=money&page_num=30&keyword=%C1%E3%C1%F1',
    displayName: '재테크포럼',
  },
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ppomppu URL 정규화 (volatile 파라미터 제거: divpage, page, search_type, keyword)
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('ppomppu.co.kr')) {
      const params = new URLSearchParams(urlObj.search);
      params.delete('divpage');
      params.delete('page');
      params.delete('search_type');
      params.delete('keyword');
      urlObj.search = params.toString();
      return urlObj.toString();
    }
    return url;
  } catch {
    return url;
  }
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

function createPostKeySet(urls) {
  return new Set(
    (Array.isArray(urls) ? urls : [])
      .map(getPostKey)
      .filter(Boolean)
  );
}

function getPostCacheKey(post) {
  return getPostKey(post.url)
    || (post.boardId && post.postNo ? `${post.boardId}:${post.postNo}` : null);
}

function isCachedPost(post, normalizedUrl, crawledPostUrls, crawledPostKeys) {
  return crawledPostUrls.has(normalizedUrl) || crawledPostKeys.has(getPostCacheKey(post));
}

function cachePost(post, normalizedUrl, crawledPostUrls, crawledPostKeys) {
  crawledPostUrls.add(normalizedUrl);
  const postKey = getPostCacheKey(post);
  if (postKey) {
    crawledPostKeys.add(postKey);
  }
}

async function checkUrlExists(url, apiSecretKey) {
  try {
    const response = await axios.post(`${API_BASE_URL}/links/check`, { url }, {
      headers: { 'x-api-key': apiSecretKey },
    });
    return response.data.exists;
  } catch (error) {
    console.error(`[URL체크실패] ${url}`, error.message);
    return false;
  }
}

async function registerPost(post, normalizedUrl, target, apiSecretKey) {
  try {
    const response = await axios.post(`${API_BASE_URL}/links`, {
      url: normalizedUrl,
      title: post.title,
      description: `${target.displayName} - 쥐즐`,
      thumbnail: '/icon_app_20160427.png',
    }, {
      headers: { 'x-api-key': apiSecretKey },
    });

    if (response.status >= 200 && response.status < 300) {
      console.log(`[등록완료] ${post.title.substring(0, 30)}... → ${response.status}`);
      return 'registered';
    }

    console.error(`[등록실패] ${post.title.substring(0, 30)}... → ${response.status}`);
    return 'failed';
  } catch (error) {
    if (error.response?.status === 409) {
      console.log(`[중복스킵] ${post.title.substring(0, 30)}... → 이미 등록됨`);
      return 'duplicate';
    }

    console.error(`[등록실패] ${post.title.substring(0, 30)}...`, error.message);
    return 'failed';
  }
}

async function run({ dryRun = false } = {}) {
  console.log(`[시작] 쥐즐 크롤러 실행 - ${new Date().toISOString()}`);

  const apiSecretKey = dryRun ? null : process.env.API_SECRET_KEY;
  if (!dryRun && !apiSecretKey) {
    throw new Error('API_SECRET_KEY 환경변수가 설정되지 않았습니다.');
  }

  const crawledPosts = loadCrawledPosts();
  const crawledPostUrls = new Set(crawledPosts.filter(url => typeof url === 'string'));
  const crawledPostKeys = createPostKeySet(crawledPosts);
  const initialSize = crawledPostUrls.size;
  let totalNewPosts = 0;
  let totalSkippedPosts = 0;
  let totalDbSkippedPosts = 0;
  let totalCachedPosts = 0;

  console.log(`[현재상태] 기존 크롤링된 URL 수: ${crawledPostUrls.size}`);

  for (const target of targets) {
    console.log(`[크롤링시작] ${target.displayName} (${target.name})`);

    let posts;
    try {
      posts = await fetchBoardPosts(target.url, target.boardId);
    } catch (error) {
      console.error(`[수집실패] ${target.displayName}`, error.message);
      continue;
    }

    if (!Array.isArray(posts)) {
      console.error(`[수집실패] ${target.displayName} Reader 목록 형식 오류`);
      continue;
    }

    console.log(`[파싱완료] ${target.displayName}에서 ${posts.length}개 게시글 발견`);

    let boardNewPosts = 0;
    let boardSkippedPosts = 0;
    let boardDbSkippedPosts = 0;

    for (const post of posts) {
      if (!post?.url || !post.boardId || !post.postNo) {
        continue;
      }

      const normalizedUrl = normalizeUrl(post.url);
      const canonicalUrl = toCanonicalPostUrl(post.boardId, post.postNo);
      const postLabel = post.title.substring(0, 30);

      if (isCachedPost(post, normalizedUrl, crawledPostUrls, crawledPostKeys)) {
        console.log(`[로컬중복] ${postLabel}...`);
        boardSkippedPosts += 1;
        totalSkippedPosts += 1;
        continue;
      }

      // sponsor나 consulting이 포함된 URL은 등록하지 않음
      if (normalizedUrl.includes('sponsor') || normalizedUrl.includes('consulting')) {
        console.log(`[제외링크] ${postLabel}... (sponsor/consulting 포함)`);
        boardSkippedPosts += 1;
        totalSkippedPosts += 1;
        continue;
      }

      if (dryRun) {
        console.log(`[DRY_RUN] ${post.title} → ${canonicalUrl}`);
        continue;
      }

      const existsInDb = await checkUrlExists(normalizedUrl, apiSecretKey);
      if (existsInDb) {
        console.log(`[DB중복] ${postLabel}...`);
        cachePost(post, normalizedUrl, crawledPostUrls, crawledPostKeys);
        boardDbSkippedPosts += 1;
        totalDbSkippedPosts += 1;
        totalCachedPosts += 1;
        continue;
      }

      const result = await registerPost(post, normalizedUrl, target, apiSecretKey);
      if (result === 'registered') {
        boardNewPosts += 1;
        totalNewPosts += 1;
      }

      if (shouldCacheSingleResult(result)) {
        cachePost(post, normalizedUrl, crawledPostUrls, crawledPostKeys);
        totalCachedPosts += 1;
      } else {
        console.log(`[캐시보류] ${postLabel}... → 등록 결과를 다시 확인합니다.`);
      }

      await sleep(1000);
    }

    console.log(`[${target.displayName} 완료] 새로 등록: ${boardNewPosts}개, 로컬스킵: ${boardSkippedPosts}개, DB스킵: ${boardDbSkippedPosts}개`);
  }

  if (!dryRun && crawledPostUrls.size > initialSize) {
    fs.writeFileSync(POSTS_PATH, JSON.stringify(Array.from(crawledPostUrls), null, 2));
    console.log(`[저장완료] 크롤링 히스토리 업데이트: ${crawledPostUrls.size}개 URL 저장 (새로 발견: ${crawledPostUrls.size - initialSize}개)`);
  } else if (!dryRun) {
    console.log('[변경없음] 새로운 게시글이 없습니다.');
  }

  console.log(`[종료] 총 새로 등록: ${totalNewPosts}개, 총 캐시완료: ${totalCachedPosts}개, 총 로컬스킵: ${totalSkippedPosts}개, 총 DB스킵: ${totalDbSkippedPosts}개`);
}

if (require.main === module) {
  run({ dryRun: process.env.DRY_RUN === 'true' }).catch(error => {
    console.error('[크롤러실행오류]', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  normalizeUrl,
  run,
};
