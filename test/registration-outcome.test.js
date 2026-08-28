const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldCacheSingleResult,
  shouldCacheAllResults,
} = require('../crawlers/shared/registration-outcome');

test('성공과 확정 중복만 단일 게시글 캐시를 허용한다', () => {
  assert.equal(shouldCacheSingleResult('registered'), true);
  assert.equal(shouldCacheSingleResult('duplicate'), true);
  assert.equal(shouldCacheSingleResult('failed'), false);
});

test('네이버페이는 모든 URL이 terminal 상태일 때만 캐시한다', () => {
  assert.equal(shouldCacheAllResults([]), false);
  assert.equal(shouldCacheAllResults(['registered', 'duplicate']), true);
  assert.equal(shouldCacheAllResults(['registered', 'failed']), false);
});
