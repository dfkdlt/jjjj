// 한글 키워드 -> Steam 태그(영문) 정적 매핑 (자주 쓰는 키워드용 빠른 경로)
// 여기에 없는 키워드는 AI(aiKeywordService.js)가 tagCatalog.js의 태그 중에서 골라 매핑합니다.
const { TAG_IDS } = require('./tagCatalog');

const KEYWORD_MAP = {
  '공포': 'Horror',
  '호러': 'Horror',
  '멀티플레이': 'Multiplayer',
  '멀티': 'Multiplayer',
  '협동': 'Co-op',
  '협동플레이': 'Co-op',
  '액션': 'Action',
  '어드벤처': 'Adventure',
  '전략': 'Strategy',
  'rpg': 'RPG',
  '알피지': 'RPG',
  '슈팅': 'Shooter',
  '오픈월드': 'Open World',
  '퍼즐': 'Puzzle',
  '시뮬레이션': 'Simulation',
  '인디': 'Indie',
  '캐주얼': 'Casual',
  '스포츠': 'Sports',
  '레이싱': 'Racing',
  '생존': 'Survival',
  '카드게임': 'Card Game',
  '로그라이크': 'Roguelike',
  '싱글플레이': 'Singleplayer',
  '힐링': 'Relaxing',
  '느긋한': 'Relaxing',
  '편안한': 'Relaxing',
  '아늑한': 'Cozy',
  '아기자기': 'Cozy',
};

// 영문 태그명(대소문자 무관)으로 Steam 태그 ID 조회. 없으면 null.
function getTagId(tagName) {
  const key = Object.keys(TAG_IDS).find((k) => k.toLowerCase() === tagName.toLowerCase());
  return key ? TAG_IDS[key] : null;
}

// 영문 태그명(대소문자 무관)의 공식 표기(카탈로그 키)를 반환. 없으면 null.
function findTagName(tagName) {
  return Object.keys(TAG_IDS).find((k) => k.toLowerCase() === tagName.toLowerCase()) || null;
}

function resolveKeywordToTag(keyword) {
  const key = keyword.trim().toLowerCase();
  // 매핑 테이블에서 소문자 비교로 매칭
  for (const [kor, tag] of Object.entries(KEYWORD_MAP)) {
    if (kor.toLowerCase() === key) return tag;
  }
  // 매핑에 없으면 입력값을 그대로 태그로 사용 (영문 태그 직접 입력 대응)
  return keyword.trim();
}

module.exports = { KEYWORD_MAP, resolveKeywordToTag, TAG_IDS, getTagId, findTagName };
