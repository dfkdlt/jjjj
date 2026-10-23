// 게임 가격/할인 조회 (할인 알림용)
//  - Steam appdetails의 price_overview 필터는 appid를 여러 개 한 번에 물어볼 수 있다.
//  - 결과는 game_prices 테이블에 PRICE_CACHE_HOURS 동안 저장해 두고 재사용한다.
//  - Steam 응답을 읽지 못하면 예외 대신 "예전에 저장해 둔 값"으로 대신한다. (아무것도 없으면 가격 정보 없음)
// 가격은 한국 스토어(cc=kr) 기준이며, 화면에 보여줄 문자열은 Steam이 만들어 준 값을 그대로 쓴다. (예: "₩ 29,000")
const pool = require('../db');
const { ready } = require('./ensureTables');
const { steamFetch } = require('./steamHttp');

const PRICE_CACHE_HOURS = 6;
const BATCH = 40; // 한 번에 물어볼 appid 수

// appids -> { [appid]: { discount_percent, initial_formatted, final_formatted } }
// 가격 정보가 없는 게임(무료, 판매 중지 등)도 결과에 넣고 할인 0으로 처리한다.
async function fetchPricesFromSteam(appids) {
  const out = {};
  for (let i = 0; i < appids.length; i += BATCH) {
    const chunk = appids.slice(i, i + BATCH);
    const url = `https://store.steampowered.com/api/appdetails?appids=${chunk.join(',')}&filters=price_overview&cc=kr&l=korean`;
    const res = await steamFetch(url);
    if (!res.ok) throw new Error(`가격 조회 실패: ${res.status}`);
    const data = await res.json();
    for (const appid of chunk) {
      const entry = data && data[appid];
      const po = entry && entry.success && entry.data && entry.data.price_overview;
      if (po && typeof po === 'object') {
        out[appid] = {
          discount_percent: Math.max(0, Math.min(100, Number(po.discount_percent) || 0)),
          initial_formatted: po.initial_formatted || null,
          final_formatted: po.final_formatted || null,
        };
      } else {
        // 무료 게임, 판매 중지, 지역 제한 등 가격이 없는 경우. 할인 없음으로 저장해 두면
        // 다음 몇 시간 동안은 매번 Steam에 다시 묻지 않는다.
        out[appid] = { discount_percent: 0, initial_formatted: null, final_formatted: null };
      }
    }
  }
  return out;
}

// 저장된 값이 신선하면 그대로, 오래됐거나 없으면 Steam에서 다시 읽는다.
// 반환: { prices: { [appid]: {...} }, stale: Steam을 읽지 못해 예전 값/빈 값으로 대신했는지 }
async function getPrices(appids) {
  if (appids.length === 0) return { prices: {}, stale: false };
  await ready;

  const [rows] = await pool.query(
    `SELECT appid, discount_percent, initial_formatted, final_formatted,
            (updated_at >= (NOW() - INTERVAL ? HOUR)) AS fresh
     FROM game_prices WHERE appid IN (?)`,
    [PRICE_CACHE_HOURS, appids]
  );
  const prices = {};
  const fresh = new Set();
  for (const r of rows) {
    prices[r.appid] = {
      discount_percent: r.discount_percent,
      initial_formatted: r.initial_formatted,
      final_formatted: r.final_formatted,
    };
    if (r.fresh) fresh.add(r.appid);
  }

  const need = appids.filter((a) => !fresh.has(a));
  if (need.length === 0) return { prices, stale: false };

  try {
    const got = await fetchPricesFromSteam(need);
    for (const [appid, p] of Object.entries(got)) {
      prices[appid] = p;
      await pool.query(
        `INSERT INTO game_prices (appid, discount_percent, initial_formatted, final_formatted)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE discount_percent = VALUES(discount_percent),
           initial_formatted = VALUES(initial_formatted), final_formatted = VALUES(final_formatted),
           updated_at = CURRENT_TIMESTAMP`,
        [Number(appid), p.discount_percent, p.initial_formatted, p.final_formatted]
      );
    }
    return { prices, stale: false };
  } catch (err) {
    console.error('[할인] 가격을 읽지 못해 저장된 값으로 대신합니다:', err.message);
    return { prices, stale: true };
  }
}

module.exports = { getPrices, fetchPricesFromSteam, PRICE_CACHE_HOURS };
