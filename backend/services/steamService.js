// Steam 공식 상점 검색(태그 필터) + appreviews API 연동
// (예전엔 SteamSpy를 썼지만, SteamSpy 태그 데이터가 부정확/최신성 문제가 있어
//  Steam이 실제로 상점 페이지에서 쓰는 공식 검색 엔드포인트로 교체함)

// 2026-10-22부터 예전 주소(store.steampowered.com/appreviews)는 꺼졌다.
// 새 주소: IUserReviewsService/GetAppReviews (키 없이 사용 가능, 요청은 input_json 하나로 보낸다)
const STEAM_REVIEWS_URL = 'https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/';

function reviewsUrl(appid, extra = {}) {
  const input = {
    appid: Number(appid),
    languages: ['all'], // 모든 언어
    purchase_type: 1, // 1 = 모든 구매 (0은 Steam 구매만)
    ...extra,
  };
  return `${STEAM_REVIEWS_URL}?input_json=${encodeURIComponent(JSON.stringify(input))}`;
}

// 리뷰 API 자체를 못 쓰는 상태(주소가 꺼짐/이동)인지 판단. 한 게임의 일시적 오류(5xx)는 해당하지 않는다.
function isReviewsApiGone(err) {
  return err.code === 'STEAM_HTML' || err.status === 404 || err.status === 410;
}

function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// 새 API는 { response: {...} } 로 감싸서 준다 (success 필드는 없다)
async function readReviewsJson(res) {
  const data = await res.json();
  return (data && data.response) || data || {};
}

// 모든 Steam 요청은 steamHttp를 거친다 (요청 수 제한, 차단(403/429) 시 잠시 쉬기)
const { steamFetch, STEAM_FETCH_HEADERS } = require('./steamHttp');

// Steam 공식 태그 ID로 검색 (사용자가 상점에서 태그 필터로 검색했을 때와 동일한 결과)
// ignore_preferences=1 : Steam의 기본 "콘텐츠 선호도" 필터(폭력/성인 등 숨김)를 무시해서
//                        19금(청소년이용불가) 게임도 검색 결과에 포함시킴
// tagIds가 여러 개면 그 태그를 '모두' 가진 게임만 반환됩니다 (Steam 자체 AND 로직)
// start: 결과의 몇 번째부터 가져올지 ("더 보기"용). 0이면 처음부터
// 반환값: { totalCount: 실제 Steam에 있는 전체 매칭 개수, games: 이번에 가져온 후보 목록 }
async function fetchGamesByOfficialTagSearch(tagIds, poolSize = 100, start = 0) {
  const tagsParam = tagIds.join(',');
  const url = `https://store.steampowered.com/search/results/?query&start=${start}&count=${poolSize}&infinite=1&ignore_preferences=1&tags=${tagsParam}`;

  const res = await steamFetch(url);
  if (!res.ok) throw new Error(`Steam 검색 요청 실패: ${res.status}`);
  const data = await res.json();

  const html = data.results_html || '';
  const matches = [
    ...html.matchAll(/data-ds-appid="(\d+)"[\s\S]*?<span class="title">([^<]+)<\/span>/g),
  ];

  const seen = new Set();
  const games = [];
  for (const m of matches) {
    const appid = Number(m[1]);
    if (seen.has(appid)) continue;
    seen.add(appid);
    games.push({ appid, name: m[2].trim() });
  }

  return {
    totalCount: data.total_count ?? games.length,
    games,
  };
}

// 리뷰 API가 실패하는 동안은 그 API를 건너뛰고 상점 페이지에서 점수를 읽는다.
const REVIEWS_API_PAUSE_MS = 10 * 60 * 1000;
let reviewsApiDownUntil = 0;

function reviewsApiDown() {
  return Date.now() < reviewsApiDownUntil;
}

function markReviewsApiDown() {
  if (!reviewsApiDown()) console.error('[Steam] 리뷰 API를 쓰지 못해 10분 동안 상점 페이지에서 점수를 읽습니다.');
  reviewsApiDownUntil = Date.now() + REVIEWS_API_PAUSE_MS;
}

// 상점 페이지의 "All Reviews: 98% of the 395,240 user reviews for this game are positive" 문구에서 읽는다.
// 언어별 줄(English Reviews 등)이 함께 있으면 전체 수가 가장 큰 줄이 '모든 언어' 기준이다.
// 비율만 알 수 있어 추천/비추천 수는 반올림한 근사값이다 (점수는 소수 첫째 자리까지 같다).
function parseStoreReviewSummary(html) {
  const re = /(\d{1,3})%\s+of\s+the\s+([\d,]+)\s+user\s+reviews\s+for\s+this\s+game\s+are\s+positive/gi;
  let best = null;
  for (const m of html.matchAll(re)) {
    const total = Number(m[2].replace(/,/g, ''));
    if (!best || total > best.total) best = { pct: Number(m[1]), total };
  }
  if (!best) return null;
  const positive = Math.round((best.pct / 100) * best.total);
  return { positive, negative: best.total - positive };
}

async function fetchReviewSummaryFromStorePage(appid) {
  const res = await steamFetch(`https://store.steampowered.com/app/${appid}/?l=english`);
  if (!res.ok) throw new Error(`상점 페이지 요청 실패: ${res.status}`);
  const html = await res.text();
  const parsed = parseStoreReviewSummary(html);
  if (parsed) return parsed;
  if (/user reviews/i.test(html) === false) return { positive: 0, negative: 0 }; // 리뷰가 아직 없는 게임
  throw new Error('상점 페이지에서 리뷰 요약을 읽지 못했습니다.');
}

// 특정 게임의 Steam 리뷰 요약(추천/비추천 수) 가져오기
async function fetchReviewSummary(appid) {
  if (!reviewsApiDown()) {
    try {
      // num_per_page 0은 20개로 취급되어서 1로 요청 (요약은 첫 페이지에만 들어 있다)
      const res = await steamFetch(reviewsUrl(appid, { num_per_page: 1 }));
      if (!res.ok) throw httpError(`Steam 리뷰 API 요청 실패: ${res.status}`, res.status);
      const data = await readReviewsJson(res);
      const summary = data.query_summary;
      if (!summary || summary.total_positive === undefined) {
        const e = new Error('리뷰 요약이 응답에 없습니다.');
        e.noSummary = true;
        throw e;
      }
      return { positive: summary.total_positive || 0, negative: summary.total_negative || 0 };
    } catch (err) {
      if (err.code === 'STEAM_BLOCKED') throw err;
      if (isReviewsApiGone(err)) {
        console.error(`[Steam] 리뷰 API 사용 실패(${err.message})`);
        markReviewsApiDown();
      } else if (!err.noSummary) {
        throw err; // 이 게임만의 일시적 오류: 호출한 쪽이 그 게임을 건너뛴다
      }
      // 요약이 응답에 없는 게임은 이번만 상점 페이지에서 읽는다
    }
  }
  return fetchReviewSummaryFromStorePage(appid);
}

// 추천 비율 -> 10점 만점 점수로 환산
function calculateScore(positive, negative) {
  const total = positive + negative;
  if (total === 0) return 0.0;
  return Math.round((positive / total) * 10 * 10) / 10; // 소수 첫째자리 반올림
}

// 게임 상세정보(한글 지원 여부, 썸네일) 가져오기
async function fetchGameDetails(appid) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&l=korean`;
  const res = await steamFetch(url);
  if (!res.ok) throw new Error(`appdetails 요청 실패: ${res.status}`);
  const data = await res.json();

  const entry = data[appid];
  if (!entry || !entry.success || !entry.data) {
    return { supportsKorean: false, headerImage: null };
  }

  const info = entry.data;
  // supported_languages는 "English<strong>*</strong>, French, Korean, ..." 형태의 HTML 포함 문자열
  const languages = info.supported_languages || '';
  const supportsKorean = languages.includes('Korean') || languages.includes('한국어');

  return {
    supportsKorean,
    headerImage: info.header_image || null,
  };
}

// 특정 게임의 "가장 유익한" 리뷰 상위 N개 가져오기
// filter 0(Helpful)은 Steam이 자체적으로 유용성 기준으로 정렬한 결과를 반환함
async function fetchTopHelpfulReviews(appid, count = 3) {
  if (reviewsApiDown()) return []; // 리뷰 API를 못 쓰는 동안은 리뷰 본문 없이 점수만 보여준다
  let data;
  try {
    const res = await steamFetch(reviewsUrl(appid, { filter: 0, num_per_page: 20, day_range: 365 }));
    if (!res.ok) throw httpError(`리뷰 조회 실패: ${res.status}`, res.status);
    data = await readReviewsJson(res);
  } catch (err) {
    if (err.code === 'STEAM_BLOCKED') throw err;
    if (isReviewsApiGone(err)) {
      console.error(`[Steam] 리뷰 본문 조회 실패(${err.message})`);
      markReviewsApiDown();
      return [];
    }
    throw err;
  }

  const reviews = (data.reviews || [])
    .map((r) => ({
      reviewText: (r.review || '').slice(0, 500), // 너무 길면 잘라서 저장
      votedUp: r.voted_up ? 1 : 0,
      votesUp: r.votes_up || 0,
      language: r.language || 'unknown',
    }))
    .sort((a, b) => b.votesUp - a.votesUp)
    .slice(0, count);

  return reviews;
}

module.exports = {
  STEAM_FETCH_HEADERS,
  parseStoreReviewSummary,
  fetchGamesByOfficialTagSearch,
  fetchReviewSummary,
  calculateScore,
  fetchGameDetails,
  fetchTopHelpfulReviews,
};
