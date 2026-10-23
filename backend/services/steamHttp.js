// Steam으로 가는 모든 요청이 지나가는 곳
//  - 클라우드 서버(Railway)에서 요청이 몰리면 Steam이 403/429로 그 서버 주소를 잠깐 막는다.
//    그래서 (1) 동시에 보내는 수와 간격을 제한하고, (2) 막혔다는 신호(403/429)를 받으면
//    BLOCK_MS 동안은 Steam에 아예 요청하지 않고(차단을 키우지 않고) 저장해 둔 값으로 버틴다.
//  - 막힌 동안 던지는 예외(code = 'STEAM_BLOCKED')는 호출한 쪽이 알아보고 대체 동작을 한다.

// 성인 인증 페이지로 리다이렉트되는 것을 방지 + 일반 브라우저처럼 보이게 하는 공통 헤더
const STEAM_FETCH_HEADERS = {
  Cookie: 'birthtime=0; lastagecheckage=1-January-1970; wants_mature_content=1',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
  Accept: 'application/json, text/javascript, text/html, */*;q=0.8',
};

const MAX_CONCURRENT = 3; // 동시에 보내는 Steam 요청 수
const MIN_GAP_MS = 120; // 요청 시작 사이의 최소 간격
const TIMEOUT_MS = 15000;
const BLOCK_MS = 3 * 60 * 1000; // 막혔다고 판단한 뒤 쉬는 시간

let blockedUntil = 0;
let active = 0;
let lastStart = 0;
const queue = [];

class SteamBlockedError extends Error {
  constructor(status) {
    super(`Steam이 요청을 일시 제한했습니다(${status || '차단 중'}). 잠시 쉬었다가 다시 시도합니다.`);
    this.code = 'STEAM_BLOCKED';
    this.status = status || null;
  }
}

function isBlocked() {
  return Date.now() < blockedUntil;
}

function pump() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift();
    active++;
    const wait = Math.max(0, lastStart + MIN_GAP_MS - Date.now());
    lastStart = Date.now() + wait;
    setTimeout(() => {
      job.fn().then(job.resolve, job.reject).finally(() => {
        active--;
        pump();
      });
    }, wait);
  }
}

function schedule(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}

async function once(url, options) {
  if (isBlocked()) throw new SteamBlockedError();
  const res = await fetch(url, {
    ...options,
    headers: { ...STEAM_FETCH_HEADERS, ...(options && options.headers) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 403 || res.status === 429) {
    if (!isBlocked()) console.error(`[Steam] ${res.status} 응답: ${Math.round(BLOCK_MS / 60000)}분 동안 Steam 요청을 쉽니다. (${url.slice(0, 80)})`);
    blockedUntil = Date.now() + BLOCK_MS;
    throw new SteamBlockedError(res.status);
  }
  return res;
}

// fetch와 같은 모양. 차단 신호면 SteamBlockedError, 일시적인 서버 오류/네트워크 오류는 한 번만 다시 시도.
function steamFetch(url, options = {}) {
  return schedule(async () => {
    try {
      const res = await once(url, options);
      if (res.status >= 500) {
        await new Promise((r) => setTimeout(r, 400));
        return await once(url, options);
      }
      return res;
    } catch (err) {
      if (err.code === 'STEAM_BLOCKED') throw err;
      await new Promise((r) => setTimeout(r, 400));
      return await once(url, options); // 네트워크 오류/시간 초과는 한 번 더
    }
  });
}

module.exports = { steamFetch, isBlocked, SteamBlockedError, STEAM_FETCH_HEADERS };
