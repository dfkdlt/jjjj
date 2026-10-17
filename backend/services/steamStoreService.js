// 메인 페이지용 Steam 상점 조회
//  - 정렬 검색: 최근 출시순(Released_DESC) / 리뷰 많은순(Reviews_DESC), 태그 필터 가능
//  - 게임 상점 페이지에서 사용자 태그 목록 읽기 (취향 분석용)
// Steam 쪽 화면 구조가 바뀌면 파싱이 실패할 수 있어서, 실패하면 예외 대신 빈 결과로 처리하는 쪽으로 쓰입니다.

const { STEAM_FETCH_HEADERS } = require('./steamService');

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .trim();
}

// "9 Oct, 2026" / "Oct 9, 2026" / "2026년 10월 9일" -> "2026-10-09". 날짜가 아니면(Coming soon 등) null
function parseSteamDate(text) {
  if (!text) return null;
  const t = String(text).trim();
  let y, m, d;
  let r;
  if ((r = t.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s+(\d{4})$/))) {
    d = +r[1]; m = MONTHS[r[2].toLowerCase()]; y = +r[3];
  } else if ((r = t.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})$/))) {
    m = MONTHS[r[1].toLowerCase()]; d = +r[2]; y = +r[3];
  } else if ((r = t.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일$/))) {
    y = +r[1]; m = +r[2] - 1; d = +r[3];
  } else return null;
  if (m === undefined || Number.isNaN(m)) return null;
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

// 오늘 이전(포함)에 출시된 게임만 true
function isReleased(isoDate) {
  if (!isoDate) return false;
  return isoDate <= new Date().toISOString().slice(0, 10);
}

// Steam 상점 검색. sortBy: 'Released_DESC' | 'Reviews_DESC' | '_ASC'(관련도)
// 반환: { totalCount, games: [{ appid, name, released(YYYY-MM-DD|null), image|null }] }
async function searchStore({ tagIds = [], sortBy = '_ASC', count = 50, gamesOnly = true } = {}) {
  const p = new URLSearchParams({
    query: '',
    start: '0',
    count: String(count),
    infinite: '1',
    ignore_preferences: '1',
    sort_by: sortBy,
  });
  if (tagIds.length) p.set('tags', tagIds.join(','));
  if (gamesOnly) p.set('category1', '998'); // 998 = 게임 (DLC, 사운드트랙 등 제외)

  const res = await fetch(`https://store.steampowered.com/search/results/?${p.toString()}`, {
    headers: STEAM_FETCH_HEADERS,
  });
  if (!res.ok) throw new Error(`Steam 검색 요청 실패: ${res.status}`);
  const data = await res.json();
  const html = data.results_html || '';

  // 게임 한 줄(<a ... data-ds-appid=...>) 단위로 쪼개서 각각 파싱
  const rows = html.split(/(?=<a\b[^>]*data-ds-appid=)/).filter((r) => /data-ds-appid=/.test(r));
  const seen = new Set();
  const games = [];
  for (const row of rows) {
    const appid = Number((row.match(/data-ds-appid="(\d+)/) || [])[1]);
    const name = (row.match(/<span class="title">([^<]+)<\/span>/) || [])[1];
    if (!appid || !name || seen.has(appid)) continue; // 번들 등 appid를 못 읽는 줄은 건너뜀
    seen.add(appid);
    const releasedText = (row.match(/search_released[^>]*>\s*([^<]*?)\s*</) || [])[1];
    const image = (row.match(/<img[^>]+src="([^"]+)"/) || [])[1] || null;
    games.push({ appid, name: decodeEntities(name), released: parseSteamDate(releasedText), image });
  }
  return { totalCount: data.total_count ?? games.length, games };
}

// 게임 상점 페이지에서 사용자 태그 이름(투표 많은 순)을 읽는다. 읽지 못하면 예외.
async function fetchAppTags(appid, limit = 10) {
  const res = await fetch(`https://store.steampowered.com/app/${appid}/?l=english`, { headers: STEAM_FETCH_HEADERS });
  if (!res.ok) throw new Error(`상점 페이지 요청 실패: ${res.status}`);
  const html = await res.text();
  const m = html.match(/InitAppTagModal\(\s*\d+\s*,\s*(\[[\s\S]*?\])\s*,/);
  if (!m) throw new Error('태그 정보를 찾지 못했습니다.');
  const list = JSON.parse(m[1]);
  const names = list.map((t) => t && t.name).filter(Boolean).slice(0, limit);
  if (names.length === 0) throw new Error('태그 목록이 비어 있습니다.');
  return names;
}

module.exports = { searchStore, fetchAppTags, parseSteamDate, isReleased };
