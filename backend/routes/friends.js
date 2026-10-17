const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { ready } = require('../services/ensureTables');
const { readSummaries } = require('../services/aiSummaryService');
const { areFriends, markFriendLikes } = require('../services/friendService');
const { markLiked } = require('./likes');

const router = express.Router();

const MAX_PENDING_OUT = 30; // 아직 수락 안 된 요청을 이만큼 이상 보내 둘 수 없다 (요청 남발 방지)
const POPULAR_SHOW = 12;

const parseId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// 친구 현황: 친구 목록, 받은 요청, 보낸 요청, 내 공개 설정
router.get('/', authMiddleware, async (req, res) => {
  try {
    await ready;
    const me = req.user.id;
    const [rows] = await pool.query(
      `SELECT f.requester_id, f.addressee_id, f.status, f.created_at,
              u.id AS other_id, u.username AS other_name,
              COALESCE(s.likes_private, 0) AS likes_private,
              (SELECT COUNT(*) FROM user_likes ul WHERE ul.user_id = u.id) AS likes_count
       FROM friendships f
       JOIN users u ON u.id = IF(f.requester_id = ?, f.addressee_id, f.requester_id)
       LEFT JOIN user_settings s ON s.user_id = u.id
       WHERE f.requester_id = ? OR f.addressee_id = ?
       ORDER BY f.created_at DESC`,
      [me, me, me]
    );
    const friends = [];
    const incoming = [];
    const outgoing = [];
    for (const r of rows) {
      const person = { id: r.other_id, username: r.other_name, requested_at: r.created_at };
      if (r.status === 'accepted') {
        const priv = !!r.likes_private;
        friends.push({ ...person, likes_private: priv, likes_count: priv ? null : Number(r.likes_count) });
      } else if (r.addressee_id === me) incoming.push(person);
      else outgoing.push(person);
    }
    friends.sort((a, b) => a.username.localeCompare(b.username, 'ko'));
    const [[mine]] = await pool.query('SELECT likes_private FROM user_settings WHERE user_id = ?', [me]);
    res.json({ friends, incoming, outgoing, me: { likes_private: !!(mine && mine.likes_private) } });
  } catch (err) {
    console.error('[친구] 현황 조회 실패:', err.message);
    res.status(500).json({ error: '친구 목록을 불러오지 못했어요.' });
  }
});

// 받은 친구 요청 수 (메뉴의 알림 표시용)
router.get('/pending-count', authMiddleware, async (req, res) => {
  try {
    await ready;
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS n FROM friendships WHERE addressee_id = ? AND status = 'pending'`,
      [req.user.id]
    );
    res.json({ incoming: Number(row.n) });
  } catch (err) {
    res.json({ incoming: 0 }); // 알림 표시가 실패해도 화면은 정상이어야 한다
  }
});

// 친구들이 추천했는데 나는 아직 추천/비추천하지 않은 게임 (많은 친구가 추천한 순)
router.get('/popular', authMiddleware, async (req, res) => {
  try {
    await ready;
    const me = req.user.id;
    const [rows] = await pool.query(
      `SELECT ul.appid, MAX(ul.name) AS name, MAX(ul.header_image) AS header_image, MAX(ul.score) AS score,
              MAX(ul.total_positive) AS total_positive, MAX(ul.total_negative) AS total_negative,
              MAX(ul.supports_korean) AS supports_korean, COUNT(*) AS friend_count, MAX(ul.created_at) AS last_liked
       FROM user_likes ul
       JOIN friendships f ON f.status = 'accepted'
         AND ((f.requester_id = ? AND f.addressee_id = ul.user_id) OR (f.addressee_id = ? AND f.requester_id = ul.user_id))
       LEFT JOIN user_settings s ON s.user_id = ul.user_id
       WHERE COALESCE(s.likes_private, 0) = 0
         AND ul.appid NOT IN (SELECT appid FROM user_likes WHERE user_id = ?)
         AND ul.appid NOT IN (SELECT appid FROM user_dislikes WHERE user_id = ?)
       GROUP BY ul.appid
       ORDER BY friend_count DESC, last_liked DESC
       LIMIT ?`,
      [me, me, me, me, POPULAR_SHOW]
    );
    const results = rows.map((r) => {
      const total = Number(r.total_positive) + Number(r.total_negative);
      return {
        appid: r.appid,
        name: r.name,
        header_image: r.header_image,
        score: Number(r.score),
        total_positive: Number(r.total_positive),
        total_negative: Number(r.total_negative),
        review_count: total,
        supports_korean: !!r.supports_korean,
      };
    });
    await markLiked(me, results);
    await markFriendLikes(me, results);
    res.json({ results });
  } catch (err) {
    console.error('[친구] 추천 게임 조회 실패:', err.message);
    res.status(500).json({ error: '친구들이 추천한 게임을 불러오지 못했어요.' });
  }
});

// 내 추천 목록을 친구에게 보여줄지
router.put('/settings', authMiddleware, async (req, res) => {
  if (typeof req.body.likes_private !== 'boolean') {
    return res.status(400).json({ error: 'likes_private는 true 또는 false여야 해요.' });
  }
  try {
    await ready;
    await pool.query(
      `INSERT INTO user_settings (user_id, likes_private) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE likes_private = VALUES(likes_private)`,
      [req.user.id, req.body.likes_private ? 1 : 0]
    );
    res.json({ likes_private: req.body.likes_private });
  } catch (err) {
    console.error('[친구] 설정 저장 실패:', err.message);
    res.status(500).json({ error: '설정을 저장하지 못했어요.' });
  }
});

// 친구 요청 보내기. 상대가 이미 나에게 요청을 보낸 상태면 바로 친구가 된다.
router.post('/request', authMiddleware, async (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  if (!username || username.length > 50) {
    return res.status(400).json({ error: '친구의 아이디를 입력해 주세요.' });
  }
  try {
    await ready;
    const me = req.user.id;
    const [[target]] = await pool.query('SELECT id, username FROM users WHERE username = ?', [username]);
    if (!target) return res.status(404).json({ error: '그런 아이디의 사용자를 찾지 못했어요. 아이디를 정확히 입력해 주세요.' });
    if (target.id === me) return res.status(400).json({ error: '내 아이디는 친구로 추가할 수 없어요.' });

    const [existing] = await pool.query(
      `SELECT requester_id, status FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
      [me, target.id, target.id, me]
    );
    if (existing.length > 0) {
      const row = existing[0];
      if (row.status === 'accepted') return res.status(409).json({ error: '이미 친구예요.' });
      if (row.requester_id === me) return res.status(409).json({ error: '이미 요청을 보냈어요. 상대가 수락하면 친구가 돼요.' });
      // 상대가 먼저 보낸 요청이 있으면 수락으로 처리
      await pool.query(
        `UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`,
        [target.id, me]
      );
      return res.json({ status: 'accepted', user: { id: target.id, username: target.username } });
    }

    const [[pending]] = await pool.query(
      `SELECT COUNT(*) AS n FROM friendships WHERE requester_id = ? AND status = 'pending'`,
      [me]
    );
    if (Number(pending.n) >= MAX_PENDING_OUT) {
      return res.status(429).json({ error: `수락을 기다리는 요청이 ${MAX_PENDING_OUT}개나 있어요. 일부를 취소한 뒤 다시 보내 주세요.` });
    }

    await pool.query('INSERT INTO friendships (requester_id, addressee_id) VALUES (?, ?)', [me, target.id]);

    // 거의 동시에 서로 요청을 보냈다면 한 줄만 남기고 친구로 만든다
    const [reverse] = await pool.query(
      `SELECT 1 FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`,
      [target.id, me]
    );
    if (reverse.length > 0) {
      await pool.query(`UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?`, [target.id, me]);
      await pool.query('DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ?', [me, target.id]);
      return res.status(201).json({ status: 'accepted', user: { id: target.id, username: target.username } });
    }
    res.status(201).json({ status: 'pending', user: { id: target.id, username: target.username } });
  } catch (err) {
    console.error('[친구] 요청 실패:', err.message);
    res.status(500).json({ error: '친구 요청을 보내지 못했어요.' });
  }
});

// 받은 요청 수락 / 거절 (id = 요청을 보낸 사람)
router.post('/:id/accept', authMiddleware, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '잘못된 요청이에요.' });
  try {
    await ready;
    const [info] = await pool.query(
      `UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`,
      [id, req.user.id]
    );
    if (!info.affectedRows) return res.status(404).json({ error: '수락할 요청이 없어요. 이미 취소되었을 수 있어요.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[친구] 수락 실패:', err.message);
    res.status(500).json({ error: '요청을 수락하지 못했어요.' });
  }
});

router.post('/:id/decline', authMiddleware, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '잘못된 요청이에요.' });
  try {
    await ready;
    const [info] = await pool.query(
      `DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'`,
      [id, req.user.id]
    );
    if (!info.affectedRows) return res.status(404).json({ error: '거절할 요청이 없어요. 이미 취소되었을 수 있어요.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[친구] 거절 실패:', err.message);
    res.status(500).json({ error: '요청을 거절하지 못했어요.' });
  }
});

// 친구 삭제 / 내가 보낸 요청 취소
router.delete('/:id', authMiddleware, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '잘못된 요청이에요.' });
  try {
    await ready;
    const me = req.user.id;
    await pool.query(
      `DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
      [me, id, id, me]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[친구] 삭제 실패:', err.message);
    res.status(500).json({ error: '친구를 삭제하지 못했어요.' });
  }
});

// 친구가 추천한 게임. 친구 사이이고, 친구가 비공개로 해 두지 않았을 때만 볼 수 있다.
router.get('/:id/likes', authMiddleware, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: '잘못된 요청이에요.' });
  try {
    await ready;
    const me = req.user.id;
    if (!(await areFriends(me, id))) return res.status(403).json({ error: '친구의 추천 목록만 볼 수 있어요.' });

    const [[friend]] = await pool.query(
      `SELECT u.id, u.username, COALESCE(s.likes_private, 0) AS likes_private
       FROM users u LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?`,
      [id]
    );
    if (!friend) return res.status(404).json({ error: '사용자를 찾지 못했어요.' });
    if (friend.likes_private) {
      return res.status(403).json({ error: `${friend.username}님은 추천 목록을 비공개로 해 두었어요.`, private: true });
    }

    const [rows] = await pool.query(
      `SELECT appid, name, header_image, score, total_positive, total_negative, supports_korean, created_at
       FROM user_likes WHERE user_id = ? ORDER BY created_at DESC`,
      [id]
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
      ai_summary: summaries[r.appid] || null,
    }));
    await markLiked(me, results); // 내가 이미 추천한 게임에는 표시
    res.json({ friend: { id: friend.id, username: friend.username }, count: results.length, results });
  } catch (err) {
    console.error('[친구] 추천 목록 조회 실패:', err.message);
    res.status(500).json({ error: '친구의 추천 목록을 불러오지 못했어요.' });
  }
});

module.exports = router;
