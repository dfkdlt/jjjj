// Steam 공식 상점 검색(태그 필터) + appreviews API 연동
// (예전엔 SteamSpy를 썼지만, SteamSpy 태그 데이터가 부정확/최신성 문제가 있어
//  Steam이 실제로 상점 페이지에서 쓰는 공식 검색 엔드포인트로 교체함)

const STEAM_REVIEWS_URL = 'https://store.steampowered.com/appreviews';

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

// 특정 게임의 Steam 리뷰 요약(추천/비추천 수) 가져오기
async function fetchReviewSummary(appid) {
  const url = `${STEAM_REVIEWS_URL}/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`;
  const res = await steamFetch(url);
  if (!res.ok) throw new Error(`Steam 리뷰 API 요청 실패: ${res.status}`);
  const data = await res.json();

  const summary = data.query_summary || {};
  const positive = summary.total_positive || 0;
  const negative = summary.total_negative || 0;

  return { positive, negative };
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
// filter=all은 Steam이 자체적으로 유용성(투표 수 등) 기준으로 정렬한 결과를 반환함
async function fetchTopHelpfulReviews(appid, count = 3) {
  const url = `${STEAM_REVIEWS_URL}/${appid}?json=1&filter=all&language=all&purchase_type=all&num_per_page=20`;
  const res = await steamFetch(url);
  if (!res.ok) throw new Error(`리뷰 조회 실패: ${res.status}`);
  const data = await res.json();

  const reviews = (data.reviews || [])
    .map((r) => ({
      reviewText: (r.review || '').slice(0, 500), // 너무 길면 잘라서 저장
      votedUp: r.voted_up ? 1 : 0,
      votesUp: r.votes_up || 0,
      language: r.language || 'unknown',
    }))
    // Steam이 이미 유용성순으로 주지만, 안전하게 votes_up 기준으로 한 번 더 정렬
    .sort((a, b) => b.votesUp - a.votesUp)
    .slice(0, count);

  return reviews;
}

module.exports = {
  STEAM_FETCH_HEADERS,
  fetchGamesByOfficialTagSearch,
  fetchReviewSummary,
  calculateScore,
  fetchGameDetails,
  fetchTopHelpfulReviews,
};
