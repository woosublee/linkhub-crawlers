// ppomppu_jjizzle_crawler.js
// 뽐뿌 phone, money 게시판에서 새 글의 제목/URL을 추출해 description에 '쥐즐'을 넣어 linkhub API에 등록

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

const POSTS_PATH = './crawled_posts_jjizzle.json';
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

// 데이터베이스에서 URL 존재 여부 확인
async function checkUrlExists(url) {
  try {
    const response = await axios.post(`${API_BASE_URL}/links/check`, { url }, {
      headers: {
        'x-api-key': API_SECRET_KEY
      }
    });
    return response.data.exists;
  } catch (error) {
    console.error(`[URL체크실패] ${url}`, error.message);
    // API 호출 실패 시 로컬 캐시로 판단
    return crawledPostsSet.has(url);
  }
}

const targets = [
  {
    name: 'phone',
    url: 'https://www.ppomppu.co.kr/zboard/zboard.php?search_type=name&id=phone&page_num=30&keyword=%C1%E3%C1%F1',
    displayName: '휴대폰포럼',
  },
  {
    name: 'money',
    url: 'https://www.ppomppu.co.kr/zboard/zboard.php?search_type=name&id=money&page_num=30&keyword=%C1%E3%C1%F1',
    displayName: '재테크포럼',
  },
];

async function fetchPostsFromBoard(boardUrl) {
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
    await page.goto(boardUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (e) {
    console.error('[페이지로드실패]', boardUrl, e.message);
    await browser.close();
    return [];
  }

  const posts = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#revolution_main_table tr'));
    return rows.map(row => {
      const titleA = row.querySelector('a.baseList-title');
      const title = titleA ? titleA.textContent.trim() : null;
      const link = titleA ? titleA.getAttribute('href') : null;
      let fullLink = null;
      if (link) {
        fullLink = link.startsWith('/')
          ? 'https://www.ppomppu.co.kr' + link
          : 'https://www.ppomppu.co.kr/zboard/' + link;
      }
      if (title && fullLink) {
        return {
          title,
          link: fullLink,
        };
      }
      return null;
    }).filter(Boolean);
  });

  await browser.close();
  return posts;
}

if (require.main === module) {
  (async () => {
    console.log(`[시작] 쥐즐 크롤러 실행 - ${new Date().toISOString()}`);
    console.log(`[현재상태] 기존 크롤링된 URL 수: ${crawledPostsSet.size}`);
    
    let newCrawled = false;
    let totalNewPosts = 0;
    let totalSkippedPosts = 0;
    let totalDbSkippedPosts = 0;
    
    for (const target of targets) {
      console.log(`[크롤링시작] ${target.displayName} (${target.name})`);
      const posts = await fetchPostsFromBoard(target.url);
      console.log(`[파싱완료] ${target.displayName}에서 ${posts.length}개 게시글 발견`);
      
      let boardNewPosts = 0;
      let boardSkippedPosts = 0;
      let boardDbSkippedPosts = 0;
      
      for (const post of posts) {
        if (!post.link) continue;
        
        // 로컬 캐시 체크
        if (crawledPostsSet.has(post.link)) {
          console.log(`[로컬중복] ${post.title.substring(0, 30)}...`);
          boardSkippedPosts++;
          totalSkippedPosts++;
          continue;
        }
        
        // sponsor나 consulting이 포함된 URL은 등록하지 않음
        if (post.link.includes('sponsor') || post.link.includes('consulting')) {
          console.log(`[제외링크] ${post.title.substring(0, 30)}... (sponsor/consulting 포함)`);
          boardSkippedPosts++;
          totalSkippedPosts++;
          continue;
        }
        
        // 데이터베이스 중복 체크
        const existsInDb = await checkUrlExists(post.link);
        if (existsInDb) {
          console.log(`[DB중복] ${post.title.substring(0, 30)}...`);
          boardDbSkippedPosts++;
          totalDbSkippedPosts++;
          // DB에 있으면 로컬 캐시에도 추가
          crawledPostsSet.add(post.link);
          continue;
        }
        
        try {
          const res = await axios.post(`${API_BASE_URL}/links`, {
            url: post.link,
            title: post.title,
            description: `${target.displayName} - 쥐즐`,
            thumbnail: '/icon_app_20160427.png',
          }, {
            headers: {
              'x-api-key': API_SECRET_KEY
            }
          });
          console.log(`[등록완료] ${post.title.substring(0, 30)}... → ${res.status}`);
          crawledPostsSet.add(post.link);
          newCrawled = true;
          boardNewPosts++;
          totalNewPosts++;
        } catch (e) {
          console.error(`[등록실패] ${post.title.substring(0, 30)}...`, e.message);
          // 등록 실패해도 중복 체크는 했으므로 캐시에 추가
          crawledPostsSet.add(post.link);
        }
        
        await sleep(1000); // 서버 부하 방지
      }
      
      console.log(`[${target.displayName} 완료] 새로 등록: ${boardNewPosts}개, 로컬스킵: ${boardSkippedPosts}개, DB스킵: ${boardDbSkippedPosts}개`);
    }
    
    if (newCrawled) {
      const updatedPosts = Array.from(crawledPostsSet);
      fs.writeFileSync(POSTS_PATH, JSON.stringify(updatedPosts, null, 2));
      console.log(`[저장완료] 크롤링 히스토리 업데이트: ${updatedPosts.length}개 URL 저장`);
    } else {
      console.log(`[변경없음] 새로운 게시글이 없습니다.`);
    }
    
    console.log(`[종료] 총 새로 등록: ${totalNewPosts}개, 총 로컬스킵: ${totalSkippedPosts}개, 총 DB스킵: ${totalDbSkippedPosts}개`);
  })();
} 