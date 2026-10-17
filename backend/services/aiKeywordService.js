// AI 키워드 자동 매핑
// keywordMap.js에 등록되지 않은 키워드("무서운", "친구랑", "귀여운" 등)를
// AI가 tagCatalog.js의 Steam 태그 중에서 골라 변환해줍니다.
//
// OpenAI 호환 방식(/chat/completions)이라 OpenRouter 같은 통합 API 키로 동작합니다.
// 어떤 모델을 쓸지는 키가 아니라 요청의 model 값(.env의 AI_MODEL)으로 정해집니다.
//
// - AI는 반드시 카탈로그에 있는 태그만 고르도록 제한되고, 응답도 서버에서 한 번 더 검증합니다.
// - 한 번 변환한 결과는 메모리 + DB(keyword_ai_cache)에 저장해서 같은 단어는 API를 다시 호출하지 않습니다.
// - AI_API_KEY가 없거나 API 호출이 실패해도 서버가 죽지 않고, 그냥 "매핑 실패"로 처리합니다.

require('dotenv').config();
const pool = require('../db');
const { TAG_IDS } = require('../tagCatalog');

// 기본값은 OpenRouter + 가볍고 저렴한 모델. 모두 .env에서 바꿀 수 있습니다.
const BASE_URL = (process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const MODEL = process.env.AI_MODEL || 'anthropic/claude-haiku-4.5';
const MAX_TAGS_PER_KEYWORD = 2; // 태그가 많아질수록 AND 검색 결과가 급격히 줄어들어서 제한

const TAG_NAMES = Object.keys(TAG_IDS);
const memoryCache = new Map(); // keyword -> string[]

// 카탈로그에 실제로 있는 태그만 남기고(대소문자 보정), 중복 제거, 개수 제한
function sanitizeTags(rawTags) {
  if (!Array.isArray(rawTags)) return [];
  const result = [];
  for (const raw of rawTags) {
    if (typeof raw !== 'string') continue;
    const official = TAG_NAMES.find((n) => n.toLowerCase() === raw.trim().toLowerCase());
    if (official && !result.includes(official)) result.push(official);
    if (result.length >= MAX_TAGS_PER_KEYWORD) break;
  }
  return result;
}

async function readDbCache(keyword) {
  try {
    const [rows] = await pool.query('SELECT tags FROM keyword_ai_cache WHERE keyword = ?', [
      keyword,
    ]);
    if (rows.length === 0) return null;
    return sanitizeTags(JSON.parse(rows[0].tags));
  } catch (err) {
    // 테이블이 아직 없거나(마이그레이션 전) DB 오류여도 AI 매핑 자체는 계속 동작하게 함
    return null;
  }
}

async function writeDbCache(keyword, tags) {
  try {
    await pool.query(
      `INSERT INTO keyword_ai_cache (keyword, tags) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE tags = VALUES(tags)`,
      [keyword, JSON.stringify(tags)]
    );
  } catch (err) {
    // 캐시 저장 실패는 치명적이지 않으므로 무시
  }
}

// AI에게 여러 키워드를 한 번에 물어봄 -> { 키워드: [태그, ...] }
async function askAI(keywords) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    console.warn('[AI 키워드] AI_API_KEY가 설정되지 않아 AI 매핑을 건너뜁니다.');
    return {};
  }

  const system = [
    'You map Korean (or English) game-search keywords to Steam store tags.',
    'Choose ONLY from the allowed tag list below. Never invent tags.',
    `For each keyword return exactly 1 best tag. Return up to ${MAX_TAGS_PER_KEYWORD} only if the keyword clearly means two distinct concepts.`,
    'Keywords may be slang, descriptive, or colloquial (e.g. "무서운" -> Horror, "친구랑" -> Co-op, "귀여운" -> Cute).',
    'If no allowed tag fits, return an empty array for that keyword.',
    'Respond with a single JSON object only, no prose, no markdown: {"<keyword>": ["Tag", ...]}',
    '',
    `Allowed tags: ${TAG_NAMES.join(', ')}`,
  ].join('\n');

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 800,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(keywords) },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI API 오류 ${res.status} (model=${MODEL}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';

  // 모델마다 ```json 코드펜스나 앞뒤 설명을 붙이는 경우가 있어서, 첫 { ~ 마지막 } 사이만 추출
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1) {
    throw new Error(`AI 응답에서 JSON을 찾지 못했습니다: ${text.slice(0, 120)}`);
  }
  return JSON.parse(text.slice(first, last + 1));
}

// 등록되지 않은 키워드들을 태그로 변환
// 반환: { [keyword]: string[] }  (매핑 실패한 키워드는 빈 배열)
async function resolveKeywordsWithAI(keywords) {
  const result = {};
  const uncached = [];

  for (const kw of keywords) {
    if (memoryCache.has(kw)) {
      result[kw] = memoryCache.get(kw);
      continue;
    }
    const fromDb = await readDbCache(kw);
    if (fromDb && fromDb.length > 0) {
      memoryCache.set(kw, fromDb);
      result[kw] = fromDb;
      continue;
    }
    uncached.push(kw);
  }

  if (uncached.length === 0) return result;

  try {
    const aiAnswer = await askAI(uncached);
    for (const kw of uncached) {
      const tags = sanitizeTags(aiAnswer[kw]);
      result[kw] = tags;
      console.log(`[AI 키워드] "${kw}" → ${tags.length ? tags.join(' + ') : '(매핑 없음)'} (model=${MODEL})`);
      if (tags.length > 0) {
        // 성공한 매핑만 캐싱 (실패를 캐싱하면 나중에 카탈로그가 늘어나도 계속 실패함)
        memoryCache.set(kw, tags);
        await writeDbCache(kw, tags);
      }
    }
  } catch (err) {
    console.error('[AI 키워드] 매핑 실패:', err.message);
    for (const kw of uncached) result[kw] = [];
  }

  return result;
}

module.exports = { resolveKeywordsWithAI };
