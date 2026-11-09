// 게임 상세 화면용 정보 (소개글, 소개 영상, 스크린샷 등)를 Steam 상점에서 가져와 저장해 둔다.
const pool = require('../db');
const { steamFetch } = require('./steamHttp');
const { toCardPrice } = require('./priceService');

const DETAIL_CACHE_HOURS = 24;
const MAX_SCREENSHOTS = 20;
const MAX_MOVIES = 6;

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS game_details (
  appid INT NOT NULL PRIMARY KEY,
  payload MEDIUMTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
let tableReady = null;
function ensureTable() {
  if (!tableReady) tableReady = pool.query(TABLE_SQL).catch((e) => { tableReady = null; throw e; });
  return tableReady;
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// 영상/사진 주소는 Steam의 https 주소만 통과시킨다 (화면에 그대로 넣기 때문)
function steamUrl(u) {
  if (typeof u !== 'string') return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!/(^|\.)(steamstatic\.com|steampowered\.com|akamaihd\.net)$/i.test(url.hostname)) return null;
    url.protocol = 'https:';
    return url.toString();
  } catch (e) {
    return null;
  }
}

function pickMovie(m) {
  const mp4 = m.mp4 || {};
  const webm = m.webm || {};
  return {
    id: m.id,
    name: m.name || '',
    thumbnail: steamUrl(m.thumbnail),
    mp4: steamUrl(mp4.max || mp4['480']),
    webm: steamUrl(webm.max || webm['480']),
    hls: steamUrl(m.hls_h264),
  };
}

function parseDetail(appid, entry) {
  const d = entry && entry.success && entry.data;
  if (!d) return null;
  const movies = (Array.isArray(d.movies) ? d.movies : [])
    .map(pickMovie)
    .filter((m) => m.mp4 || m.webm || m.hls)
    .slice(0, MAX_MOVIES);
  const screenshots = (Array.isArray(d.screenshots) ? d.screenshots : [])
    .map((s) => ({ thumb: steamUrl(s.path_thumbnail), full: steamUrl(s.path_full) }))
    .filter((s) => s.thumb || s.full)
    .slice(0, MAX_SCREENSHOTS);
  const po = d.price_overview;
  const price = d.is_free
    ? toCardPrice({})
    : po && po.final_formatted
    ? toCardPrice({ final_formatted: po.final_formatted, initial_formatted: po.initial_formatted, discount_percent: po.discount_percent })
    : null;
  return {
    appid: Number(appid),
    name: d.name || '',
    type: d.type || 'game',
    short_description: stripHtml(d.short_description),
    header_image: steamUrl(d.header_image),
    developers: Array.isArray(d.developers) ? d.developers.slice(0, 5) : [],
    publishers: Array.isArray(d.publishers) ? d.publishers.slice(0, 5) : [],
    release_date: d.release_date && d.release_date.date ? String(d.release_date.date) : null,
    genres: (Array.isArray(d.genres) ? d.genres : []).map((g) => g.description).filter(Boolean).slice(0, 8),
    languages: stripHtml(d.supported_languages).replace(/\*.*$/, '').trim(),
    metacritic: d.metacritic && d.metacritic.score ? Number(d.metacritic.score) : null,
    price,
    movies,
    screenshots,
  };
}

async function readCached(appid) {
  await ensureTable();
  const [rows] = await pool.query(
    'SELECT payload, TIMESTAMPDIFF(HOUR, updated_at, NOW()) AS age FROM game_details WHERE appid = ?',
    [appid]
  );
  if (!rows.length) return null;
  try {
    return { data: JSON.parse(rows[0].payload), fresh: rows[0].age < DETAIL_CACHE_HOURS };
  } catch (e) {
    return null;
  }
}

// 반환: { detail, stale } 또는 detail이 null이면 Steam에 정보가 없는 앱
async function getGameDetail(appid) {
  const cached = await readCached(appid).catch(() => null);
  if (cached && cached.fresh) return { detail: cached.data, stale: false };
  try {
    const res = await steamFetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=kr&l=korean`);
    if (!res.ok) throw new Error(`상세 조회 실패: ${res.status}`);
    const json = await res.json();
    const detail = parseDetail(appid, json && json[appid]);
    if (!detail) return { detail: cached ? cached.data : null, stale: !!cached };
    await ensureTable();
    await pool.query(
      'INSERT INTO game_details (appid, payload) VALUES (?, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP',
      [appid, JSON.stringify(detail)]
    );
    return { detail, stale: false };
  } catch (err) {
    if (cached) return { detail: cached.data, stale: true }; // Steam이 막혀도 저장해 둔 것으로 보여 준다
    throw err;
  }
}

module.exports = { getGameDetail, parseDetail, stripHtml };
