const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selectNaverPayPosts,
  createPostKeySet,
} = require('../crawlers/ppomppu-naverpay/crawler');

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
