const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { ready } = require('../services/ensureTables');

const router = express.Router();

const MAX_KEYWORD = 200;
const FREQUENT_MIN = 2; // 이 횟수 이상 검색한 것만 "자주 찾은"에 넣는다
const FREQUENT_SHOW = 5;
const RECENT_SHOW = 8;
const KEEP_SINGLES = 100; // 한 번만 검색한 기록은 최근 이만큼만 남긴다 (오래된 건 정리)

// 공백을 정리한 검색어. 비어 있거나 너무 길면 null
function normalizeKeyword(raw) {
  const k = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!k || k.length > MAX_KEYWORD) return null;
  return k;
}

// 대소문자만 다른 검색어는 같은 기록으로 센다
function hashKeyword(keyword) {
  return crypto.createHash('sha1').update(keyword.toLowerCase()).digest('hex');
}

// 성공한 검색을 기록한다. 기록 실패가 검색 자체를 막으면 안 되므로 예외는 삼킨다.
async function recordSearch(userId, rawKeyword) {
  const keyword = normalizeKeyword(rawKeyword);
  if (!userId || !keyword) return;
  try {
    await ready;
    const [info] = await pool.query(
      `INSERT INTO search_history (user_id, kw_hash, keyword) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE keyword = VALUES(keyword), search_count = search_count + 1,
         last_searched_at = CURRENT_TIMESTAMP`,
      [userId, hashKeyword(keyword), keyword]
    );
    // 새 줄이 생겼을 때만(affectedRows 1) 오래된 일회성 기록을 정리
    if (info && info.affectedRows === 1) {
      const [old] = await pool.query(
        `SELECT kw_hash FROM search_history WHERE user_id = ? AND search_count = 1
         ORDER BY last_searched_at DESC LIMIT ?, 500`,
        [userId, KEEP_SINGLES]
      );
      if (old.length > 0) {
        await pool.query('DELETE FROM search_history WHERE user_id = ? AND kw_hash IN (?)', [
          userId,
          old.map((r) => r.kw_hash),
        ]);
      }
    }
  } catch (err) {
    console.error('[검색 기록] 저장 실패:', err.message);
  }
}

const toItem = (r) => ({
  keyword: r.keyword,
  count: r.search_count,
  last_searched_at: r.last_searched_at,
});

// 내 검색 기록. frequent = 자주 찾은 검색, recent = 최근 검색(자주 찾은 것과 겹치지 않게)
router.get('/', authMiddleware, async (req, res) => {
  try {
    await ready;
    const [freq] = await pool.query(
      `SELECT kw_hash, keyword, search_count, last_searched_at FROM search_history
       WHERE user_id = ? AND search_count >= ?
       ORDER BY search_count DESC, last_searched_at DESC LIMIT ?`,
      [req.user.id, FREQUENT_MIN, FREQUENT_SHOW]
    );
    const [rec] = await pool.query(
      `SELECT kw_hash, keyword, search_count, last_searched_at FROM search_history
       WHERE user_id = ? ORDER BY last_searched_at DESC LIMIT ?`,
      [req.user.id, FREQUENT_SHOW + RECENT_SHOW]
    );
    const inFrequent = new Set(freq.map((r) => r.kw_hash));
    const recent = rec.filter((r) => !inFrequent.has(r.kw_hash)).slice(0, RECENT_SHOW);
    res.json({ frequent: freq.map(toItem), recent: recent.map(toItem) });
  } catch (err) {
    console.error('[검색 기록] 조회 실패:', err.message);
    res.status(500).json({ error: '검색 기록을 불러오지 못했어요.' });
  }
});

// 기록 전체 삭제 (먼저 등록해야 아래 DELETE /?keyword= 와 헷갈리지 않음)
router.delete('/all', authMiddleware, async (req, res) => {
  try {
    await ready;
    await pool.query('DELETE FROM search_history WHERE user_id = ?', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[검색 기록] 전체 삭제 실패:', err.message);
    res.status(500).json({ error: '검색 기록을 지우지 못했어요.' });
  }
});

// 기록 한 개 삭제: DELETE /api/history?keyword=공포
router.delete('/', authMiddleware, async (req, res) => {
  const keyword = normalizeKeyword(req.query.keyword);
  if (!keyword) return res.status(400).json({ error: '지울 검색어가 필요해요.' });
  try {
    await ready;
    await pool.query('DELETE FROM search_history WHERE user_id = ? AND kw_hash = ?', [
      req.user.id,
      hashKeyword(keyword),
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[검색 기록] 삭제 실패:', err.message);
    res.status(500).json({ error: '검색 기록을 지우지 못했어요.' });
  }
});

module.exports = router;
module.exports.recordSearch = recordSearch;
