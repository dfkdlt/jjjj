const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { ready } = require('../services/ensureTables');
const { searchStore, isReleased } = require('../services/steamStoreService');
const { getCards } = require('../services/gameCardService');
const { computeProfile, tagLabel } = require('../services/tasteService');
const { getHiddenAppids } = require('../services/dislikeFilter');
const { markLiked } = require('./likes');
const { getTagId } = require('../keywordMap');
const { getPrices } = require('../services/priceService');
const { markFriendLikes } = require('../services/friendService');

const router = express.Router();

const SEARCH_CACHE_MS = 60 * 60 * 1000; // Steam 검색 결과는 1시간 동안 재사용
const POOL_SIZE = 60; // 한 번에 읽어 오는 후보 수
const SHOW_COUNT = 6; // 섹션당 보여줄 게임 수
const DEALS_SHOW = 12; // 할인 알림에 보여줄 최대 게임 수
const RECENT_MIN_REVIEWS = 10; // 갓 나와서 리뷰가 거의 없는 게임은 점수가 의미 없어서 제외

const searchCache = new Map();
async function cachedSearch(tags, sortBy) {
  const key = `${sortBy}|${tags.join(',')}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.t < SEARCH_CACHE_MS) return hit.games;
  const tagIds = tags.map((t) => getTagId(t)).filter(Boolean);
  const { games } = await searchStore({ tagIds, sortBy, count: POOL_SIZE });
  searchCache.set(key, { t: Date.now(), games });
  return games;
}

// 이미 추천했거나 안 보기로 한 게임은 추천에서 뺀다
async function excludedAppids(userId, tags) {
  const hidden = await getHiddenAppids(userId, tags);
  const [liked] = await pool.query('SELECT appid FROM user_likes WHERE user_id = ?', [userId]);
  for (const r of liked) hidden.add(r.appid);
  return hidden;
}

// 최근 출시한 게임 (태그 상관없이 모두에게)
router.get('/recent', authMiddleware, async (req, res) => {
  try {
    await ready;
    const games = (await cachedSearch([], 'Released_DESC')).filter((g) => isReleased(g.released));
    const hidden = await getHiddenAppids(req.user.id, []);
    const cards = await getCards(games.filter((g) => !hidden.has(g.appid)), 8, { minReviews: RECENT_MIN_REVIEWS });
    await markLiked(req.user.id, cards);
    await markFriendLikes(req.user.id, cards);
    res.json({ results: cards });
  } catch (err) {
    console.error('[메인] 최근 출시 조회 실패:', err.message);
    res.status(502).json({ error: err.code === 'STEAM_BLOCKED' ? 'Steam이 요청을 일시적으로 제한하고 있어요. 몇 분 뒤에 다시 시도해 주세요.' : 'Steam에서 최근 출시작을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.' });
  }
});

// 내가 추천한 게임 중 지금 할인 중인 게임 (할인율 높은 순)
router.get('/deals', authMiddleware, async (req, res) => {
  try {
    await ready;
    const [likes] = await pool.query(
      `SELECT appid, name, header_image, score, supports_korean
       FROM user_likes WHERE user_id = ? ORDER BY created_at DESC`,
      [req.user.id]
    );
    if (likes.length === 0) return res.json({ liked_count: 0, deals: [], price_unavailable: false });

    const { prices, stale } = await getPrices(likes.map((l) => l.appid));
    const deals = likes
      .filter((l) => prices[l.appid] && prices[l.appid].discount_percent > 0)
      .map((l) => ({
        appid: l.appid,
        name: l.name,
        header_image: l.header_image,
        score: Number(l.score),
        supports_korean: !!l.supports_korean,
        discount_percent: prices[l.appid].discount_percent,
        initial_price: prices[l.appid].initial_formatted,
        final_price: prices[l.appid].final_formatted,
      }))
      .sort((a, b) => b.discount_percent - a.discount_percent)
      .slice(0, DEALS_SHOW);

    // 가격을 하나도 못 읽었을 때만 "가격 정보 없음"으로 알린다 (일부만 못 읽은 건 그냥 빼고 보여줌)
    const priceUnavailable = stale && Object.keys(prices).length === 0;
    res.json({ liked_count: likes.length, deals, price_unavailable: priceUnavailable });
  } catch (err) {
    console.error('[메인] 할인 조회 실패:', err.message);
    res.status(500).json({ error: '할인 정보를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.' });
  }
});

// 내 취향 분석만 (내 페이지의 도넛 차트용)
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    res.json(await computeProfile(req.user.id));
  } catch (err) {
    console.error('[취향] 분석 실패:', err.message);
    res.status(500).json({ error: '취향을 분석하지 못했어요. 잠시 후 다시 시도해 주세요.' });
  }
});

// 내가 추천한 게임으로 취향 태그를 뽑고, 그 태그의 유명한 게임 / 최근 출시작을 추천
router.get('/recommend', authMiddleware, async (req, res) => {
  try {
    const profile = await computeProfile(req.user.id);
    if (profile.tags.length === 0) {
      return res.json({ profile, tags_used: [], popular: [], recent: [] });
    }

    // 상위 2개 태그를 모두 가진 게임을 먼저 찾고, 너무 적으면 1위 태그만 사용
    let used = profile.tags.slice(0, 2).map((t) => t.tag);
    let popularPool = await cachedSearch(used, 'Reviews_DESC');
    if (popularPool.length < SHOW_COUNT && used.length > 1) {
      used = [used[0]];
      popularPool = await cachedSearch(used, 'Reviews_DESC');
    }
    const recentPool = (await cachedSearch(used, 'Released_DESC')).filter((g) => isReleased(g.released));

    const excluded = await excludedAppids(req.user.id, used);
    const popularCandidates = popularPool.filter((g) => !excluded.has(g.appid));
    const popular = await getCards(popularCandidates, SHOW_COUNT);
    const popularIds = new Set(popular.map((c) => c.appid));
    const recent = await getCards(
      recentPool.filter((g) => !excluded.has(g.appid) && !popularIds.has(g.appid)),
      SHOW_COUNT,
      { minReviews: RECENT_MIN_REVIEWS }
    );

    await markLiked(req.user.id, popular);
    await markLiked(req.user.id, recent);
    await markFriendLikes(req.user.id, popular);
    await markFriendLikes(req.user.id, recent);
    res.json({
      profile,
      tags_used: used.map((t) => ({ tag: t, label: tagLabel(t) })),
      popular,
      recent,
    });
  } catch (err) {
    console.error('[메인] 추천 조회 실패:', err.message);
    res.status(502).json({ error: err.code === 'STEAM_BLOCKED' ? 'Steam이 요청을 일시적으로 제한하고 있어요. 몇 분 뒤에 다시 시도해 주세요.' : '추천 게임을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.' });
  }
});

module.exports = router;
