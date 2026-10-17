const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { ready } = require('../services/ensureTables');
const { classifyDislike, MAX_TEXT } = require('../services/aiDislikeService');
const { THRESHOLD } = require('../services/dislikeFilter');
const { findTagName } = require('../keywordMap');

const router = express.Router();

function parseJsonArray(s) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

// 내가 비추천한 게임 목록 (최근 순)
router.get('/', authMiddleware, async (req, res) => {
  try {
    await ready;
    const [rows] = await pool.query(
      `SELECT appid, name, header_image, score, reason_text, category, mismatch_tags, ai_reason, created_at
       FROM user_dislikes WHERE user_id = ? ORDER BY created_at DESC`,
      [req.user.id]
    );
    const results = rows.map((r) => ({
      appid: r.appid,
      name: r.name,
      header_image: r.header_image,
      score: Number(r.score),
      reason_text: r.reason_text,
      category: r.category,
      mismatch_tags: parseJsonArray(r.mismatch_tags),
      ai_reason: r.ai_reason,
      disliked_at: r.created_at,
    }));
    res.json({ count: results.length, threshold: THRESHOLD, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '비추천한 게임을 불러오지 못했습니다.' });
  }
});

// 비추천 등록: POST /api/dislikes/:appid   body: { text, tags: ["Horror", ...] }
router.post('/:appid', authMiddleware, async (req, res) => {
  const appid = parseInt(req.params.appid, 10);
  if (!Number.isInteger(appid)) return res.status(400).json({ error: '잘못된 appid 입니다.' });

  const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: '이유를 입력해 주세요.' });
  if (text.length > MAX_TEXT) return res.status(400).json({ error: `이유는 ${MAX_TEXT}자 이내로 입력해 주세요.` });

  // 이번 검색에 쓴 태그 (카탈로그에 있는 것만)
  const rawTags = Array.isArray(req.body.tags) ? req.body.tags.slice(0, 6) : [];
  const searchedTags = [...new Set(rawTags.map((t) => findTagName(String(t))).filter(Boolean))];

  try {
    await ready;
    const [[game]] = await pool.query('SELECT appid, name, header_image, score FROM games WHERE appid = ?', [appid]);
    if (!game) return res.status(404).json({ error: '게임 정보를 찾지 못했어요. 다시 검색한 뒤 시도해 주세요.' });

    const result = await classifyDislike({ gameName: game.name, searchedTags, text });

    await pool.query(
      `INSERT INTO user_dislikes (user_id, appid, name, header_image, score, reason_text, category, mismatch_tags, ai_reason, searched_tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), header_image = VALUES(header_image), score = VALUES(score),
         reason_text = VALUES(reason_text), category = VALUES(category), mismatch_tags = VALUES(mismatch_tags),
         ai_reason = VALUES(ai_reason), searched_tags = VALUES(searched_tags), created_at = CURRENT_TIMESTAMP`,
      [req.user.id, appid, game.name, game.header_image, game.score, text, result.category,
       JSON.stringify(result.mismatch_tags), result.reason, JSON.stringify(searchedTags)]
    );

    // 의견을 바꿔 다시 쓴 경우를 위해 이전 태그 의견은 지우고 새로 기록
    await pool.query('DELETE FROM tag_reports WHERE user_id = ? AND appid = ?', [req.user.id, appid]);
    const counts = {};
    if (result.category === 'tag_mismatch') {
      for (const tag of result.mismatch_tags) {
        await pool.query('INSERT IGNORE INTO tag_reports (user_id, appid, tag) VALUES (?, ?, ?)', [req.user.id, appid, tag]);
        const [[row]] = await pool.query(
          'SELECT COUNT(DISTINCT user_id) AS n FROM tag_reports WHERE appid = ? AND tag = ?',
          [appid, tag]
        );
        counts[tag] = Number(row.n);
      }
    }

    // 비추천한 게임이 추천 목록에 남아 있으면 모순이므로 뺀다
    await pool.query('DELETE FROM user_likes WHERE user_id = ? AND appid = ?', [req.user.id, appid]);

    res.json({
      appid,
      disliked: true,
      category: result.category,
      mismatch_tags: result.mismatch_tags,
      reason: result.reason,
      ai_used: result.ai_used,
      report_counts: counts,
      threshold: THRESHOLD,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '비추천을 저장하지 못했습니다.' });
  }
});

// 비추천 취소: DELETE /api/dislikes/:appid  (같이 남긴 태그 의견도 함께 취소)
router.delete('/:appid', authMiddleware, async (req, res) => {
  const appid = parseInt(req.params.appid, 10);
  if (!Number.isInteger(appid)) return res.status(400).json({ error: '잘못된 appid 입니다.' });
  try {
    await ready;
    await pool.query('DELETE FROM user_dislikes WHERE user_id = ? AND appid = ?', [req.user.id, appid]);
    await pool.query('DELETE FROM tag_reports WHERE user_id = ? AND appid = ?', [req.user.id, appid]);
    res.json({ appid, disliked: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '비추천을 취소하지 못했습니다.' });
  }
});

module.exports = router;
