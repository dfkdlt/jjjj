const hintBox = document.getElementById('hintBox');
const sections = {
  popular: { box: document.getElementById('popularSection'), grid: document.getElementById('popularGrid'), note: document.getElementById('popularNote') },
  recentTaste: { box: document.getElementById('recentTasteSection'), grid: document.getElementById('recentTasteGrid'), note: document.getElementById('recentTasteNote') },
};
const recentGrid = document.getElementById('recentGrid');

document.getElementById('greeting').textContent = `${username}님, 오늘은 어떤 게임을 해볼까요?`;

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${y}년 ${Number(m)}월 ${Number(d)}일 출시`;
}

function tileHtml(game) {
  const url = `https://store.steampowered.com/app/${encodeURIComponent(game.appid)}`;
  const thumb = game.header_image
    ? `<img class="tile-thumb" src="${escapeHtml(game.header_image)}" alt="" loading="lazy" />`
    : `<div class="tile-thumb tile-thumb-empty">이미지 없음</div>`;
  const badge = game.supports_korean
    ? '<span class="badge badge-yes">한글 지원</span>'
    : '<span class="badge badge-no">한글 미지원</span>';
  const score =
    game.score === null || game.score === undefined
      ? `<div class="score score-sm score-none" aria-label="아직 평가 없음"><span class="score-num">-</span></div>`
      : `<div class="score score-sm ${tierClass(Number(game.score))}" aria-label="10점 만점에 ${Number(game.score).toFixed(1)}점"><span class="score-num">${Number(game.score).toFixed(1)}</span></div>`;
  const released = game.released ? `<p class="tile-date">${escapeHtml(formatDate(game.released))}</p>` : '';
  return `
    <li class="tile">
      <a href="${url}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${thumb}</a>
      <div class="tile-body">
        <div class="tile-head">
          <a class="game-title tile-title" href="${url}" target="_blank" rel="noopener">${escapeHtml(game.name)}</a>
          ${score}
        </div>
        <div class="tile-meta">${badge}${released}</div>
        <p class="tile-reviews">리뷰 ${Number(game.review_count || 0).toLocaleString()}개</p>
        ${friendLikersHtml(game)}
        <div class="game-actions">${likeButtonHtml(game)}</div>
      </div>
    </li>`;
}

// 할인 중인 게임 카드: 추천 버튼 대신 할인율과 가격을 보여준다
function dealTileHtml(game) {
  const url = `https://store.steampowered.com/app/${encodeURIComponent(game.appid)}`;
  const thumb = game.header_image
    ? `<img class="tile-thumb" src="${escapeHtml(game.header_image)}" alt="" loading="lazy" />`
    : `<div class="tile-thumb tile-thumb-empty">이미지 없음</div>`;
  const score = `<div class="score score-sm ${tierClass(Number(game.score))}" aria-label="10점 만점에 ${Number(game.score).toFixed(1)}점"><span class="score-num">${Number(game.score).toFixed(1)}</span></div>`;
  const old = game.initial_price ? `<s class="deal-old"><span class="sr-only">원래 가격 </span>${escapeHtml(game.initial_price)}</s>` : '';
  return `
    <li class="tile">
      <a href="${url}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${thumb}</a>
      <div class="tile-body">
        <div class="tile-head">
          <a class="game-title tile-title" href="${url}" target="_blank" rel="noopener">${escapeHtml(game.name)}</a>
          ${score}
        </div>
        <div class="deal-price">
          <span class="deal-off"><span class="sr-only">할인율 </span>-${Number(game.discount_percent)}%</span>
          ${old}
          <strong class="deal-now"><span class="sr-only">할인가 </span>${escapeHtml(game.final_price || '')}</strong>
        </div>
      </div>
    </li>`;
}

function skeleton(grid, n = 3) {
  grid.innerHTML = Array.from({ length: n })
    .map(() => '<li class="tile skeleton" aria-hidden="true"><div class="tile-thumb"></div><div class="tile-body"><div class="sk-line" style="width:70%"></div><div class="sk-line" style="width:40%;margin-top:10px"></div></div></li>')
    .join('');
}

function showError(grid, message) {
  grid.innerHTML = `<li class="tile-error">${escapeHtml(message)}</li>`;
}

function searchLink(labels) {
  return `search.html?keyword=${encodeURIComponent(labels.join(' '))}`;
}

// 추천한 게임이 아직 없을 때만 안내 문구를 보여준다 (취향 분석 자체는 내 페이지에 있음)
function showNoLikesHint() {
  hintBox.hidden = false;
  hintBox.innerHTML = `
    <div class="empty">
      <strong>아직 취향을 알 수 없어요</strong>
      검색 결과에서 마음에 드는 게임에 추천을 누르면, 취향에 맞는 게임을 여기에서 골라 드려요.<br />
      <a class="empty-link" href="search.html">게임 검색하러 가기</a>
    </div>`;
}

async function loadRecommend() {
  try {
    const res = await apiFetch('/home/recommend');
    const data = await res.json();
    if (!res.ok) {
      for (const s of Object.values(sections)) {
        s.box.hidden = false;
        s.note.textContent = '';
        showError(s.grid, data.error || '추천 게임을 불러오지 못했어요.');
      }
      return;
    }
    if (data.profile.liked_count === 0) {
      for (const s of Object.values(sections)) s.box.hidden = true;
      showNoLikesHint();
      return;
    }

    if (data.tags_used.length === 0) {
      // 추천한 게임은 있지만 태그를 하나도 분석하지 못한 경우
      for (const s of Object.values(sections)) s.box.hidden = true;
      hintBox.hidden = false;
      hintBox.innerHTML = '<div class="empty"><strong>취향 태그를 찾지 못했어요</strong>추천한 게임의 태그를 읽지 못했어요. 다른 게임도 추천해 보거나 잠시 뒤 다시 열어 보세요.</div>';
      return;
    }

    const labels = data.tags_used.map((t) => t.label);
    const tagText = labels.join(' + ');
    const link = `<a class="empty-link" href="${searchLink(labels)}">${escapeHtml(tagText)}로 더 검색하기</a>`;

    const fill = (key, list, title, emptyText) => {
      const s = sections[key];
      s.box.hidden = false;
      s.note.innerHTML = `${escapeHtml(tagText)} 태그 기준. ${link}`;
      s.grid.innerHTML = list.length ? list.map(tileHtml).join('') : `<li class="tile-error">${emptyText}</li>`;
    };
    fill('popular', data.popular, '', '이 태그의 인기 게임을 찾지 못했어요. (이미 추천한 게임은 빼고 보여줘요)');
    fill('recentTaste', data.recent, '', '이 태그로 최근 출시된 게임이 아직 없어요.');
  } catch (err) {
    if (err.message === 'unauthorized') return;
    for (const s of Object.values(sections)) {
      s.box.hidden = false;
      s.note.textContent = '';
      showError(s.grid, '서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해 주세요.');
    }
  }
}

// 추천한 게임 중 지금 할인 중인 게임. 추천한 게임이 없으면 이 영역은 나타나지 않는다.
async function loadDeals() {
  const box = document.getElementById('dealsSection');
  const grid = document.getElementById('dealsGrid');
  const note = document.getElementById('dealsNote');
  try {
    const res = await apiFetch('/home/deals');
    const data = await res.json();
    if (!res.ok || data.liked_count === 0) return; // 할인 알림은 부가 기능이라 실패해도 조용히 둔다
    box.hidden = false;
    if (data.deals.length > 0) {
      note.textContent = `추천한 게임 ${data.liked_count}개 중 ${data.deals.length}개가 할인 중이에요. 한국 스토어 가격이고, 몇 시간마다 새로 확인해요.`;
      grid.innerHTML = data.deals.map(dealTileHtml).join('');
    } else if (data.price_unavailable) {
      note.textContent = '';
      grid.innerHTML = '<li class="tile-error">가격 정보를 가져오지 못했어요. 잠시 후 다시 열어 보세요.</li>';
    } else {
      note.textContent = '';
      grid.innerHTML = `<li class="tile-error">추천한 게임 ${data.liked_count}개를 확인했는데, 지금 할인 중인 게임은 없어요.</li>`;
    }
  } catch (err) {
    // 로그인 만료는 apiFetch가 처리하고, 그 밖의 오류는 이 영역만 숨긴다
  }
}

// 친구들이 추천한 게임 (친구가 없거나 추천이 없으면 이 영역은 나타나지 않는다)
async function loadFriendPicks() {
  const box = document.getElementById('friendsSection');
  const grid = document.getElementById('friendsGrid');
  try {
    const res = await apiFetch('/friends/popular');
    const data = await res.json();
    if (!res.ok || data.results.length === 0) return;
    box.hidden = false;
    grid.innerHTML = data.results.map(tileHtml).join('');
  } catch (err) {
    // 부가 영역이라 실패해도 조용히 둔다
  }
}

async function loadRecent() {
  skeleton(recentGrid, 4);
  try {
    const res = await apiFetch('/home/recent');
    const data = await res.json();
    if (!res.ok) return showError(recentGrid, data.error || '최근 출시작을 불러오지 못했어요.');
    recentGrid.innerHTML = data.results.length
      ? data.results.map(tileHtml).join('')
      : '<li class="tile-error">조건에 맞는 최근 출시작이 아직 없어요.</li>';
  } catch (err) {
    if (err.message === 'unauthorized') return;
    showError(recentGrid, '서버에 연결할 수 없습니다.');
  }
}

// 두 영역을 따로 불러와서, 한쪽이 느려도 다른 쪽이 먼저 보이게 한다
for (const s of Object.values(sections)) {
  s.box.hidden = false;
  skeleton(s.grid, 3);
}
loadDeals();
loadFriendPicks();
loadRecommend();
loadRecent();
