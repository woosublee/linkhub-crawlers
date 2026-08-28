const axios = require('axios');

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS = [0, 2000, 5000, 10000];

function toReaderUrl(sourceUrl) {
  const url = new URL(sourceUrl);
  url.protocol = 'http:';
  return `https://r.jina.ai/${url.toString()}`;
}

function defaultWait(delay) {
  return new Promise(resolve => setTimeout(resolve, delay));
}

function isNetworkError(error) {
  return !error.response;
}

function normalizePpomppuSource(sourceUrl) {
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if (hostname !== 'ppomppu.co.kr') {
    return null;
  }

  url.protocol = 'https:';
  url.hostname = 'ppomppu.co.kr';
  url.port = '';
  url.hash = '';
  url.searchParams.sort();
  return url.toString();
}

function validateReaderMarkdown(markdown, sourceUrl) {
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    throw new Error('Reader 문서 형식 오류: 비어 있거나 문자열이 아닌 body');
  }

  const sourceMatch = /^URL Source:[ \t]*(\S+)[ \t]*\r?$/m.exec(markdown);
  const contentMatch = /^Markdown Content:[ \t]*\r?$/m.exec(markdown);
  if (!sourceMatch || !contentMatch || sourceMatch.index > contentMatch.index) {
    throw new Error('Reader 문서 형식 오류: URL Source/Markdown Content 경계 누락');
  }

  const expectedSource = normalizePpomppuSource(sourceUrl);
  const actualSource = normalizePpomppuSource(sourceMatch[1]);
  if (!expectedSource || !actualSource || actualSource !== expectedSource) {
    throw new Error('Reader URL Source 불일치');
  }

  return markdown;
}

async function fetchReaderMarkdown(sourceUrl, options = {}) {
  const {
    cacheToleranceSeconds,
    retryDelays = DEFAULT_RETRY_DELAYS,
    request = axios.get,
    wait = defaultWait,
  } = options;
  const readerUrl = toReaderUrl(sourceUrl);
  const config = {
    headers: cacheToleranceSeconds === undefined
      ? {}
      : { 'X-Cache-Tolerance': String(cacheToleranceSeconds) },
    validateStatus: () => true,
    timeout: 45000,
    transformResponse: value => value,
  };
  let lastError;

  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    const delay = retryDelays[attempt];
    if (delay > 0) {
      await wait(delay);
    }

    let response;
    try {
      response = await request(readerUrl, config);
    } catch (error) {
      if (!isNetworkError(error) || attempt === retryDelays.length - 1) {
        throw error;
      }
      lastError = error;
      continue;
    }

    if (response.status >= 200 && response.status < 300) {
      try {
        return validateReaderMarkdown(response.data, sourceUrl);
      } catch (error) {
        if (attempt === retryDelays.length - 1) {
          throw error;
        }
        lastError = error;
        continue;
      }
    }

    const error = new Error(`Reader 응답 오류: ${response.status}`);
    if (!RETRYABLE_STATUS.has(response.status) || attempt === retryDelays.length - 1) {
      throw error;
    }
    lastError = error;
  }

  throw lastError || new Error('Reader 요청을 시도할 수 없습니다.');
}

async function fetchBoardPosts(sourceUrl, boardId, options = {}) {
  const { allowEmpty = false, ...readerOptions } = options;
  const markdown = await fetchReaderMarkdown(sourceUrl, {
    ...readerOptions,
    cacheToleranceSeconds: options.cacheToleranceSeconds ?? 60,
  });
  const posts = parseBoardPosts(markdown, boardId);
  if (!allowEmpty && posts.length === 0) {
    throw new Error(`Reader 게시글 0건: ${boardId}`);
  }
  return posts;
}

async function fetchPostBody(sourceUrl, options = {}) {
  const markdown = await fetchReaderMarkdown(sourceUrl, {
    ...options,
    cacheToleranceSeconds: options.cacheToleranceSeconds ?? 300,
  });
  return extractPostBody(markdown);
}

function parseBoardPosts(markdown, boardId) {
  const posts = [];
  const targetBoardId = String(boardId);
  const viewUrlPattern = /https?:\/\/(?:www\.)?ppomppu\.co\.kr\/zboard\/view\.php\?[^)\s]+/g;

  for (const line of String(markdown).split(/\r?\n/)) {
    for (const match of line.matchAll(viewUrlPattern)) {
      const url = match[0];
      let parsedUrl;

      try {
        parsedUrl = new URL(url);
      } catch {
        continue;
      }

      const postBoardId = parsedUrl.searchParams.get('id');
      const postNo = parsedUrl.searchParams.get('no');
      if (postBoardId !== targetBoardId || !postNo) {
        continue;
      }

      const linkClose = line.lastIndexOf('](', match.index);
      let linkOpen = -1;
      let bracketDepth = 0;
      for (let index = linkClose; index >= 0; index -= 1) {
        if (line[index] === ']') {
          bracketDepth += 1;
        } else if (line[index] === '[') {
          bracketDepth -= 1;
          if (bracketDepth === 0) {
            linkOpen = index;
            break;
          }
        }
      }
      if (linkOpen === -1 || linkClose === -1) {
        continue;
      }

      const title = line.slice(linkOpen + 1, linkClose).replace(/_/g, '');
      posts.push({
        boardId: targetBoardId,
        postNo,
        title,
        url,
      });
    }
  }

  return posts;
}

function extractPostBody(markdown) {
  const lines = String(markdown).split(/\r?\n/);

  for (let start = 0; start < lines.length; start += 1) {
    if (!/^\s*추천(?:\s|$)/.test(lines[start])) {
      continue;
    }

    const end = lines.findIndex(
      (line, index) => index > start && line.trim() === '#### 공유하기'
    );
    if (end !== -1) {
      return lines.slice(start + 1, end).join('\n').trim();
    }
  }

  return '';
}

function decodePpomppuTarget(url) {
  let target;

  try {
    target = new URL(url).searchParams.get('target');
  } catch {
    return url;
  }

  if (!target) {
    return url;
  }

  const base64 = target
    .replace(/ /g, '+')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    return url;
  }

  const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return Buffer.from(paddedBase64, 'base64').toString('utf8');
}

function extractExternalUrls(body) {
  const urls = [];
  const seen = new Set();
  const markdownTargetRanges = [];

  const addExternalUrl = value => {
    let parsedUrl;

    try {
      parsedUrl = new URL(value);
    } catch {
      return;
    }

    const isPpomppu = parsedUrl.hostname === 'ppomppu.co.kr'
      || parsedUrl.hostname.endsWith('.ppomppu.co.kr');
    const url = parsedUrl.hostname === 's.ppomppu.co.kr'
      ? decodePpomppuTarget(value)
      : value;

    if (isPpomppu && parsedUrl.hostname !== 's.ppomppu.co.kr') {
      return;
    }

    let decodedUrl;
    try {
      decodedUrl = new URL(url);
    } catch {
      return;
    }

    const isDecodedPpomppu = decodedUrl.hostname === 'ppomppu.co.kr'
      || decodedUrl.hostname.endsWith('.ppomppu.co.kr');
    if (isDecodedPpomppu || !['http:', 'https:'].includes(decodedUrl.protocol) || seen.has(url)) {
      return;
    }

    seen.add(url);
    urls.push(url);
  };

  const bodyText = String(body);
  const markdownLinkPattern = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  for (const match of bodyText.matchAll(markdownLinkPattern)) {
    const targetStart = match.index + match[0].indexOf(match[1]);
    markdownTargetRanges.push([targetStart, targetStart + match[1].length]);
    addExternalUrl(match[1]);
  }

  const bareUrlPattern = /https?:\/\/[^\s<>"')\]]+/g;
  for (const match of bodyText.matchAll(bareUrlPattern)) {
    const isMarkdownTarget = markdownTargetRanges.some(
      ([start, end]) => match.index >= start && match.index < end
    );
    if (isMarkdownTarget) {
      continue;
    }

    const bareUrl = match[0].replace(/[.,;:!?…'’”}\]]+$/gu, '');
    addExternalUrl(bareUrl);
  }

  return urls;
}

function cleanQuizAnswer(raw) {
  const answer = raw
    .trim()
    .replace(/\s*입니다\.?$/, '')
    .replace(/[.!?]$/, '')
    .trim();
  const advisoryReference = /(?:댓글|이미지|사진|링크|아래|하단|본문|내용)/i;
  const advisoryAction = /(?:확인|참고|눌러|보(?:세요|시|기)|입력)/i;

  if (
    answer === ''
    || /!?\[|\]\(|[*_]|[\r\n]|정답\s*입력\s*전\s*참고|여기를\s*눌러|####\s*공유하기/.test(answer)
    || /^(?:댓글(?:을|은|도|로|에서)?\s*(?:분위기|확인)|이벤트\s*(?:안내|링크)|참고\s*[:：])/i.test(answer)
    || (advisoryReference.test(answer) && advisoryAction.test(answer))
    || /^(?:없음|정보\s*없음|미확인|확인\s*불가|모름)$/i.test(answer)
  ) {
    return null;
  }

  return answer;
}

function findClosingEmphasis(value, marker, fromIndex) {
  const markerCharacter = marker[0];
  let index = value.indexOf(marker, fromIndex);

  while (index !== -1) {
    const before = value[index - 1];
    const after = value[index + marker.length];
    if (before !== markerCharacter && after !== markerCharacter) {
      return index;
    }
    index = value.indexOf(marker, index + marker.length);
  }

  return -1;
}

function parseQuizAnswerCandidate(body, markerMatch) {
  const markerEnd = markerMatch.index + markerMatch[0].length;
  const lineStart = body.lastIndexOf('\n', markerMatch.index - 1) + 1;
  const lineEndIndex = body.indexOf('\n', markerEnd);
  const lineEnd = lineEndIndex === -1 ? body.length : lineEndIndex;
  const labelPrefix = body.slice(lineStart, markerMatch.index);
  const labelMarker = /([*_]{1,3})$/.exec(labelPrefix)?.[1];
  let remainder = body.slice(markerEnd, lineEnd).replace(/\r$/, '').trimStart();

  if (labelMarker) {
    if (remainder.startsWith(labelMarker)) {
      remainder = remainder.slice(labelMarker.length).trimStart();
    } else {
      const closingIndex = findClosingEmphasis(remainder, labelMarker, 0);
      if (closingIndex === -1) {
        return null;
      }
      return cleanQuizAnswer(remainder.slice(0, closingIndex));
    }
  }
  if (
    remainder === ''
    || /^(?:!\[|\[|#{1,6}\s|[-+>]\s|추천(?:\s|$)|####\s*공유하기)/.test(remainder)
  ) {
    return null;
  }

  const emphasisMatch = /^(\*{1,3}|_{1,3})(?=\S)/.exec(remainder);
  if (emphasisMatch) {
    const marker = emphasisMatch[1];
    const closingIndex = findClosingEmphasis(remainder, marker, marker.length);
    if (closingIndex === -1) {
      return null;
    }
    return cleanQuizAnswer(remainder.slice(marker.length, closingIndex));
  }

  let boundary = remainder.length;
  for (const pattern of [
    /\s+(?=!\[|\[)/,
    /\s+(?=#{1,6}\s|[-+>]\s|(?:####\s*)?공유하기|추천(?:\s|$))/,
    /\s+(?=(?:[*_]{1,3})?(?:정답\s*입력\s*전\s*참고|댓글(?:을|은|도|로)?\s*(?:분위기|확인)|이벤트\s*(?:안내|링크)|참고\s*[:：]))/i,
  ]) {
    const match = pattern.exec(remainder);
    if (match && match.index < boundary) {
      boundary = match.index;
    }
  }

  return cleanQuizAnswer(remainder.slice(0, boundary));
}

function extractQuizAnswer(body) {
  if (!body || typeof body !== 'string') {
    return null;
  }

  const markerPatterns = [
    /정답\s*[:：][ \t]*/gi,
    /정답[ \t]+(?!입니다(?:[ \t]|[.!?:：]|$)|입력(?:[ \t]|$)|확인(?:[ \t]|$)|참고(?:[ \t]|$))/gi,
  ];

  for (const markerPattern of markerPatterns) {
    for (const markerMatch of body.matchAll(markerPattern)) {
      const answer = parseQuizAnswerCandidate(body, markerMatch);
      if (answer) {
        return { answer, fullContent: body.substring(0, 500) };
      }
    }
  }

  return null;
}

function getPostKey(url) {
  try {
    const parsedUrl = new URL(url);
    const boardId = parsedUrl.searchParams.get('id');
    const postNo = parsedUrl.searchParams.get('no');
    return boardId && postNo ? `${boardId}:${postNo}` : null;
  } catch {
    return null;
  }
}

function toCanonicalPostUrl(boardId, postNo) {
  return `https://www.ppomppu.co.kr/zboard/view.php?id=${encodeURIComponent(boardId)}&no=${encodeURIComponent(postNo)}`;
}

module.exports = {
  fetchReaderMarkdown,
  fetchBoardPosts,
  fetchPostBody,
  parseBoardPosts,
  extractPostBody,
  decodePpomppuTarget,
  extractExternalUrls,
  extractQuizAnswer,
  getPostKey,
  toCanonicalPostUrl,
};
