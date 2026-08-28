// quiz_text_crawler.js
// 뽐뿌 쿠폰 게시판에서 퀴즈 관련 게시글을 크롤링하여 텍스트 카드로 등록

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const {
  fetchBoardPosts,
  fetchPostBody,
  extractQuizAnswer: extractQuizAnswerFromBody,
  getPostKey,
  toCanonicalPostUrl,
} = require('../shared/ppomppu-reader');

const QUIZ_CATEGORIES = {
  'KB Pay': ['[KB Pay]'],
  'KB스타뱅킹': ['[KB스타뱅킹] 스타퀴즈'],
  '신한슈퍼SOL': ['[신한슈퍼SOL]', '[신한슈퍼쏠]'],
  '신한쏠야구': ['[신한쏠] 야구상식', '[신한SOL] 야구상식'],
  '신한SOL퀴즈팡팡': ['[신한플레이] 퀴즈팡팡', '[신한쏠] 퀴즈팡팡'],
  Hpoint: ['[Hpoint]', '[h.point]', '[H.point]'],
};

const COUPON_URL = 'https://www.ppomppu.co.kr/zboard/zboard.php?id=coupon';
const QUIZ_POSTS_PATH = path.join(__dirname, 'crawled_quiz_posts.json');
const API_BASE_URL = 'https://linkhub-dev.vercel.app/api';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadQuizData() {
  const emptyData = { posts: [], metadata: { lastRegistered: {} } };

  if (!fs.existsSync(QUIZ_POSTS_PATH)) {
    console.log('[새파일] 퀴즈 크롤링 히스토리 파일이 없습니다. 새로 생성합니다.');
    return emptyData;
  }

  try {
    const loaded = JSON.parse(fs.readFileSync(QUIZ_POSTS_PATH, 'utf-8'));
    if (Array.isArray(loaded)) {
      console.log(`[로드완료] 기존 크롤링된 퀴즈 포스트 ${loaded.length}개 (구식 배열 형식)`);
      return { posts: loaded, metadata: { lastRegistered: {} } };
    }
    if (loaded && Array.isArray(loaded.posts)) {
      const metadata = loaded.metadata && typeof loaded.metadata === 'object'
        ? loaded.metadata
        : {};
      const lastRegistered = metadata.lastRegistered && typeof metadata.lastRegistered === 'object'
        ? metadata.lastRegistered
        : {};
      console.log(`[로드완료] 기존 크롤링된 퀴즈 포스트 ${loaded.posts.length}개`);
      return { posts: loaded.posts, metadata: { ...metadata, lastRegistered } };
    }
    throw new Error('알 수 없는 형식');
  } catch (error) {
    console.error('[로드실패] 기존 파일 파싱 오류:', error.message);
    return emptyData;
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

function isCachedPost(post, crawledPostKeys) {
  const key = getPostCacheKey(post);
  return Boolean(key && crawledPostKeys.has(key));
}

async function checkQuizPostExists(postUrl, apiSecretKey) {
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

function isCategoryRegisteredToday(quizData, category, todayDate) {
  return quizData.metadata.lastRegistered[category] === todayDate;
}

function categorizeQuiz(title) {
  if (typeof title !== 'string') {
    return null;
  }

  const normalizedTitle = title.replace(/\s+/g, '');
  for (const [category, keywords] of Object.entries(QUIZ_CATEGORIES)) {
    for (const keyword of keywords) {
      if (normalizedTitle.includes(keyword.replace(/\s+/g, ''))) {
        return category;
      }
    }
  }

  return null;
}

function selectQuizPosts(posts) {
  return Array.isArray(posts)
    ? posts.filter(post => post && categorizeQuiz(post.title))
    : [];
}

function isPostDateToday(title, kstDate) {
  const dateMatch = title.match(/(\d{1,2})\/(\d{1,2})|(\d{1,2})월(\d{1,2})일/);
  if (!dateMatch) {
    return true;
  }

  const month = Number(dateMatch[1] || dateMatch[3]);
  const day = Number(dateMatch[2] || dateMatch[4]);
  return month === kstDate.month && day === kstDate.day;
}

function collectQuizInfo(category, answer, originalTitle, postLink) {
  return {
    displayText: `${category} : ${answer}`,
    category,
    answer,
    originalTitle,
    postLink,
  };
}

function formatCombinedDescription(quizInfoList) {
  return quizInfoList
    .map(quizInfo => `[${quizInfo.category}] : ${quizInfo.answer}`)
    .join('\n');
}

async function registerQuizBatchToAPI(quizInfoList, apiSecretKey) {
  if (quizInfoList.length === 0) {
    console.log('[통합등록] 등록할 퀴즈가 없습니다.');
    return { success: 0, failed: 0, skipped: 0 };
  }

  const combinedDescription = formatCombinedDescription(quizInfoList);
  const payload = { url: combinedDescription.trim(), tags: ['퀴즈'] };
  console.log(`[통합등록시작] ${quizInfoList.length}개 퀴즈를 하나의 텍스트 카드로 등록합니다.`);
  console.log('[API요청] 전송 데이터:', payload);

  try {
    const response = await axios.post(`${API_BASE_URL}/links`, payload, {
      headers: { 'x-api-key': apiSecretKey },
    });
    console.log(`[통합등록완료] ${quizInfoList.length}개 퀴즈를 하나의 텍스트 카드로 등록 (${response.status})`);
    return { success: 1, failed: 0, skipped: 0 };
  } catch (error) {
    if (error.response?.status === 409) {
      console.log('[중복스킵] 오늘의 퀴즈 → 이미 등록됨');
      return { success: 0, failed: 0, skipped: 1 };
    }

    console.error('[통합등록실패]', error.message);
    if (error.response) {
      console.error(`[에러상세] Status: ${error.response.status}, Data:`, error.response.data);
    }
    return { success: 0, failed: 1, skipped: 0 };
  }
}

function getKstDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    today: `${values.year}-${values.month}-${values.day}`,
    month: Number(values.month),
    day: Number(values.day),
  };
}

async function run({ dryRun = false } = {}) {
  console.log(`[시작] 퀴즈 텍스트 카드 크롤러 실행 - ${new Date().toISOString()}`);

  const apiSecretKey = process.env.API_SECRET_KEY;
  if (!dryRun && !apiSecretKey) {
    throw new Error('API_SECRET_KEY 환경변수가 설정되지 않았습니다.');
  }

  const quizData = loadQuizData();
  const crawledQuizPostsSet = new Set(quizData.posts.filter(post => typeof post === 'string'));
  const crawledQuizPostKeys = createPostKeySet(quizData.posts);
  const initialCacheSize = crawledQuizPostsSet.size;
  let totalNewPosts = 0;
  let totalSkippedPosts = 0;
  let totalDbSkippedPosts = 0;
  let totalQuizInfoRegistered = 0;
  let totalCachedPosts = 0;
  let canCacheAllCollected = true;
  const collectedQuizInfo = [];
  const foundCategories = new Set();
  const kstDate = getKstDate();
  const today = kstDate.today;

  console.log(`[현재상태] 기존 크롤링된 퀴즈 포스트 수: ${crawledQuizPostsSet.size}`);
  console.log(`[오늘날짜] ${today} (KST 기준)`);
  console.log('[크롤링시작] 퀴즈 관련 게시글 검색');

  let posts;
  try {
    posts = selectQuizPosts(await fetchBoardPosts(COUPON_URL, 'coupon'));
  } catch (error) {
    console.error('[수집실패] 쿠폰 게시판', error.message);
    return;
  }

  console.log(`[파싱완료] 퀴즈 관련 게시글 ${posts.length}개 발견`);

  for (const post of posts) {
    const category = categorizeQuiz(post.title);
    const postLabel = post.title.substring(0, 30);
    const postUrl = toCanonicalPostUrl(post.boardId, post.postNo);

    if (!dryRun && isCachedPost(post, crawledQuizPostKeys)) {
      console.log(`[로컬중복] ${postLabel}...`);
      totalSkippedPosts += 1;
      continue;
    }

    if (foundCategories.has(category)) {
      console.log(`[카테고리중복] ${postLabel}... → ${category} 이미 찾음`);
      continue;
    }

    if (!dryRun && isCategoryRegisteredToday(quizData, category, today)) {
      console.log(`[카테고리재등록방지] ${postLabel}... → ${category} 오늘 이미 등록됨`);
      continue;
    }

    if (!isPostDateToday(post.title, kstDate)) {
      console.log(`[날짜불일치] ${postLabel}... → 오늘 날짜가 아님`);
      continue;
    }

    if (!dryRun) {
      const dbCheck = await checkQuizPostExists(postUrl, apiSecretKey);
      if (dbCheck.exists) {
        console.log(`[DB중복] ${postLabel}...`);
        crawledQuizPostsSet.add(postUrl);
        crawledQuizPostKeys.add(getPostCacheKey(post));
        quizData.metadata.lastRegistered[category] = today;
        foundCategories.add(category);
        totalDbSkippedPosts += 1;
        totalCachedPosts += 1;
        continue;
      }
      canCacheAllCollected &&= !dbCheck.failed;
    }

    try {
      console.log(`[본문파싱] ${postLabel}...`);
      const body = await fetchPostBody(post.url);
      if (typeof body !== 'string' || body.trim() === '') {
        console.error(`[수집실패] ${postUrl} 빈 본문`);
        continue;
      }

      const answerData = extractQuizAnswerFromBody(body);
      if (!answerData || !answerData.answer) {
        console.log(`[정답없음] ${postLabel}... → 정답 정보 없음`);
        continue;
      }

      console.log(`[정답발견] ${answerData.answer}`);
      collectedQuizInfo.push(collectQuizInfo(category, answerData.answer, post.title, postUrl));
      foundCategories.add(category);
      totalNewPosts += 1;
      console.log(`[카테고리완료] ${category} → ${foundCategories.size}/6 완료`);
    } catch (error) {
      console.error(`[수집실패] ${postUrl}`, error.message);
    } finally {
      await sleep(2000);
    }
  }

  if (collectedQuizInfo.length > 0) {
    console.log(`\n[수집된 퀴즈 정보] 총 ${collectedQuizInfo.length}개`);
    console.log('==========================================');
    collectedQuizInfo.forEach((info, index) => console.log(`${index + 1}. ${info.displayText}`));
    console.log('==========================================\n');

    const combinedDescription = formatCombinedDescription(collectedQuizInfo);
    if (dryRun) {
      console.log('[DRY_RUN] 전송 데이터:', { url: combinedDescription.trim(), tags: ['퀴즈'] });
    } else {
      const batchResult = await registerQuizBatchToAPI(collectedQuizInfo, apiSecretKey);
      totalQuizInfoRegistered = batchResult.success;
      if ((batchResult.success > 0 || batchResult.skipped > 0) && canCacheAllCollected) {
        for (const info of collectedQuizInfo) {
          crawledQuizPostsSet.add(info.postLink);
          crawledQuizPostKeys.add(getPostKey(info.postLink));
          quizData.metadata.lastRegistered[info.category] = today;
          totalCachedPosts += 1;
        }
      } else if (batchResult.success > 0 || batchResult.skipped > 0) {
        console.log('[캐시보류] 게시글체크 실패로 등록 결과를 다시 확인합니다.');
      }
    }
  }

  if (!dryRun && crawledQuizPostsSet.size > initialCacheSize) {
    quizData.posts = Array.from(crawledQuizPostsSet);
    fs.writeFileSync(QUIZ_POSTS_PATH, JSON.stringify(quizData, null, 2));
    console.log(`[저장완료] 퀴즈 크롤링 히스토리 업데이트: ${quizData.posts.length}개 포스트 저장`);
  } else if (!dryRun) {
    console.log('[변경없음] 새로운 퀴즈 게시글이 없습니다.');
  }

  console.log(`[종료] 캐시완료 게시글: ${totalCachedPosts}개, 총 새 게시글: ${totalNewPosts}개, 총 퀴즈정보등록: ${totalQuizInfoRegistered}개, 총 로컬스킵: ${totalSkippedPosts}개, 총 DB스킵: ${totalDbSkippedPosts}개`);
}

if (require.main === module) {
  run({ dryRun: process.env.DRY_RUN === 'true' }).catch(error => {
    console.error('[크롤러실행오류]', error.message);
  });
}

module.exports = {
  run,
  categorizeQuiz,
  selectQuizPosts,
  createPostKeySet,
};
