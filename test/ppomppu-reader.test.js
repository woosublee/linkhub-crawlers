const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const reader = require('../crawlers/shared/ppomppu-reader');

const fixture = name => fs.readFileSync(
  path.join(__dirname, 'fixtures/ppomppu', name),
  'utf8'
);

test('쿠폰 공개 probe의 30건과 다중 이미지/강조 제목을 파싱한다', () => {
  const posts = reader.parseBoardPosts(fixture('coupon-list.md'), 'coupon');

  assert.equal(posts.length, 30);
  assert.deepEqual(posts.map(({ postNo }) => postNo), [
    '117849', '117848', '117847', '117846', '117844', '117843',
    '117842', '117841', '117840', '117839', '117838', '117837',
    '117836', '117835', '117834', '117833', '117832', '117831',
    '117830', '117829', '117828', '117827', '117826', '117825',
    '117824', '117823', '117822', '117821', '117820', '117819',
  ]);
  assert.deepEqual(posts.filter(post => [
    '117849', '117841', '117833',
  ].includes(post.postNo)).map(({ postNo, title }) => ({ postNo, title })), [
    {
      postNo: '117849',
      title: '[네이버페이] 쇼핑라이브 오후 일정 (14시 1개, 18시 1개, 20시 2개)',
    },
    { postNo: '117841', title: '[KB Pay] 오늘의 퀴즈 8/28일자 정답' },
    { postNo: '117833', title: '[네이버페이] 네이버 AI탭 20원 받으세요' },
  ]);
  assert.equal(posts[0].boardId, 'coupon');
  assert.equal(reader.getPostKey(posts[15].url), 'coupon:117833');
});

test('검색 파라미터와 무관하게 canonical URL과 post key를 만든다', () => {
  const url = 'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&page=1&divpage=21&no=117849';
  assert.equal(reader.getPostKey(url), 'coupon:117849');
  assert.equal(
    reader.toCanonicalPostUrl('coupon', '117849'),
    'https://www.ppomppu.co.kr/zboard/view.php?id=coupon&no=117849'
  );
});

test('게시글 본문만 분리하고 뽐뿌 redirect를 복원한다', () => {
  const body = reader.extractPostBody(fixture('naverpay-detail.md'));
  const redirectUrl = 'https://s.ppomppu.co.kr/?idno=coupon_117847&target=aHR0cHM6Ly9teWNhci5uYXZlci5jb20vP2Zyb209cHVzaDE=&encode=on';

  assert.equal(
    reader.decodePpomppuTarget(redirectUrl),
    'https://mycar.naver.com/?from=push1'
  );
  assert.deepEqual(reader.extractExternalUrls(body), [
    'https://mycar.naver.com/?from=push1',
  ]);
});

test('뽐뿌 redirect가 복원한 내부 URL은 외부 URL로 반환하지 않는다', () => {
  const redirectUrl = 'https://s.ppomppu.co.kr/?target=aHR0cHM6Ly93d3cucHBvbXBwdS5jby5rci96Ym9hcmQvdmlldy5waHA_aWQ9Y291cG9uJm5vPTExNzg0Nw';

  assert.deepEqual(reader.extractExternalUrls(`[내부 링크](${redirectUrl})`), []);
});

test('퀴즈 정답을 기존 정규식 규칙으로 추출한다', () => {
  const body = reader.extractPostBody(fixture('quiz-detail.md'));
  const quiz = reader.extractQuizAnswer(body);

  assert.equal(quiz.answer, '4');
  assert.equal(quiz.fullContent, body);
});

test('쥐즐 phone과 money 검색 목록을 공통 게시글 모델로 파싱한다', () => {
  const markdown = fixture('jjizzle-list.md');
  const [phonePost] = reader.parseBoardPosts(markdown, 'phone');
  const [moneyPost] = reader.parseBoardPosts(markdown, 'money');

  assert.deepEqual(
    { postNo: phonePost.postNo, title: phonePost.title },
    { postNo: '3932385', title: '핀다 2970원 창 띄워놓으신 분들은 개통됩니다.' }
  );
  assert.deepEqual(
    { postNo: moneyPost.postNo, title: moneyPost.title },
    { postNo: '547011', title: '올리브영 현대카드 Plus 출시 (만들지 마세요)' }
  );
});
