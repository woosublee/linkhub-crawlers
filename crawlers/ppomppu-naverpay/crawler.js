// ppomppu_naverpay_crawler.js
// 뽐뿌 쿠폰 게시판에서 [네이버페이]가 포함된 게시글의 제목과 본문을 Puppeteer로 파싱

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const POSTS_PATH = './crawled_posts.json';
const API_BASE_URL = 'https://linkhub-dev.vercel.app/api';
const API_SECRET_KEY = process.env.API_SECRET_KEY;

if (!API_SECRET_KEY) {
  console.error('[오류] API_SECRET_KEY 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

let crawledPosts = [];

// 기존 크롤링된 포스트 로드
if (fs.existsSync(POSTS_PATH)) {
  try {
    crawledPosts = JSON.parse(fs.readFileSync(POSTS_PATH, 'utf-8'));
    console.log(`[로드완료] 기존 크롤링된 포스트 ${crawledPosts.length}개`);
  } catch (e) {
    console.error('[로드실패] 기존 파일 파싱 오류:', e.message);
    crawledPosts = [];
  }
} else {
  console.log('[새파일] 크롤링 히스토리 파일이 없습니다. 새로 생성합니다.');
}

const crawledPostsSet = new Set(crawledPosts);

// 데이터베이스에서 URL 존재 여부 확인 (게시글 링크만 체크)
async function checkPostExists(postLink) {
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
    return crawledPostsSet.has(postLink);
  }
}

async function fetchNaverPayPosts() {
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

  const posts = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#revolution_main_table tr'));
    return rows.map(row => {
      const titleSpan = row.querySelector('td.baseList-space.title a span');
      const authorSpan = row.querySelector('td .baseList-name');
      const author = authorSpan ? authorSpan.textContent.trim() : '';
      if (titleSpan && titleSpan.textContent.includes('네이버페이') /* && author === 'Shampoo' */) {
        const link = row.querySelector('td.baseList-space.title a')?.getAttribute('href');
        let fullLink = null;
        if (link) {
          fullLink = link.startsWith('/')
            ? 'https://www.ppomppu.co.kr' + link
            : 'https://www.ppomppu.co.kr/zboard/' + link;
        }
        return {
          title: titleSpan.textContent.trim(),
          link: fullLink,
        };
      }
      return null;
    }).filter(Boolean);
  });

  await browser.close();
  return posts;
}

// 게시글 본문에서 URL 추출
async function extractUrlsFromPost(postLink) {
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
    await page.goto(postLink, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('td.board-contents', { timeout: 5000 }).catch(() => {});
    
    const urls = await page.evaluate(() => {
      const el = document.querySelector('td.board-contents');
      if (!el) return [];
      const urlSet = new Set();
      Array.from(el.querySelectorAll('a')).forEach(a => {
        const txt = a.textContent && a.textContent.trim();
        if (typeof txt === 'string' && /^https?:\/\//.test(txt) && !txt.includes('s.ppomppu.co.kr')) {
          urlSet.add(txt);
        }
        const href = a.getAttribute('href');
        if (typeof href === 'string' && /^https?:\/\//.test(href) && !href.includes('s.ppomppu.co.kr')) {
          urlSet.add(href);
        }
      });
      return Array.from(urlSet);
    });
    
    await browser.close();
    return urls;
  } catch (e) {
    console.error(`[본문파싱실패] ${postLink}`, e.message);
    await browser.close();
    return [];
  }
}

// 실행 예시
if (require.main === module) {
  (async () => {
    console.log(`[시작] 네이버페이 크롤러 실행 - ${new Date().toISOString()}`);
    console.log(`[현재상태] 기존 크롤링된 URL 수: ${crawledPostsSet.size}`);
    
    let newCrawled = false;
    let totalNewPosts = 0;
    let totalSkippedPosts = 0;
    let totalDbSkippedPosts = 0;
    let totalUrlsRegistered = 0;
    
    try {
      console.log('[크롤링시작] 네이버페이 게시글 검색');
      const posts = await fetchNaverPayPosts();
      console.log(`[파싱완료] 네이버페이 게시글 ${posts.length}개 발견`);
      
      for (const post of posts) {
        if (!post.link) continue;
        
        // 로컬 캐시 체크
        if (crawledPostsSet.has(post.link)) {
          console.log(`[로컬중복] ${post.title.substring(0, 30)}...`);
          totalSkippedPosts++;
          continue;
        }
        
        // 데이터베이스 중복 체크 (게시글 링크만)
        const existsInDb = await checkPostExists(post.link);
        if (existsInDb) {
          console.log(`[DB중복] ${post.title.substring(0, 30)}...`);
          totalDbSkippedPosts++;
          // DB에 있으면 로컬 캐시에도 추가
          crawledPostsSet.add(post.link);
          continue;
        }
        
        // 본문에서 URL 추출
        console.log(`[본문파싱] ${post.title.substring(0, 30)}...`);
        const urls = await extractUrlsFromPost(post.link);
        
        if (Array.isArray(urls) && urls.length > 0) {
          console.log(`[URL발견] ${urls.length}개 URL 발견`);
          
          let registeredCount = 0;
          
          // 모든 URL을 등록 API에 전송 (중복체크는 등록 API에서 처리)
          for (const url of urls) {
            try {
              const res = await axios.post(`${API_BASE_URL}/links`, {
                url: url,
                tags: ['NPay적립'], // 뱃지 추가
              }, {
                headers: {
                  'x-api-key': API_SECRET_KEY
                }
              });
              console.log(`[등록완료] ${url.substring(0, 50)}... → ${res.status}`);
              registeredCount++;
              totalUrlsRegistered++;
            } catch (e) {
              if (e.response && e.response.status === 409) {
                console.log(`[중복스킵] ${url.substring(0, 50)}... → 이미 등록됨`);
              } else {
                console.error(`[등록실패] ${url.substring(0, 50)}...`, e.message);
              }
            }
            
            await sleep(1000); // 서버 부하 방지
          }
          
          if (registeredCount > 0) {
            console.log(`[게시글완료] ${post.title.substring(0, 30)}... → ${registeredCount}개 URL 등록`);
            newCrawled = true;
            totalNewPosts++;
          }
        } else {
          console.log(`[URL없음] ${post.title.substring(0, 30)}... → URL 없음`);
        }
        
        // 처리 완료된 게시글은 캐시에 추가
        crawledPostsSet.add(post.link);
        await sleep(2000); // 게시글 간 간격
      }
      
      if (newCrawled) {
        const updatedPosts = Array.from(crawledPostsSet);
        fs.writeFileSync(POSTS_PATH, JSON.stringify(updatedPosts, null, 2));
        console.log(`[저장완료] 크롤링 히스토리 업데이트: ${updatedPosts.length}개 URL 저장`);
      } else {
        console.log(`[변경없음] 새로운 네이버페이 게시글이 없습니다.`);
      }
      
      console.log(`[종료] 총 새 게시글: ${totalNewPosts}개, 총 URL등록: ${totalUrlsRegistered}개, 총 로컬스킵: ${totalSkippedPosts}개, 총 DB스킵: ${totalDbSkippedPosts}개`);
      
    } catch (error) {
      console.error('[크롤러실행오류]', error.message);
    }
  })();
} 