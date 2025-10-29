// quiz_text_crawler.js
// 뽐뿌 쿠폰 게시판에서 퀴즈 관련 게시글을 크롤링하여 텍스트 카드로 등록

const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.5993.70 Safari/537.36',
];

// 퀴즈 카테고리별 키워드 정의 (정확히 6개)
const QUIZ_CATEGORIES = {
  'KB Pay': ['[KB Pay]'],
  'KB스타뱅킹': ['[KB스타뱅킹] 스타퀴즈'],
  '신한슈퍼SOL': ['[신한슈퍼SOL]'],
  '신한쏠야구': ['[신한쏠] 야구상식'],
  '신한SOL퀴즈팡팡': ['[신한플레이] 퀴즈팡팡'],
  'Hpoint': ['[Hpoint]', '[h.point]', '[H.point]']
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const QUIZ_POSTS_PATH = './crawled_quiz_posts.json';
const API_BASE_URL = 'https://linkhub-dev.vercel.app/api';
const API_SECRET_KEY = process.env.API_SECRET_KEY;

if (!API_SECRET_KEY) {
  console.error('[오류] API_SECRET_KEY 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

let crawledQuizPosts = [];

// 기존 크롤링된 퀴즈 포스트 로드
if (fs.existsSync(QUIZ_POSTS_PATH)) {
  try {
    crawledQuizPosts = JSON.parse(fs.readFileSync(QUIZ_POSTS_PATH, 'utf-8'));
    console.log(`[로드완료] 기존 크롤링된 퀴즈 포스트 ${crawledQuizPosts.length}개`);
  } catch (e) {
    console.error('[로드실패] 기존 파일 파싱 오류:', e.message);
    crawledQuizPosts = [];
  }
} else {
  console.log('[새파일] 퀴즈 크롤링 히스토리 파일이 없습니다. 새로 생성합니다.');
}

const crawledQuizPostsSet = new Set(crawledQuizPosts);

// 데이터베이스에서 URL 존재 여부 확인
async function checkQuizPostExists(postLink) {
  try {
    const response = await axios.post(`${API_BASE_URL}/links/check`, { url: postLink }, {
      headers: {
        'x-api-key': API_SECRET_KEY
      }
    });
    return response.data.exists;
  } catch (error) {
    console.error(`[게시글체크실패] ${postLink}`, error.message);
    // API 호출 실패 시 로컬 캐시로 판단
    return crawledQuizPostsSet.has(postLink);
  }
}

// 퀴즈 관련 게시글 검색
async function fetchQuizPosts() {
  const browser = await puppeteer.launch({ 
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true
  });
  const page = await browser.newPage();
  const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
  await page.setUserAgent(randomUA);
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  });
  
  try {
    await page.goto('https://www.ppomppu.co.kr/zboard/zboard.php?id=coupon', { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (e) {
    console.error('[페이지로드실패] 쿠폰 게시판', e.message);
    await browser.close();
    return [];
  }

  const posts = await page.evaluate((quizCategories) => {
    const rows = Array.from(document.querySelectorAll('#revolution_main_table tr'));
    return rows.map(row => {
      const titleSpan = row.querySelector('td.baseList-space.title a span');
      if (!titleSpan) return null;
      
      const title = titleSpan.textContent.trim();
      
      // 퀴즈 관련 키워드가 포함된 게시글인지 확인 (띄어쓰기 무관)
      const normalizedTitle = title.replace(/\s+/g, '');
      const isQuizPost = Object.values(quizCategories).some(categoryKeywords => 
        categoryKeywords.some(keyword => {
          const normalizedKeyword = keyword.replace(/\s+/g, '');
          return normalizedTitle.includes(normalizedKeyword);
        })
      );
      
      if (isQuizPost) {
        const link = row.querySelector('td.baseList-space.title a')?.getAttribute('href');
        let fullLink = null;
        if (link) {
          fullLink = link.startsWith('/')
            ? 'https://www.ppomppu.co.kr' + link
            : 'https://www.ppomppu.co.kr/zboard/' + link;
        }
        return {
          title: title,
          link: fullLink,
        };
      }
      return null;
    }).filter(Boolean);
  }, QUIZ_CATEGORIES);

  await browser.close();
  return posts;
}

// 게시글 본문에서 퀴즈 정답 추출
async function extractQuizAnswer(postLink, title) {
  const browser = await puppeteer.launch({ 
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true
  });
  const page = await browser.newPage();
  const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
  await page.setUserAgent(randomUA);
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  });
  
  try {
    // 더 빠른 로딩을 위해 waitUntil을 'domcontentloaded'로 변경
    await page.goto(postLink, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    // 여러 셀렉터를 시도하여 본문 찾기
    let content = '';
    const selectors = ['td.board-contents', '#readArea', '.board-contents', '.content'];
    
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        const el = await page.$(selector);
        if (el) {
          content = await page.evaluate(el => el.textContent || '', el);
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    if (!content) {
      console.log(`[셀렉터실패] ${postLink} - 모든 셀렉터 실패`);
      return null;
    }
    
    const quizData = await page.evaluate((content) => {
      if (!content || typeof content !== 'string') {
        return null;
      }
      
      // 1. "정답입니다" 다음에 나오는 "정답:" 패턴 (가장 정확한 패턴)
      const answerIsMatch = content.match(/정답\s*입니다[^]*?정답\s*:?\s*([^\n\r]+?)(?=\s*[.!?]|\s*[\n\r]|\s*$)/i);
      if (answerIsMatch) {
        let answer = answerIsMatch[1].trim();
        
        // 줄바꿈이나 문장 끝까지 포함하되, 불필요한 내용 제거
        answer = answer.split(/[\n\r]/)[0].trim();
        
        // "입니다", "입니다." 등 불필요한 문장 끝 부분 제거
        answer = answer.replace(/(?:입니다|입니다\.|\.)$/, '').trim();
        

        
        return {
          answer: answer,
          fullContent: content.substring(0, 500)
        };
      }
      
      // 2. 간단하고 정밀한 정답 추출: "정답:" 다음에 오는 내용을 줄바꿈까지 찾기
      const answerMatch = content.match(/정답\s*:?\s*([^\n\r]+?)(?=\s*[.!?]|\s*[\n\r]|\s*$)/i);
      if (answerMatch) {
        let answer = answerMatch[1].trim();
        
        // 줄바꿈이나 문장 끝까지 포함하되, 불필요한 내용 제거
        answer = answer.split(/[\n\r]/)[0].trim();
        
        // "입니다", "입니다." 등 불필요한 문장 끝 부분 제거
        answer = answer.replace(/(?:입니다|입니다\.|\.)$/, '').trim();
        
        return {
          answer: answer,
          fullContent: content.substring(0, 500)
        };
      }
      

      
      return null;
    }, content);
    
    await browser.close();
    return quizData;
  } catch (e) {
    console.error(`[본문파싱실패] ${postLink}`, e.message);
    await browser.close();
    return null;
  }
}

// 퀴즈 카테고리 분류 (정확히 6개 카테고리, 띄어쓰기 무관)
function categorizeQuiz(title) {
  // 제목에서 띄어쓰기 제거
  const normalizedTitle = title.replace(/\s+/g, '');
  
  if (normalizedTitle.includes('[KBPay]')) {
    return 'KB Pay';
  } else if (normalizedTitle.includes('[KB스타뱅킹]스타퀴즈')) {
    return 'KB스타뱅킹';
  } else if (normalizedTitle.includes('[신한슈퍼SOL]')) {
    return '신한슈퍼SOL';
  } else if (normalizedTitle.includes('[신한쏠]야구상식')) {
    return '신한쏠야구';
  } else if (normalizedTitle.includes('[신한플레이]퀴즈팡팡')) {
    return '신한SOL퀴즈팡팡';
  } else if (normalizedTitle.includes('[Hpoint]') || normalizedTitle.includes('[h.point]') || normalizedTitle.includes('[H.point]')) {
    return 'Hpoint';
  }
  return null; // 매칭되지 않는 경우
}

// 수집된 퀴즈 정보를 배열에 저장
function collectQuizInfo(category, answer, originalTitle, postLink) {
  const textContent = `${category} : ${answer}`;
  return {
    displayText: textContent,
    category: category,
    answer: answer,
    originalTitle: originalTitle,
    postLink: postLink
  };
}

// 모든 퀴즈 정보를 하나의 텍스트 카드로 API에 등록
async function registerQuizBatchToAPI(quizInfoList) {
  if (quizInfoList.length === 0) {
    console.log('[통합등록] 등록할 퀴즈가 없습니다.');
    return { success: 0, failed: 0, skipped: 0 };
  }

  console.log(`[통합등록시작] ${quizInfoList.length}개 퀴즈를 하나의 텍스트 카드로 등록합니다.`);
  
  try {
    // 모든 퀴즈 정보를 하나의 description으로 합치기 (정답만 간단하게)
    let combinedDescription = '';
    
    quizInfoList.forEach((quizInfo, index) => {
      combinedDescription += `[${quizInfo.category}] : ${quizInfo.answer}\n`;
    });
    
    // 모든 카테고리 태그를 하나로 합치기
    const allCategories = [...new Set(quizInfoList.map(info => info.category))];
    const combinedTags = ['퀴즈'];
    
    // 하나의 텍스트 카드로 API에 등록
    console.log(`[API요청] 전송 데이터:`, {
      description: combinedDescription.trim().substring(0, 100) + '...',
      tags: combinedTags
    });
    
    const res = await axios.post(`${API_BASE_URL}/links`, {
      url: combinedDescription.trim(), // 텍스트 카드의 경우 description을 url 필드에 저장
      tags: combinedTags // 모든 카테고리 태그를 하나로 합침
    }, {
      headers: {
        'x-api-key': API_SECRET_KEY
      }
    });

    console.log(`[통합등록완료] ${quizInfoList.length}개 퀴즈를 하나의 텍스트 카드로 등록 (${res.status})`);
    return { success: 1, failed: 0, skipped: 0 };
    
  } catch (e) {
    if (e.response && e.response.status === 409) {
      console.log(`[중복스킵] 오늘의 퀴즈 → 이미 등록됨`);
      return { success: 0, failed: 0, skipped: 1 };
    } else {
      console.error(`[통합등록실패]`, e.message);
      if (e.response) {
        console.error(`[에러상세] Status: ${e.response.status}, Data:`, e.response.data);
      }
      return { success: 0, failed: 1, skipped: 0 };
    }
  }
}

// 실행 예시
if (require.main === module) {
  (async () => {
    console.log(`[시작] 퀴즈 텍스트 카드 크롤러 실행 - ${new Date().toISOString()}`);
    console.log(`[현재상태] 기존 크롤링된 퀴즈 포스트 수: ${crawledQuizPostsSet.size}`);
    
    let newCrawled = false;
    let totalNewPosts = 0;
    let totalSkippedPosts = 0;
    let totalDbSkippedPosts = 0;
    let totalQuizInfoRegistered = 0;
    let collectedQuizInfo = []; // 수집된 퀴즈 정보를 저장할 배열
    let foundCategories = new Set(); // 이미 찾은 카테고리를 추적
    
    // KST 기준으로 오늘 날짜 계산 (UTC+9)
    const now = new Date();
    const kstOffset = 9 * 60; // UTC+9
    const kstDate = new Date(now.getTime() + (kstOffset * 60 * 1000));
    const today = kstDate.toISOString().split('T')[0]; // YYYY-MM-DD 형식
    console.log(`[오늘날짜] ${today} (KST 기준)`);
    
    try {
      console.log('[크롤링시작] 퀴즈 관련 게시글 검색');
      const posts = await fetchQuizPosts();
      console.log(`[파싱완료] 퀴즈 관련 게시글 ${posts.length}개 발견`);
      
      for (const post of posts) {
        if (!post.link) continue;
        
        // 로컬 캐시 체크
        if (crawledQuizPostsSet.has(post.link)) {
          console.log(`[로컬중복] ${post.title.substring(0, 30)}...`);
          totalSkippedPosts++;
          continue;
        }
        
        // 데이터베이스 중복 체크
        const existsInDb = await checkQuizPostExists(post.link);
        if (existsInDb) {
          console.log(`[DB중복] ${post.title.substring(0, 30)}...`);
          totalDbSkippedPosts++;
          // DB에 있으면 로컬 캐시에도 추가
          crawledQuizPostsSet.add(post.link);
          continue;
        }
        
        // 퀴즈 카테고리 분류
        const category = categorizeQuiz(post.title);
        
        // 매칭되지 않는 경우 건너뛰기
        if (!category) {
          console.log(`[카테고리불일치] ${post.title.substring(0, 30)}... → 매칭되는 카테고리 없음`);
          continue;
        }
        
        // 이미 찾은 카테고리인 경우 건너뛰기
        if (foundCategories.has(category)) {
          console.log(`[카테고리중복] ${post.title.substring(0, 30)}... → ${category} 이미 찾음`);
          continue;
        }
        
        // 게시글 제목에서 날짜 추출 (8/10, 8월10일 등)
        const dateMatch = post.title.match(/(\d{1,2})\/(\d{1,2})|(\d{1,2})월(\d{1,2})일/);
        if (dateMatch) {
          let month, day;
          if (dateMatch[1] && dateMatch[2]) {
            // 8/10 형식
            month = parseInt(dateMatch[1]);
            day = parseInt(dateMatch[2]);
          } else if (dateMatch[3] && dateMatch[4]) {
            // 8월10일 형식
            month = parseInt(dateMatch[3]);
            day = parseInt(dateMatch[4]);
          }
          
          if (month && day) {
            // KST 기준으로 현재 월/일 계산 (일관성 유지)
            const currentMonth = kstDate.getMonth() + 1;
            const currentDay = kstDate.getDate();
            
            // 오늘 날짜가 아닌 경우 건너뛰기
            if (month !== currentMonth || day !== currentDay) {
              console.log(`[날짜불일치] ${post.title.substring(0, 30)}... → ${month}/${day} (오늘: ${currentMonth}/${currentDay})`);
              continue;
            }
          }
        }
        
        console.log(`[카테고리] ${category}`);
        
        // 본문에서 퀴즈 정답 추출
        console.log(`[본문파싱] ${post.title.substring(0, 30)}...`);
        
        // KB스타뱅킹인 경우 본문 내용 출력

        
        const quizData = await extractQuizAnswer(post.link, post.title);
        
        if (quizData && quizData.answer) {
          console.log(`[정답발견] ${quizData.answer}`);
          
          // 수집된 퀴즈 정보를 배열에 저장
          const quizInfo = collectQuizInfo(
            category, 
            quizData.answer, 
            post.title, 
            post.link
          );
          
          collectedQuizInfo.push(quizInfo);
          foundCategories.add(category); // 찾은 카테고리로 표시
          totalQuizInfoRegistered++;
          newCrawled = true;
          totalNewPosts++;
          
          // 정답을 성공적으로 찾은 경우에만 로컬 중복 체크에 추가
          crawledQuizPostsSet.add(post.link);
          
          console.log(`[카테고리완료] ${category} → ${foundCategories.size}/6 완료`);
        } else {
          console.log(`[정답없음] ${post.title.substring(0, 30)}... → 정답 정보 없음`);
          // 정답을 찾지 못한 경우 로컬 중복 체크에 추가하지 않음
        }
        await sleep(2000); // 게시글 간 간격
      }
      
      // 수집된 퀴즈 정보를 한번에 출력
      if (collectedQuizInfo.length > 0) {
        console.log(`\n[수집된 퀴즈 정보] 총 ${collectedQuizInfo.length}개`);
        console.log(`==========================================`);
        collectedQuizInfo.forEach((info, index) => {
          console.log(`${index + 1}. ${info.displayText}`);
        });
        console.log(`==========================================\n`);
        
        // 수집된 모든 퀴즈를 하나의 텍스트 카드로 API에 등록
        const batchResult = await registerQuizBatchToAPI(collectedQuizInfo);
        totalQuizInfoRegistered = batchResult.success; // 실제 등록된 수로 업데이트 (1개 텍스트 카드)
      }
      
      if (newCrawled) {
        const updatedPosts = Array.from(crawledQuizPostsSet);
        fs.writeFileSync(QUIZ_POSTS_PATH, JSON.stringify(updatedPosts, null, 2));
        console.log(`[저장완료] 퀴즈 크롤링 히스토리 업데이트: ${updatedPosts.length}개 포스트 저장`);
      } else {
        console.log(`[변경없음] 새로운 퀴즈 게시글이 없습니다.`);
      }
      
      console.log(`[종료] 총 새 게시글: ${totalNewPosts}개, 총 퀴즈정보등록: ${totalQuizInfoRegistered}개, 총 로컬스킵: ${totalSkippedPosts}개, 총 DB스킵: ${totalDbSkippedPosts}개`);
      
    } catch (error) {
      console.error('[크롤러실행오류]', error.message);
    }
  })();
}
