const searchForm = document.getElementById('searchForm');
const keywordInput = document.getElementById('keywordInput');
const pricePreset = document.getElementById('pricePreset');
const priceCustom = document.getElementById('priceCustom');
const priceMinInput = document.getElementById('priceMin');
const priceMaxInput = document.getElementById('priceMax');

// 현재 선택된 가격 범위를 검색 주소에 붙일 문자열로 만든다 (비어 있으면 제한 없음)
function priceParams() {
  const v = pricePreset.value;
  let min = '';
  let max = '';
  if (v === 'custom') {
    min = priceMinInput.value.trim();
    max = priceMaxInput.value.trim();
  } else if (v) {
    [min, max] = v.split('-');
  }
  let q = '';
  if (min !== '') q += `&price_min=${encodeURIComponent(min)}`;
  if (max !== '') q += `&price_max=${encodeURIComponent(max)}`;
  return q;
}
pricePreset.addEventListener('change', () => {
  priceCustom.hidden = pricePreset.value !== 'custom';
});

function priceHtml(game) {
  const p = game.price;
  if (!p) return '<span class="game-price game-price-unknown">가격 정보 없음</span>';
  if (p.state === 'free') return '<span class="game-price game-price-free">무료</span>';
  if (p.discount_percent > 0) {
    return `<span class="game-price"><span class="price-off">-${p.discount_percent}%</span> <s class="price-old">${escapeHtml(p.initial_formatted)}</s> <strong>${escapeHtml(p.final_formatted)}</strong></span>`;
  }
  return `<span class="game-price"><strong>${escapeHtml(p.final_formatted)}</strong></span>`;
}
const statusMessage = document.getElementById('statusMessage');
const resultsGrid = document.getElementById('resultsGrid');
const chipsBox = document.getElementById('chips');
const submitBtn = searchForm.querySelector('button[type="submit"]');
const moreBox = document.getElementById('moreBox');
const moreBtn = document.getElementById('moreBtn');
const moreNote = document.getElementById('moreNote');

// 지금 보고 있는 검색의 상태. 새로 검색하면 통째로 바뀐다.
//   cursor: 서버가 알려 준 "다음 페이지" 위치 (없으면 끝), shown: 이미 화면에 올린 게임, meta: 첫 페이지 응답
let state = null;
let searchToken = 0; // 검색을 새로 할 때마다 올려서, 늦게 도착한 옛 응답을 버린다

const SUGGESTED = ['공포', '멀티', '협동', '생존', '힐링', '로그라이크', '오픈월드', '퍼즐', '슈팅', '전략'];

const LANGUAGE_NAMES = {
  koreana: '한국어', english: '영어', schinese: '중국어(간체)', tchinese: '중국어(번체)',
  japanese: '일본어', russian: '러시아어', german: '독일어', french: '프랑스어',
  spanish: '스페인어', latam: '스페인어(중남미)', brazilian: '포르투갈어(브라질)',
  portuguese: '포르투갈어', polish: '폴란드어', turkish: '튀르키예어', italian: '이탈리아어',
  thai: '태국어', vietnamese: '베트남어', ukrainian: '우크라이나어', czech: '체코어',
  dutch: '네덜란드어', swedish: '스웨덴어', hungarian: '헝가리어', romanian: '루마니아어',
  finnish: '핀란드어', danish: '덴마크어', norwegian: '노르웨이어', bulgarian: '불가리아어',
  greek: '그리스어', arabic: '아랍어', indonesian: '인도네시아어',
};

function setStatus(html, isError = false) {
  statusMessage.classList.toggle('is-error', isError);
  statusMessage.innerHTML = html;
}

/* 추천 키워드 칩: 누르면 입력창에 넣고 빼기 */
function currentWords() {
  return keywordInput.value.split(/[\s,]+/).filter(Boolean);
}
function syncChips() {
  const words = currentWords();
  chipsBox.querySelectorAll('.chip').forEach((chip) => {
    chip.setAttribute('aria-pressed', words.includes(chip.dataset.word) ? 'true' : 'false');
  });
}
chipsBox.innerHTML = SUGGESTED.map(
  (w) => `<button type="button" class="chip" data-word="${w}" aria-pressed="false">${w}</button>`
).join('');
chipsBox.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const word = chip.dataset.word;
  const words = currentWords();
  keywordInput.value = (words.includes(word) ? words.filter((w) => w !== word) : [...words, word]).join(' ');
  syncChips();
  keywordInput.focus();
});
keywordInput.addEventListener('input', syncChips);

/* 로딩 / 빈 상태 */
function showSkeleton() {
  const row = `
    <li class="game skeleton" aria-hidden="true">
      <span class="game-rank"></span>
      <div class="game-thumb"></div>
      <div class="game-main"><div class="sk-line" style="width:60%"></div><div class="sk-line" style="width:35%;margin-top:10px"></div></div>
      <div class="score"></div>
    </li>`;
  resultsGrid.innerHTML = row.repeat(4);
}
function showEmpty(title, desc) {
  resultsGrid.innerHTML = '';
  resultsGrid.insertAdjacentHTML(
    'afterend',
    `<div class="empty" id="emptyBox"><strong>${escapeHtml(title)}</strong>${escapeHtml(desc)}</div>`
  );
}
function clearEmpty() {
  const box = document.getElementById('emptyBox');
  if (box) box.remove();
}

/* "더 보기" 영역 */
function updateMore(note = '', isError = false) {
  const hasMore = !!(state && state.cursor);
  const reachedEnd = !!(state && !state.cursor && state.pages > 1);
  moreBox.hidden = !(hasMore || reachedEnd || note);
  moreBtn.hidden = !hasMore;
  moreBtn.disabled = false;
  moreBtn.textContent = '더 보기';
  moreNote.classList.toggle('is-error', isError);
  moreNote.textContent = note || (reachedEnd ? '여기까지예요. 더 보여줄 게임이 없어요.' : '');
}

/* 상태 줄: 검색어, 태그, 지금까지 보여 준 개수 */
function renderStatus() {
  const d = state.meta;
  const shownCount = resultsGrid.querySelectorAll('.game').length;
  const tags = d.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('+');
  const total =
    typeof state.total === 'number'
      ? `Steam에서 ${state.total.toLocaleString()}개가 검색되어 지금까지 ${shownCount}개를 보여줍니다.`
      : `지금까지 ${shownCount}개를 보여줍니다.`;
  const aiEntries = Object.entries(d.ai_mapped || {});
  const aiNote = d.natural_language
    ? `<span class="note">AI가 이렇게 이해했어요: ${escapeHtml(d.interpretation || d.tags.join(' + '))}${
        d.korean_only ? ' (한글 지원 게임만)' : ''
      }</span>`
    : aiEntries.length
    ? `<span class="note">AI가 키워드를 태그로 바꿨어요: ${aiEntries
        .map(([k, v]) => `${escapeHtml(k)} → ${v.map(escapeHtml).join(', ')}`)
        .join(' / ')}</span>`
    : '';
  const hiddenNote = d.hidden_count
    ? `<span class="note">안 맞는다고 의견이 모인 게임이나 내가 비추천한 게임 ${d.hidden_count}개는 숨겼어요.</span>`
    : '';
  setStatus(`<strong>${escapeHtml(state.keyword)}</strong> 검색 결과. 태그 ${tags}. ${total}${aiNote}${hiddenNote}`);
}

async function runSearch(keyword) {
  const token = ++searchToken;
  state = null;
  updateMore();
  clearEmpty();
  setStatus('검색하는 중입니다. 처음 검색하는 키워드는 1~2분 걸릴 수 있어요.');
  showSkeleton();
  submitBtn.disabled = true;
  const priceQuery = priceParams();

  try {
    const res = await apiFetch(`/games/search?keyword=${encodeURIComponent(keyword)}${priceQuery}`);
    const data = await res.json();
    if (token !== searchToken) return; // 그 사이 다른 검색을 시작했으면 이 응답은 버림

    if (!res.ok) {
      resultsGrid.innerHTML = '';
      setStatus(escapeHtml(data.error || '검색에 실패했습니다. 잠시 후 다시 시도해 주세요.'), true);
      return;
    }

    window.currentSearchTags = data.tags; // 비추천할 때 "어떤 태그로 검색했는지" 같이 보냄
    state = {
      keyword,
      priceQuery,
      meta: data,
      cursor: data.next_cursor || null,
      shown: new Set(data.results.map((g) => g.appid)),
      total: data.source === 'live' && typeof data.total_matching_on_steam === 'number' ? data.total_matching_on_steam : null,
      pages: 1,
      loading: false,
    };

    if (data.results.length === 0) {
      resultsGrid.innerHTML = '';
      renderStatus();
      if (state.cursor) {
        // 이번 묶음은 걸러졌지만 Steam에 더 있을 수 있음
        updateMore('이번에는 보여줄 게임이 없었어요. 더 보기를 눌러 계속 찾아볼 수 있어요.');
      } else {
        showEmpty('조건에 맞는 게임을 찾지 못했어요', '키워드를 줄이거나 다른 단어로 바꿔 검색해 보세요.');
      }
      return;
    }

    resultsGrid.innerHTML = resultsHtml(data.results, 0);
    renderStatus();
    updateMore();
    if (typeof refreshHistory === 'function') refreshHistory(); // 방금 검색이 기록에 들어갔으니 목록 갱신
  } catch (err) {
    if (err.message === 'unauthorized') return;
    if (token !== searchToken) return;
    resultsGrid.innerHTML = '';
    setStatus('서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해 주세요.', true);
  } finally {
    if (token === searchToken) submitBtn.disabled = false;
  }
}

async function loadMore() {
  const st = state;
  if (!st || !st.cursor || st.loading) return;
  const token = searchToken;
  st.loading = true;
  moreBtn.disabled = true;
  moreBtn.textContent = '불러오는 중…';
  moreNote.classList.remove('is-error');
  moreNote.textContent = 'Steam에서 새로 가져오는 게임은 1~2분 걸릴 수 있어요.';

  let note = '';
  let isError = false;
  try {
    const res = await apiFetch(
      `/games/search?keyword=${encodeURIComponent(st.keyword)}&cursor=${encodeURIComponent(st.cursor)}${st.priceQuery || ''}`
    );
    const data = await res.json();
    if (token !== searchToken) return;
    if (!res.ok) {
      note = data.error || '더 불러오지 못했어요. 잠시 후 다시 눌러 주세요.';
      isError = true;
      return;
    }
    // 서버 캐시가 바뀌어 같은 게임이 다시 오더라도 화면에는 한 번만 올린다
    const fresh = data.results.filter((g) => !st.shown.has(g.appid));
    fresh.forEach((g) => st.shown.add(g.appid));
    st.cursor = data.next_cursor || null;
    st.pages += 1;
    if (typeof data.total_matching_on_steam === 'number') st.total = data.total_matching_on_steam;
    if (fresh.length > 0) {
      const startIndex = resultsGrid.querySelectorAll('.game').length;
      resultsGrid.insertAdjacentHTML('beforeend', resultsHtml(fresh, startIndex));
    } else if (st.cursor) {
      note = '이번에는 새로 보여줄 게임이 없었어요. 한 번 더 눌러 보세요.';
    }
    renderStatus();
  } catch (err) {
    if (err.message === 'unauthorized') return;
    note = '서버에 연결할 수 없습니다. 잠시 후 다시 눌러 주세요.';
    isError = true;
  } finally {
    st.loading = false;
    if (token === searchToken) updateMore(note, isError);
  }
}
moreBtn.addEventListener('click', loadMore);

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const keyword = keywordInput.value.trim();
  if (!keyword) return;
  runSearch(keyword);
});

function reviewsBlock(game) {
  const list = game.top_reviews || [];
  if (list.length === 0) return '';
  const items = list
    .map((r) => {
      const vote = r.voted_up
        ? '<span class="vote up">추천</span>'
        : '<span class="vote down">비추천</span>';
      const lang = LANGUAGE_NAMES[r.language] || r.language || '';
      const translation = r.translated_text
        ? `<div class="translation"><div class="translation-label">번역</div><p class="review-text">${escapeHtml(r.translated_text)}</p></div>`
        : '';
      return `
        <li class="review">
          <div class="review-meta">${vote}<span>유용해요 ${Number(r.votes_up).toLocaleString()}</span>${lang ? `<span>${escapeHtml(lang)}</span>` : ''}</div>
          <p class="review-text clamp">${escapeHtml(r.review_text) || '(내용 없음)'}</p>
          ${translation}
        </li>`;
    })
    .join('');
  return `
    <details class="reviews">
      <summary>유익한 리뷰 ${list.length}개 보기</summary>
      <ul class="review-list">${items}</ul>
    </details>`;
}

// startIndex: 이미 화면에 있는 카드 수 (순위 숫자를 이어서 매기기 위함)
function resultsHtml(results, startIndex) {
  clearEmpty();
  return results
    .map((game, idx) => {
      const score = Number(game.score);
      const thumb = game.header_image
        ? `<img class="game-thumb" src="${escapeHtml(game.header_image)}" alt="" loading="lazy" />`
        : `<div class="game-thumb game-thumb-empty">이미지 없음</div>`;
      const badge = game.supports_korean
        ? '<span class="badge badge-yes">한글 지원</span>'
        : '<span class="badge badge-no">한글 미지원</span>';

      return `
        <li class="game">
          <span class="game-rank">${startIndex + idx + 1}</span>
          ${thumb}
          <div class="game-main">
            <div class="game-title-row">
              <a class="game-title" href="https://store.steampowered.com/app/${encodeURIComponent(game.appid)}" target="_blank" rel="noopener">${escapeHtml(game.name)}</a>
              ${badge}
            </div>
            <p class="game-price-row">${priceHtml(game)}</p>
            <p class="game-counts">추천 ${game.total_positive.toLocaleString()}명, 비추천 ${game.total_negative.toLocaleString()}명</p>
            ${friendLikersHtml(game)}
            <div class="game-actions">${likeButtonHtml(game)}${dislikeButtonHtml(game)}</div>
          </div>
          <div class="score ${tierClass(score)}" aria-label="10점 만점에 ${score.toFixed(1)}점">
            <span class="score-num">${score.toFixed(1)}</span>
            <span class="score-max">/ 10</span>
          </div>
          <div class="game-detail">
            ${aiBlock(game)}
            ${reviewsBlock(game)}
          </div>
        </li>`;
    })
    .join('');
}

// 비추천해서 카드가 모두 사라지면 빈 상태 안내를 보여준다
document.addEventListener('card:removed', () => {
  if (state) renderStatus();
  if (resultsGrid.querySelectorAll('.game').length === 0 && !(state && state.cursor)) {
    showEmpty('남은 게임이 없어요', '다른 키워드로 검색해 보세요.');
  }
});

// 홈 화면의 "더 검색하기" 링크(search.html?keyword=...)로 들어오면 바로 검색
const initialKeyword = new URLSearchParams(window.location.search).get('keyword');
if (initialKeyword) {
  keywordInput.value = initialKeyword;
  syncChips();
  searchForm.requestSubmit();
}
