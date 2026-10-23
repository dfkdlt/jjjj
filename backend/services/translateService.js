// 무료 비공식 Google 번역 엔드포인트를 사용합니다 (API 키 불필요).
// 주의: 공식 API가 아니라서 트래픽이 많으면 일시적으로 막힐 수 있습니다.
// 운영 서비스로 확장할 경우 Google Cloud Translation API, Papago API 등
// 정식 유료/키 기반 API로 교체하는 것을 권장합니다.

const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single';

// 429(요청 과다)를 받으면 한동안 번역을 건너뛴다. 실패할 걸 알면서 계속 보내면 검색만 느려진다.
const PAUSE_MS = 10 * 60 * 1000;
let pausedUntil = 0;

// Steam 리뷰의 language 코드가 이미 한국어인지 체크
function isAlreadyKorean(languageCode) {
  return languageCode === 'koreana';
}

// 주어진 텍스트를 한국어로 번역. 실패하거나 빈 텍스트면 null 반환.
async function translateToKorean(text) {
  if (!text || !text.trim()) return null;
  if (Date.now() < pausedUntil) return null;

  try {
    const params = new URLSearchParams({
      client: 'gtx',
      sl: 'auto',
      tl: 'ko',
      dt: 't',
      q: text,
    });

    const res = await fetch(`${TRANSLATE_URL}?${params.toString()}`);
    if (res.status === 429 || res.status === 403) {
      pausedUntil = Date.now() + PAUSE_MS;
      console.error(`번역 요청 제한(${res.status}): ${PAUSE_MS / 60000}분 동안 번역을 건너뜁니다.`);
      return null;
    }
    if (!res.ok) throw new Error(`번역 요청 실패: ${res.status}`);

    const data = await res.json();
    // 응답 형태: [[["번역문장1","원문1",...], ["번역문장2","원문2",...], ...], ...]
    const segments = data[0] || [];
    const translated = segments.map((seg) => seg[0]).join('');

    return translated || null;
  } catch (err) {
    console.error('번역 실패:', err.message);
    return null; // 번역 실패해도 리뷰 자체는 계속 진행
  }
}

module.exports = { isAlreadyKorean, translateToKorean };
