// 친구 관계 조회에 쓰는 공통 함수
//  - 친구 관계는 friendships(requester_id, addressee_id, status) 한 줄로 저장하고,
//    status='accepted'이면 방향과 상관없이 서로 친구다.
//  - 추천 목록을 비공개(user_settings.likes_private=1)로 한 친구의 추천은 어디에서도 보여주지 않는다.
const pool = require('../db');
const { ready } = require('./ensureTables');

// 두 사용자가 (수락된) 친구인지
async function areFriends(a, b) {
  await ready;
  const [rows] = await pool.query(
    `SELECT 1 AS ok FROM friendships
     WHERE status = 'accepted'
       AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
     LIMIT 1`,
    [a, b, b, a]
  );
  return rows.length > 0;
}

// 검색 결과/추천 카드 배열에 friend_likers(이 게임을 추천한 내 친구들의 아이디)를 붙인다.
// 친구 기능에 문제가 있어도 검색 자체는 되어야 하므로 실패하면 빈 배열로 둔다.
async function markFriendLikes(userId, results) {
  for (const r of results) r.friend_likers = [];
  if (!userId || results.length === 0) return;
  try {
    await ready;
    const [rows] = await pool.query(
      `SELECT ul.appid, u.username
       FROM user_likes ul
       JOIN friendships f ON f.status = 'accepted'
         AND ((f.requester_id = ? AND f.addressee_id = ul.user_id) OR (f.addressee_id = ? AND f.requester_id = ul.user_id))
       JOIN users u ON u.id = ul.user_id
       LEFT JOIN user_settings s ON s.user_id = ul.user_id
       WHERE ul.appid IN (?) AND COALESCE(s.likes_private, 0) = 0
       ORDER BY ul.created_at DESC`,
      [userId, userId, results.map((r) => r.appid)]
    );
    const byApp = new Map();
    for (const row of rows) {
      if (!byApp.has(row.appid)) byApp.set(row.appid, []);
      byApp.get(row.appid).push(row.username);
    }
    for (const r of results) r.friend_likers = byApp.get(r.appid) || [];
  } catch (err) {
    console.error('[친구] 친구 추천 표시 실패:', err.message);
  }
}

module.exports = { areFriends, markFriendLikes };
