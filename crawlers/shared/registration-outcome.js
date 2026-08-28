const TERMINAL_RESULTS = new Set(['registered', 'duplicate']);

function shouldCacheSingleResult(result) {
  return TERMINAL_RESULTS.has(result);
}

function shouldCacheAllResults(results) {
  return results.length > 0 && results.every(shouldCacheSingleResult);
}

module.exports = { shouldCacheSingleResult, shouldCacheAllResults };
