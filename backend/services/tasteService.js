// 취향 분석: 내가 추천한 게임들의 태그를 모아 가장 많이 나온 태그를 뽑는다.
//  1) Steam 상점 페이지의 사용자 태그 (투표가 많은 순 = 그 게임과 가장 관련 높은 순) - game_tags 테이블에 캐시
//  2) 우리 사이트에서 그 게임이 검색됐던 태그 (game_keywords) - 상점 태그가 모자랄 때 채우는 보조 정보
// 게임 1개당 어느 게임에나 붙는 흔한 태그를 뺀 뒤 가장 관련 높은 TAGS_PER_GAME개만 1표씩 센다.
const pool = require('../db');
const { ready } = require('./ensureTables');
const { fetchAppTags } = require('./steamStoreService');
const { KEYWORD_MAP, findTagName } = require('../keywordMap');

const TOP_TAGS = 5; // 취향 태그로 보여주는 개수 (추천한 게임에서 가장 많이 나온 순)
const TAGS_PER_GAME = 5; // 게임 1개당 취향 계산에 쓰는 태그 수 (가장 관련 높은 것만)
const MAX_STORE_FETCH = 10; // 한 번 요청에서 상점 페이지를 읽을 최대 게임 수
const FETCH_CONCURRENCY = 3;
const FAIL_RETRY_MS = 60 * 60 * 1000;

// 어느 게임에나 붙어서 취향을 구분해 주지 못하는 태그
const GENERIC = new Set(['singleplayer', 'indie', 'action', 'adventure', 'casual', 'early access', 'free to play']);

const failedAt = new Map(); // appid -> 마지막 실패 시각 (실패한 게임을 매번 다시 읽지 않기 위해)

// 영문 태그 -> 화면에 보여줄 한글 이름 (정적 매핑에서 가장 짧은 한글 별칭, 없으면 영문 그대로)
function tagLabel(tag) {
  const aliases = Object.entries(KEYWORD_MAP)
    .filter(([, v]) => v.toLowerCase() === tag.toLowerCase())
    .map(([k]) => k)
    .filter((k) => /[가-힣]/.test(k));
  if (aliases.length === 0) return tag;
  return aliases.sort((a, b) => a.length - b.length)[0];
}

async function loadStoreTags(appids) {
  const map = {};
  if (appids.length === 0) return map;
  const [rows] = await pool.query('SELECT appid, tag FROM game_tags WHERE appid IN (?) ORDER BY rank_no', [appids]);
  for (const r of rows) (map[r.appid] ||= []).push(r.tag);

  const missing = appids
    .filter((a) => !map[a] && !(failedAt.get(a) > Date.now() - FAIL_RETRY_MS))
    .slice(0, MAX_STORE_FETCH);
  for (let i = 0; i < missing.length; i += FETCH_CONCURRENCY) {
    await Promise.all(
      missing.slice(i, i + FETCH_CONCURRENCY).map(async (appid) => {
        try {
          const names = await fetchAppTags(appid);
          for (let k = 0; k < names.length; k++) {
            await pool.query(
              'INSERT INTO game_tags (appid, tag, rank_no) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE rank_no = VALUES(rank_no), updated_at = CURRENT_TIMESTAMP',
              [appid, names[k], k]
            );
          }
          map[appid] = names;
        } catch (err) {
          failedAt.set(appid, Date.now());
          console.error(`[취향] ${appid} 상점 태그 읽기 실패 (검색 태그로 대체):`, err.message);
        }
      })
    );
  }
  return map;
}

// 반환: { liked_count, basis: 'none'|'store_tags'|'search_tags', total_votes, distinct_tags, tags: [{ tag, label, count }] }
async function computeProfile(userId) {
  await ready;
  const [liked] = await pool.query('SELECT appid FROM user_likes WHERE user_id = ?', [userId]);
  const appids = liked.map((r) => r.appid);
  if (appids.length === 0) return { liked_count: 0, basis: 'none', total_votes: 0, distinct_tags: 0, tags: [] };

  const storeTags = await loadStoreTags(appids);
  let kwRows = [];
  try {
    [kwRows] = await pool.query(
      'SELECT g.appid, gk.keyword FROM game_keywords gk JOIN games g ON g.id = gk.game_id WHERE g.appid IN (?)',
      [appids]
    );
  } catch (err) {
    // game_keywords를 못 읽어도 상점 태그만으로 계속
  }
  const kwByApp = {};
  for (const r of kwRows) (kwByApp[r.appid] ||= []).push(r.keyword);

  // allowGeneric=false: 흔한 태그(싱글플레이, 인디 등)를 뺀 뒤 게임당 가장 관련 높은 TAGS_PER_GAME개만 센다
  const countTags = (allowGeneric) => {
    const counts = new Map(); // 공식 태그명 -> 게임 수
    let usedStore = false;
    const ok = (name) => allowGeneric || !GENERIC.has(name.toLowerCase());
    for (const appid of appids) {
      const picked = [];
      // 1) 상점 태그: Steam 투표가 많은 순서 그대로. 카탈로그에 없는 태그는 건너뜀
      for (const t of storeTags[appid] || []) {
        const name = findTagName(t);
        if (name && ok(name) && !picked.includes(name)) picked.push(name);
        if (picked.length >= TAGS_PER_GAME) break;
      }
      if (picked.length > 0) usedStore = true;
      // 2) 모자라면 이 사이트에서 검색됐던 태그로 채움 (순서 정보가 없어서 이름순으로 고정)
      if (picked.length < TAGS_PER_GAME) {
        const fromKeywords = [...new Set((kwByApp[appid] || []).map((k) => findTagName(k)).filter(Boolean))]
          .filter(ok)
          .sort((a, b) => a.localeCompare(b));
        for (const name of fromKeywords) {
          if (!picked.includes(name)) picked.push(name);
          if (picked.length >= TAGS_PER_GAME) break;
        }
      }
      for (const name of picked) counts.set(name, (counts.get(name) || 0) + 1);
    }
    return { counts, usedStore };
  };
  let { counts, usedStore } = countTags(false);
  if (counts.size === 0) ({ counts, usedStore } = countTags(true)); // 구체적인 태그가 하나도 없을 때만 흔한 태그를 그대로 사용

  const entries = [...counts.entries()];
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const tags = entries.slice(0, TOP_TAGS).map(([tag, count]) => ({ tag, label: tagLabel(tag), count }));
  const totalVotes = entries.reduce((sum, [, c]) => sum + c, 0);
  return {
    liked_count: appids.length,
    basis: usedStore ? 'store_tags' : 'search_tags',
    total_votes: totalVotes,
    distinct_tags: entries.length,
    tags,
  };
}

module.exports = { computeProfile, tagLabel };
