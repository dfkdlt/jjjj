// 메인 페이지에 보여줄 "게임 카드" 정보(점수, 한글 지원, 썸네일)를 만든다.
// games 테이블에 24시간 이내 정보가 있으면 그걸 쓰고, 없으면 Steam에서 가져와 저장한다.
// (저장해 두면 추천 버튼을 눌러도 정상 동작하고, 같은 게임은 다음에 빠르게 보여줄 수 있다)
const pool = require('../db');
const { fetchReviewSummary, calculateScore, fetchGameDetails } = require('./steamService');

const CACHE_HOURS = 24;
const CONCURRENCY = 4;

async function loadCached(appids) {
  if (appids.length === 0) return {};
  try {
    const [rows] = await pool.query(
      `SELECT appid, name, total_positive, total_negative, supports_korean, header_image
       FROM games WHERE appid IN (?) AND last_updated >= (NOW() - INTERVAL ? HOUR)`,
      [appids, CACHE_HOURS]
    );
    return Object.fromEntries(rows.map((r) => [r.appid, r]));
  } catch (err) {
    return {};
  }
}

async function fetchAndStore(c) {
  const { positive, negative } = await fetchReviewSummary(c.appid);
  const { supportsKorean, headerImage } = await fetchGameDetails(c.appid);
  const image = headerImage || c.image || null;
  const score = calculateScore(positive, negative);
  await pool.query(
    `INSERT INTO games (appid, name, total_positive, total_negative, score, supports_korean, header_image)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), total_positive = VALUES(total_positive),
       total_negative = VALUES(total_negative), score = VALUES(score),
       supports_korean = VALUES(supports_korean), header_image = VALUES(header_image),
       last_updated = CURRENT_TIMESTAMP`,
    [c.appid, c.name, positive, negative, score, supportsKorean ? 1 : 0, image]
  );
  return { appid: c.appid, name: c.name, total_positive: positive, total_negative: negative, supports_korean: supportsKorean, header_image: image };
}

function toCard(base, c) {
  const total = base.total_positive + base.total_negative;
  return {
    appid: base.appid,
    name: base.name,
    total_positive: base.total_positive,
    total_negative: base.total_negative,
    review_count: total,
    score: total > 0 ? calculateScore(base.total_positive, base.total_negative) : null, // 리뷰가 없으면 "평가 전"
    supports_korean: !!base.supports_korean,
    header_image: base.header_image || c.image || null,
    released: c.released || null,
  };
}

// candidates: [{ appid, name, released, image }] (보여줄 우선순위 순서)
// limit개가 채워질 때까지 앞에서부터 처리. minReviews 미만이면 건너뜀 (갓 나와 리뷰가 거의 없는 게임 제외용)
async function getCards(candidates, limit, { minReviews = 0 } = {}) {
  const cached = await loadCached(candidates.map((c) => c.appid));
  const out = [];
  for (let i = 0; i < candidates.length && out.length < limit; i += CONCURRENCY) {
    const chunk = candidates.slice(i, i + CONCURRENCY);
    const cards = await Promise.all(
      chunk.map(async (c) => {
        try {
          const base = cached[c.appid] || (await fetchAndStore(c));
          return toCard(base, c);
        } catch (err) {
          console.error(`[메인] ${c.appid}(${c.name}) 정보 조회 실패:`, err.message);
          return null;
        }
      })
    );
    for (const card of cards) {
      if (card && card.review_count >= minReviews && out.length < limit) out.push(card);
    }
  }
  return out;
}

module.exports = { getCards };
