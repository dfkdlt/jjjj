// 검색 페이지(app.js)와 내 페이지(my.js)가 같이 쓰는 코드
const token = localStorage.getItem('token');
const username = localStorage.getItem('username');

// 로그인 안 되어 있으면 로그인 페이지로 이동
if (!token) {
  window.location.href = 'login.html';
}

document.getElementById('userLabel').textContent = `${username}님`;

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  window.location.href = 'login.html';
});

// 사용자 리뷰/게임명 등 외부 데이터를 innerHTML에 넣기 전 이스케이프 처리 (XSS 방지)
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function tierClass(score) {
  if (score >= 9) return 'tier-top';
  if (score >= 7) return 'tier-good';
  if (score >= 5) return 'tier-mid';
  return 'tier-low';
}

// 토큰이 만료/무효(401)면 저장된 토큰을 지우고 로그인 화면으로 보냄
// (안 지우면 login.html이 "이미 로그인됨"으로 보고 계속 이 화면으로 되돌려 보냄)
function handleUnauthorized() {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  alert('로그인이 만료되었습니다. 다시 로그인해주세요.');
  window.location.href = 'login.html';
}

// 인증 헤더를 붙여 API 호출. 401이면 로그인 화면으로 보내고 예외를 던져 이후 처리를 멈춘다.
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('unauthorized');
  }
  return res;
}

const THUMB_UP_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4v-9h3zM7 11l4-8c1.7 0 2.6 1.3 2.3 2.8L12.8 9H19a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.7 20H7"/></svg>';

// 추천 버튼 마크업 (검색 카드와 내 페이지 카드가 같이 사용)
function likeButtonHtml(game) {
  const liked = !!game.liked;
  return `<button type="button" class="like-btn" data-appid="${encodeURIComponent(game.appid)}" aria-pressed="${liked}">${THUMB_UP_SVG}<span class="like-label">${liked ? '추천함' : '추천'}</span></button>`;
}

// 추천 버튼 클릭 처리 (이벤트 위임)
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.like-btn');
  if (!btn || btn.disabled) return;
  const appid = btn.dataset.appid;
  const wasLiked = btn.getAttribute('aria-pressed') === 'true';
  btn.disabled = true;
  try {
    const res = await apiFetch(`/likes/${appid}`, { method: wasLiked ? 'DELETE' : 'POST' });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || '처리하지 못했습니다.');
      return;
    }
    btn.setAttribute('aria-pressed', String(data.liked));
    btn.querySelector('.like-label').textContent = data.liked ? '추천함' : '추천';
    document.dispatchEvent(new CustomEvent('like:changed', { detail: { appid, liked: data.liked, button: btn } }));
  } catch (err) {
    if (err.message !== 'unauthorized') alert('서버에 연결할 수 없습니다.');
  } finally {
    btn.disabled = false;
  }
});

function aiBlock(game) {
  const ai = game.ai_summary;
  if (ai) {
    const col = (items, cls, title) =>
      items && items.length
        ? `<div class="ai-col ${cls}"><h4>${title}</h4><ul>${items.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul></div>`
        : '';
    const points = col(ai.pros, 'pros', '장점') + col(ai.cons, 'cons', '단점');
    return `
      <section class="ai">
        <div class="ai-head">
          <span class="ai-title">AI 리뷰 요약</span>
          ${game.top_reviews ? `<span class="ai-note">유익한 리뷰 ${game.top_reviews.length}개를 바탕으로 했어요</span>` : ''}
        </div>
        <p class="ai-text">${escapeHtml(ai.summary)}</p>
        ${points ? `<div class="ai-points">${points}</div>` : ''}
      </section>`;
  }
  if (game.ai_summary_status === 'no_reviews') return ''; // 리뷰가 없는 건 오류가 아님
  if (game.liked_at) return ''; // 내 페이지: 저장된 요약이 없으면 그냥 표시하지 않음
  const reason =
    game.ai_summary_status === undefined
      ? '서버가 AI 요약 기능이 없는 옛 버전일 수 있어요. 백엔드를 최신 파일로 바꾸고 재시작해 보세요.'
      : game.ai_summary_reason || 'AI 요약을 만들지 못했어요.';
  return `<p class="ai-empty">AI 요약 없음: ${escapeHtml(reason)}</p>`;
}


/* ───── 비추천: 이유를 직접 쓰면 AI가 "태그 불일치 / 취향"으로 분석 ───── */
const THUMB_DOWN_SVG = THUMB_UP_SVG; // 모양은 같고 CSS로 뒤집어서 표시

function dislikeButtonHtml(game) {
  return `<button type="button" class="dislike-btn" data-appid="${encodeURIComponent(game.appid)}" aria-expanded="false">${THUMB_DOWN_SVG}<span>비추천</span></button>`;
}

function openDislikePanel(btn) {
  const actions = btn.closest('.game-actions');
  let panel = actions.parentElement.querySelector('.dislike-panel');
  if (panel) {
    // 이미 열려 있으면 닫기
    panel.remove();
    btn.setAttribute('aria-expanded', 'false');
    return;
  }
  const tags = window.currentSearchTags || [];
  const hint = tags.length
    ? `예: "${tags[0]} 게임이 아니에요" 또는 "제 취향이 아니에요"`
    : '예: "제 취향이 아니에요"';
  actions.insertAdjacentHTML(
    'afterend',
    `<form class="dislike-panel">
       <label for="dl-${btn.dataset.appid}">왜 비추천하나요?</label>
       <textarea id="dl-${btn.dataset.appid}" class="input" rows="3" maxlength="300" placeholder="${escapeHtml(hint)}" required></textarea>
       <p class="dislike-help">검색한 태그와 안 맞는다고 쓰면 검색 결과를 고치는 데 반영하고, 취향 때문이라고 쓰면 내 검색에서만 숨겨요.</p>
       <div class="dislike-row">
         <button type="submit" class="btn btn-small">보내기</button>
         <button type="button" class="btn btn-quiet btn-small dislike-cancel">닫기</button>
       </div>
       <p class="dislike-result" role="status" aria-live="polite"></p>
     </form>`
  );
  btn.setAttribute('aria-expanded', 'true');
  actions.parentElement.querySelector('textarea').focus();
}

function describeDislikeResult(data) {
  const parts = [];
  if (data.category === 'tag_mismatch') {
    const tags = data.mismatch_tags.join(', ');
    parts.push(`AI 분석: "${tags}" 태그가 안 맞는다는 의견이에요.`);
    const counts = data.report_counts || {};
    const progress = data.mismatch_tags.map((t) => `${t} ${counts[t] || 1}/${data.threshold}명`).join(', ');
    parts.push(`같은 의견이 ${data.threshold}명 이상 모이면 모두의 검색에서 빠져요. (현재 ${progress})`);
  } else {
    parts.push('AI 분석: 취향 때문에 싫다는 의견이에요. 내 검색에서만 숨겨요.');
  }
  if (!data.ai_used) parts.push('AI를 쓰지 못해 간단한 규칙으로 분류했어요.');
  return parts.join(' ');
}

// 카드를 목록에서 빼고 순위 숫자를 다시 매긴다
function removeGameCard(li) {
  const list = li.parentElement;
  li.remove();
  list.querySelectorAll('.game-rank').forEach((el, i) => (el.textContent = i + 1));
  document.dispatchEvent(new CustomEvent('card:removed'));
}

document.addEventListener('click', (e) => {
  const open = e.target.closest('.dislike-btn');
  if (open) {
    openDislikePanel(open);
    return;
  }
  if (e.target.closest('.dislike-cancel')) {
    const panel = e.target.closest('.dislike-panel');
    const card = panel.closest('.game');
    card.querySelector('.dislike-btn').setAttribute('aria-expanded', 'false');
    panel.remove();
  }
});

document.addEventListener('submit', async (e) => {
  const panel = e.target.closest('.dislike-panel');
  if (!panel) return;
  e.preventDefault();
  const card = panel.closest('.game');
  const appid = card.querySelector('.dislike-btn').dataset.appid;
  const textarea = panel.querySelector('textarea');
  const result = panel.querySelector('.dislike-result');
  const submit = panel.querySelector('button[type="submit"]');
  const text = textarea.value.trim();
  if (!text) return;

  submit.disabled = true;
  textarea.disabled = true;
  result.classList.remove('is-error');
  result.textContent = 'AI가 이유를 분석하는 중입니다.';
  try {
    const res = await apiFetch(`/dislikes/${appid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, tags: window.currentSearchTags || [] }),
    });
    const data = await res.json();
    if (!res.ok) {
      result.classList.add('is-error');
      result.textContent = data.error || '비추천하지 못했습니다.';
      submit.disabled = false;
      textarea.disabled = false;
      return;
    }
    result.textContent = `${describeDislikeResult(data)} 이 게임은 목록에서 숨깁니다.`;
    panel.querySelector('.dislike-row').hidden = true;
    setTimeout(() => removeGameCard(card), 3500);
  } catch (err) {
    if (err.message === 'unauthorized') return;
    result.classList.add('is-error');
    result.textContent = '서버에 연결할 수 없습니다.';
    submit.disabled = false;
    textarea.disabled = false;
  }
});


/* ───── 친구 ───── */
const PEOPLE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18 14c1.8.6 3 2.2 3 5"/></svg>';

// 이 게임을 추천한 친구가 있으면 "bob님이 추천했어요" 한 줄 (검색 결과, 홈 카드에서 같이 사용)
function friendLikersHtml(game) {
  const list = game.friend_likers || [];
  if (list.length === 0) return '';
  const shown = list.slice(0, 3).map(escapeHtml).join(', ');
  const text = list.length <= 3 ? `${shown}님이 추천했어요` : `${shown} 외 ${list.length - 3}명이 추천했어요`;
  return `<p class="friend-likers">${PEOPLE_SVG}<span>${text}</span></p>`;
}

// 메뉴의 "친구"에 받은 요청 수를 작은 숫자로 표시
function setFriendBadge(count) {
  const link = document.querySelector('.topnav a[href="friends.html"]');
  if (!link) return;
  link.querySelector('.nav-badge')?.remove();
  if (count > 0) {
    link.insertAdjacentHTML('beforeend', `<span class="nav-badge" aria-label="받은 친구 요청 ${count}개">${count > 9 ? '9+' : count}</span>`);
  }
}

// 친구 페이지는 목록을 직접 불러오면서 숫자를 맞추므로, 다른 페이지에서만 따로 확인한다
if (document.body.dataset.page !== 'friends') {
  apiFetch('/friends/pending-count')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => data && setFriendBadge(data.incoming))
    .catch(() => {});
}
