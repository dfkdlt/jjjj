const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { readSummaries } = require('../services/aiSummaryService');

const router = express.Router();

// 사용자가 추천(좋아요)한 게임. games 캐시를 비워도 남도록 appid 기준 + 표시용 정보 스냅샷을 같이 저장합니다.
// 테이블은 서버 시작 시 services/ensureTables.js가 자동으로 만듭니다.
const { ready } = require('../services/ensureTables');

// 검색 결과 배열에 liked(내가 추천했는지) 값을 붙임
async function markLiked(userId, results) {
  for (const r of results) r.liked = false;
  if (!userId || results.length === 0) return;
  try {
    await ready;
    const [rows] = await pool.query('SELECT appid FROM user_likes WHERE user_id = ? AND appid IN (?)', [
      userId,
      results.map((r) => r.appid),
    ]);
    const set = new Set(rows.map((r) => r.appid));
    for (const r of results) r.liked = set.has(r.appid);
  } catch (err) {
    console.error('[추천] 상태 조회 실패:', err.message);
  }
}

// 내가 추천한 게임 목록 (최근 추천 순)
router.get('/', authMiddleware, async (req, res) => {
  try {
    await ready;
    const [rows] = await pool.query(
      `SELECT appid, name, header_image, score, total_positive, total_negative, supports_korean, created_at
       FROM user_likes WHERE user_id = ? ORDER BY created_at DESC`,
      [req.user.id]
    );
    const summaries = await readSummaries(rows.map((r) => r.appid));
    const results = rows.map((r) => ({
      appid: r.appid,
      name: r.name,
      header_image: r.header_image,
      score: Number(r.score),
      total_positive: r.total_positive,
      total_negative: r.total_negative,
      supports_korean: !!r.supports_korean,
      liked_at: r.created_at,
      liked: true,
      ai_summary: summaries[r.appid] || null,
    }));
    res.json({ count: results.length, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '추천한 게임을 불러오지 못했습니다.' });
  }
});

// 추천 추가: POST /api/likes/:appid  (games 테이블에 저장된 정보를 스냅샷으로 복사)
router.post('/:appid', authMiddleware, async (req, res) => {
  const appid = parseInt(req.params.appid, 10);
  if (!Number.isInteger(appid)) return res.status(400).json({ error: '잘못된 appid 입니다.' });
  try {
    await ready;
    const [[game]] = await pool.query(
      `SELECT appid, name, header_image, score, total_positive, total_negative, supports_korean
       FROM games WHERE appid = ?`,
      [appid]
    );
    if (!game) return res.status(404).json({ error: '게임 정보를 찾지 못했어요. 다시 검색한 뒤 추천해 주세요.' });
    await pool.query(
      `INSERT INTO user_likes (user_id, appid, name, header_image, score, total_positive, total_negative, supports_korean)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), header_image = VALUES(header_image), score = VALUES(score),
         total_positive = VALUES(total_positive), total_negative = VALUES(total_negative),
         supports_korean = VALUES(supports_korean)`,
      [req.user.id, game.appid, game.name, game.header_image, game.score, game.total_positive, game.total_negative, game.supports_korean]
    );
    // 추천하면 이전에 남긴 비추천(과 태그 의견)은 해제
    await pool.query('DELETE FROM user_dislikes WHERE user_id = ? AND appid = ?', [req.user.id, appid]);
    await pool.query('DELETE FROM tag_reports WHERE user_id = ? AND appid = ?', [req.user.id, appid]);
    res.json({ appid, liked: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '추천하지 못했습니다.' });
  }
});

// 추천 취소: DELETE /api/likes/:appid
router.delete('/:appid', authMiddleware, async (req, res) => {
  const appid = parseInt(req.params.appid, 10);
  if (!Number.isInteger(appid)) return res.status(400).json({ error: '잘못된 appid 입니다.' });
  try {
    await ready;
    await pool.query('DELETE FROM user_likes WHERE user_id = ? AND appid = ?', [req.user.id, appid]);
    res.json({ appid, liked: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '추천을 취소하지 못했습니다.' });
  }
});

module.exports = router;
module.exports.markLiked = markLiked;
