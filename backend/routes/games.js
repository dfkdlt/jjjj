const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { getTagId } = require('../keywordMap');
const { parseKeywordsToTags } = require('../services/queryParser');
const { attachSummaries } = require('../services/aiSummaryService');
const {
  fetchGamesByOfficialTagSearch,
  fetchReviewSummary,
  calculateScore,
  fetchGameDetails,
  fetchTopHelpfulReviews,
} = require('../services/steamService');
const { isAlreadyKorean, translateToKorean } = require('../services/translateService');

const { markLiked } = require('./likes');
const { getHiddenAppids } = require('../services/dislikeFilter');
const { recordSearch } = require('./history');
const { markFriendLikes } = require('../services/friendService');

const router = express.Router();

const STEAM_BUSY_MESSAGE = 'Steam이 요청을 일시적으로 제한하고 있어요. 몇 분 뒤에 다시 시도해 주세요. (이미 검색한 적 있는 게임은 그대로 볼 수 있어요)';

const CACHE_HOURS = 48; // 캐시 유효 시간
const REVIEWS_PER_GAME = 3; // 게임당 보여줄 유익한 리뷰 개수
const KOREAN_MIN_CACHED = 5; // '한글 지원만' 검색일 때 캐시에 이만큼 이상 있어야 캐시를 쓰고, 아니면 새로 조회
const MAX_INPUT = 200;
const RESULT_COUNT = 10; // 실제로 점수/리뷰까지 계산해서 보여줄 게임 수

// game_id 목록에 대한 상위 리뷰들을 한 번에 조회해서 { [game_id]: [review, ...] } 형태로 반환
async function fetchReviewsMapForGameIds(gameIds) {
  if (gameIds.length === 0) return {};

  const [rows] = await pool.query(
    `SELECT game_id, review_text, translated_text, voted_up, votes_up, language
     FROM game_reviews
     WHERE game_id IN (?)
     ORDER BY votes_up DESC`,
    [gameIds]
  );

  const map = {};
  for (const row of rows) {
    if (!map[row.game_id]) map[row.game_id] = [];
    if (map[row.game_id].length < REVIEWS_PER_GAME) {
      map[row.game_id].push(row);
    }
  }
  return map;
}

// "더 보기"용 커서. 서버는 상태를 기억하지 않고, 응답에 들어 있는 next_cursor를 그대로 다시 받아 이어서 처리한다.
//   (없음) 첫 페이지      c.N  캐시에 저장된 목록의 N번째부터
//   s.N    Steam 검색 결과의 N번째부터        x.N  s.N과 같지만 이미 캐시에 있는(= 앞에서 보여 준) 게임은 건너뜀
function parseCursor(raw) {
  if (raw === undefined || raw === '') return { phase: 'first', n: 0 };
  const m = /^([csx])\.(\d{1,6})$/.exec(String(raw));
  return m ? { phase: m[1], n: Number(m[2]) } : null;
}

// 키워드(1개 이상, 공백으로 구분)로 게임 검색 (점수 높은 순 정렬)
// GET /api/games/search?keyword=공포 멀티  -> 공포 AND 멀티 태그를 모두 가진 게임
// 한 번에 RESULT_COUNT개씩 돌려주고, 더 있을 수 있으면 next_cursor를 함께 준다.
router.get('/search', authMiddleware, async (req, res) => {
  const { keyword } = req.query;
  if (!keyword) {
    return res.status(400).json({ error: 'keyword 쿼리 파라미터가 필요합니다.' });
  }

  if (String(keyword).length > MAX_INPUT) {
    return res.status(400).json({ error: `검색어는 ${MAX_INPUT}자 이내로 입력해 주세요.` });
  }

  const cursor = parseCursor(req.query.cursor);
  if (!cursor) {
    return res.status(400).json({ error: '잘못된 cursor 값입니다.' });
  }

  const { tags, failed, aiMapped, interpretation, koreanOnly, naturalLanguage } = await parseKeywordsToTags(String(keyword));
  const meta = {
    keyword,
    tags,
    ai_mapped: aiMapped,
    interpretation: interpretation || null,
    korean_only: !!koreanOnly,
    natural_language: !!naturalLanguage,
  };

  if (failed.length > 0) {
    const looksLikeSentence = String(keyword).trim().split(/\s+/).length > 2;
    let error;
    if (looksLikeSentence && !process.env.AI_API_KEY) {
      error = '문장으로 검색하려면 서버에 AI 키(AI_API_KEY)가 필요해요. 지금은 "공포 멀티"처럼 키워드로 입력해 주세요.';
    } else if (looksLikeSentence) {
      error = '문장을 Steam 태그로 해석하지 못했어요. 장르나 분위기를 넣어서 다시 써 보세요. (예: 친구들이랑 하는 공포 멀티게임)';
    } else {
      error = `"${failed.join('", "')}" 표현을 Steam 태그로 바꾸지 못했어요. 다른 표현으로 입력해보세요. (예: 공포, 멀티, 힐링, 귀여운)`;
    }
    return res.status(400).json({ error });
  }
  if (tags.length === 0) {
    return res.status(400).json({ error: '유효한 키워드를 입력하세요.' });
  }

  const tagIds = tags.map((t) => getTagId(t));

  try {
    // 1) DB 캐시 확인: 요청한 태그를 '모두' 가진 게임만 (AND 조건)
    const [cached] = await pool.query(
      `SELECT g.id, g.appid, g.name, g.total_positive, g.total_negative, g.score,
              g.supports_korean, g.header_image, g.last_updated
       FROM games g
       JOIN game_keywords gk ON gk.game_id = g.id
       WHERE gk.keyword IN (?)
         AND g.last_updated >= (NOW() - INTERVAL ? HOUR)
       GROUP BY g.id
       HAVING COUNT(DISTINCT gk.keyword) = ?
       ORDER BY g.score DESC`,
      [tags, CACHE_HOURS, tags.length]
    );

    // 내가 비추천했거나, 이 태그가 아니라는 의견이 충분히 모인 게임은 결과에서 뺀다
    const hidden = await getHiddenAppids(req.user.id, tags);

    const visible = cached.filter((g) => !hidden.has(g.appid));
    const usable = koreanOnly ? visible.filter((g) => g.supports_korean) : visible;
    // '한글 지원만'이면 캐시에 한글 지원 게임이 충분할 때만 캐시를 쓰고, 부족하면 새로 조회
    const cacheOk = cached.length > 0 && (!koreanOnly || usable.length >= KOREAN_MIN_CACHED);

    if (cacheOk && (cursor.phase === 'first' || cursor.phase === 'c')) {
      const from = cursor.phase === 'c' ? cursor.n : 0;
      const page = usable.slice(from, from + RESULT_COUNT);
      const hiddenCount = cached.length - visible.length;
      const reviewsMap = await fetchReviewsMapForGameIds(page.map((g) => g.id));
      const results = page.map((g) => ({
        appid: g.appid,
        name: g.name,
        total_positive: g.total_positive,
        total_negative: g.total_negative,
        score: g.score,
        supports_korean: !!g.supports_korean,
        header_image: g.header_image,
        top_reviews: reviewsMap[g.id] || [],
      }));
      await attachSummaries(results, { regenerate: false }); // 저장된 AI 요약 사용, 없는 것만 생성
      await markLiked(req.user.id, results);
      await markFriendLikes(req.user.id, results);
      // 캐시를 다 보여 줬으면 Steam에서 캐시에 없는 게임을 더 찾아 본다
      const nextCursor = from + RESULT_COUNT < usable.length ? `c.${from + RESULT_COUNT}` : 'x.0';
      if (cursor.phase === 'first' && results.length > 0) await recordSearch(req.user.id, keyword);
      return res.json({ ...meta, source: 'cache', hidden_count: hiddenCount, next_cursor: nextCursor, results });
    }

    // 2) 캐시가 없거나 다 보여 줬으면 Steam 공식 검색(태그 필터)으로 새로 조회
    //    캐시를 다 보여 준 뒤(c/x)에는 캐시에 이미 있는 게임을 건너뛰고 Steam 결과의 처음부터 훑는다.
    const skipKnown = cursor.phase === 'c' || cursor.phase === 'x';
    const startAt = cursor.phase === 'c' ? 0 : cursor.n;
    const known = skipKnown ? new Set(cached.map((g) => g.appid)) : new Set();

    const { totalCount, games: allCandidates } = await fetchGamesByOfficialTagSearch(tagIds, 100, startAt);

    const results = [];
    let steamBlocked = false; // Steam이 요청을 일시 제한한 경우
    let examined = 0; // 이번에 살펴본 후보 수 (다음 페이지가 이어질 위치 계산용)
    let hiddenCount = 0;
    // 후보 중 일부가 실패해도(연령 확인 필요, 일시적 오류 등) 목표 개수(RESULT_COUNT)를
    // 채울 때까지 다음 후보로 계속 넘어감. 중간에 후보가 바닥나면 그만큼만 반환.
    for (const game of allCandidates) {
      if (results.length >= RESULT_COUNT) break;
      examined++;
      if (hidden.has(game.appid)) { hiddenCount++; continue; }
      if (known.has(game.appid)) continue;
      try {
        const { positive, negative } = await fetchReviewSummary(game.appid);
        const score = calculateScore(positive, negative);
        const { supportsKorean, headerImage } = await fetchGameDetails(game.appid);
        if (koreanOnly && !supportsKorean) continue; // '한글 지원만' 조건이면 다음 후보로
        const topReviewsRaw = await fetchTopHelpfulReviews(game.appid, REVIEWS_PER_GAME);

        // 한국어가 아닌 리뷰만 번역 (한국어 리뷰는 번역할 필요 없음)
        const topReviews = [];
        for (const review of topReviewsRaw) {
          const translatedText = isAlreadyKorean(review.language)
            ? null
            : await translateToKorean(review.reviewText);
          topReviews.push({ ...review, translatedText });
        }

        // 게임 정보 upsert
        await pool.query(
          `INSERT INTO games (appid, name, total_positive, total_negative, score, supports_korean, header_image)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             total_positive = VALUES(total_positive),
             total_negative = VALUES(total_negative),
             score = VALUES(score),
             supports_korean = VALUES(supports_korean),
             header_image = VALUES(header_image),
             last_updated = CURRENT_TIMESTAMP`,
          [game.appid, game.name, positive, negative, score, supportsKorean ? 1 : 0, headerImage]
        );

        const [[gameRow]] = await pool.query('SELECT id FROM games WHERE appid = ?', [
          game.appid,
        ]);

        // 요청한 태그 전부를 이 게임에 매핑 (다음번엔 단일/조합 검색 모두 캐시로 처리됨)
        for (const t of tags) {
          await pool.query(`INSERT IGNORE INTO game_keywords (game_id, keyword) VALUES (?, ?)`, [
            gameRow.id,
            t,
          ]);
        }

        // 기존 리뷰 캐시 삭제 후 새로 저장
        await pool.query('DELETE FROM game_reviews WHERE game_id = ?', [gameRow.id]);
        for (const review of topReviews) {
          await pool.query(
            `INSERT INTO game_reviews (game_id, review_text, translated_text, voted_up, votes_up, language)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              gameRow.id,
              review.reviewText,
              review.translatedText,
              review.votedUp,
              review.votesUp,
              review.language,
            ]
          );
        }

        results.push({
          appid: game.appid,
          name: game.name,
          total_positive: positive,
          total_negative: negative,
          score,
          supports_korean: supportsKorean,
          header_image: headerImage,
          top_reviews: topReviews.map((r) => ({
            review_text: r.reviewText,
            translated_text: r.translatedText,
            voted_up: r.votedUp,
            votes_up: r.votesUp,
            language: r.language,
          })),
        });
      } catch (innerErr) {
        console.error(`appid ${game.appid}(${game.name}) 처리 실패:`, innerErr.message);
        if (innerErr.code === 'STEAM_BLOCKED') {
          steamBlocked = true;
          break; // 계속 물어봐도 막힐 뿐이라 여기서 멈춘다
        }
      }
    }

    if (steamBlocked && results.length === 0) {
      return res.status(503).json({ error: STEAM_BUSY_MESSAGE });
    }

    // 다음 위치: Steam에 아직 안 본 결과가 남아 있을 때만. 살펴본 게 없으면(끝에 도달) 더 이상 없음
    const nextStart = startAt + examined;
    const nextCursor = examined > 0 && nextStart < totalCount ? `${skipKnown ? 'x' : 's'}.${nextStart}` : null;

    console.log(
      `[검색 요약] 태그=${tags.join(',')} Steam ${startAt}번째부터 ${examined}개 확인 -> 성공=${results.length}개 (Steam 전체 매칭=${totalCount}개)`
    );

    await attachSummaries(results, { regenerate: true }); // 새로 가져온 리뷰 기준으로 AI 요약 생성

    results.sort((a, b) => b.score - a.score);
    await markLiked(req.user.id, results);
    await markFriendLikes(req.user.id, results);
    if (cursor.phase === 'first' && results.length > 0) await recordSearch(req.user.id, keyword);
    res.json({ ...meta, source: 'live', total_matching_on_steam: totalCount, hidden_count: hiddenCount, next_cursor: nextCursor, results });
  } catch (err) {
    console.error(err);
    if (err.code === 'STEAM_BLOCKED') return res.status(503).json({ error: STEAM_BUSY_MESSAGE });
    res.status(500).json({ error: '게임 검색 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
