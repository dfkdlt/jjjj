// 검색 입력을 Steam 태그로 바꾸는 곳
//
// 1) "공포 멀티"처럼 모든 단어가 keywordMap.js 정적 매핑(또는 영문 태그명)이면 -> 즉시 변환 (AI 호출 없음, 무료)
// 2) 그 밖의 입력(문장, 일상 표현)은 -> 문장 전체를 AI가 해석 (aiQueryService.js)
// 3) AI를 쓸 수 없거나 해석하지 못하면 -> 예전 방식(단어별 AI 변환)으로 대체
//
// 반환: { tags, failed, aiMapped, interpretation, koreanOnly, naturalLanguage }
const { resolveKeywordToTag, findTagName } = require('../keywordMap');
const { resolveKeywordsWithAI } = require('./aiKeywordService');
const { interpretQuery } = require('./aiQueryService');

async function parseKeywordsToTags(keywordInput) {
  const tokens = keywordInput
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const staticTags = tokens.map((t) => findTagName(resolveKeywordToTag(t)));
  const allStatic = staticTags.length > 0 && staticTags.every(Boolean);

  if (allStatic) {
    return { tags: [...new Set(staticTags)], failed: [], aiMapped: {}, interpretation: null, koreanOnly: false, naturalLanguage: false };
  }

  // 문장 전체 해석
  const nl = await interpretQuery(keywordInput);
  if (nl && nl.tags.length > 0) {
    return { tags: nl.tags, failed: [], aiMapped: {}, interpretation: nl.summary || null, koreanOnly: nl.korean_only, naturalLanguage: true };
  }

  // 대체: 단어별 변환 (정적 매핑 -> AI)
  const tags = [];
  const needAI = [];
  tokens.forEach((token, i) => {
    if (staticTags[i]) tags.push(staticTags[i]);
    else needAI.push(token);
  });

  const failed = [];
  const aiMapped = {};
  if (needAI.length > 0) {
    const aiResult = await resolveKeywordsWithAI(needAI);
    for (const token of needAI) {
      const mapped = aiResult[token] || [];
      if (mapped.length === 0) failed.push(token);
      else {
        aiMapped[token] = mapped;
        tags.push(...mapped);
      }
    }
  }
  return { tags: [...new Set(tags)], failed, aiMapped, interpretation: null, koreanOnly: false, naturalLanguage: false };
}

module.exports = { parseKeywordsToTags };
