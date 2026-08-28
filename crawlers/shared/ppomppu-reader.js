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
  const start = lines.reduce(
    (lastIndex, line, index) => (/^\s*추천(?:\s|$)/.test(line) ? index : lastIndex),
    -1
  );

  if (start === -1) {
    return '';
  }

  const end = lines.findIndex(
    (line, index) => index > start && line.trim() === '#### 공유하기'
  );

  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
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

  const markdownLinkPattern = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  for (const match of String(body).matchAll(markdownLinkPattern)) {
    addExternalUrl(match[1]);
  }

  const bareUrlPattern = /https?:\/\/[^\s<>"')\]]+/g;
  for (const match of String(body).matchAll(bareUrlPattern)) {
    addExternalUrl(match[0]);
  }

  return urls;
}

function extractQuizAnswer(body) {
  if (!body || typeof body !== 'string') {
    return null;
  }

  const cleanAnswer = raw => {
    let answer = raw.trim();
    answer = answer.split(/[\n\r]/)[0].trim();
    answer = answer.split(/\s{2,}/)[0].trim();
    return answer.replace(/(?:입니다|입니다\.|\.)$/, '').trim();
  };

  const answerIsMatch = body.match(
    /정답\s*입니다[^]*?정답\s*:?\s*([^\n\r]+?)(?=\s*[.!?]|\s*[\n\r]|\s*$)/i
  );
  if (answerIsMatch) {
    return { answer: cleanAnswer(answerIsMatch[1]), fullContent: body.substring(0, 500) };
  }

  const answerMatch = body.match(
    /정답\s*:?\s*([^\n\r]+?)(?=\s*[.!?]|\s*[\n\r]|\s*$)/i
  );
  if (answerMatch) {
    return { answer: cleanAnswer(answerMatch[1]), fullContent: body.substring(0, 500) };
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
  parseBoardPosts,
  extractPostBody,
  decodePpomppuTarget,
  extractExternalUrls,
  extractQuizAnswer,
  getPostKey,
  toCanonicalPostUrl,
};
