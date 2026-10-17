// 검색 결과에서 숨길 게임(appid) 집합을 계산한다.
//  1) 내가 비추천한 게임 (이유가 취향이든 태그 불일치든)
//  2) 이번 검색 태그에 대해 "이 태그가 아니다"라는 의견이 서로 다른 사용자 N명 이상인 게임 (모두에게 적용)
require('dotenv').config();
const pool = require('../db');
const { ready } = require('./ensureTables');

const THRESHOLD = Math.max(1, parseInt(process.env.DISLIKE_THRESHOLD || '2', 10) || 2);

async function getHiddenAppids(userId, tags) {
  const hidden = new Set();
  try {
    await ready;
    const [mine] = await pool.query('SELECT appid FROM user_dislikes WHERE user_id = ?', [userId]);
    for (const r of mine) hidden.add(r.appid);

    if (tags && tags.length > 0) {
      const [reported] = await pool.query(
        `SELECT appid FROM tag_reports WHERE tag IN (?)
         GROUP BY appid, tag HAVING COUNT(DISTINCT user_id) >= ?`,
        [tags, THRESHOLD]
      );
      for (const r of reported) hidden.add(r.appid);
    }
  } catch (err) {
    console.error('[비추천] 숨길 게임 조회 실패:', err.message);
  }
  return hidden;
}

module.exports = { getHiddenAppids, THRESHOLD };
