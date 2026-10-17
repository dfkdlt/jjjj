const statusMessage = document.getElementById('statusMessage');
const resultsGrid = document.getElementById('resultsGrid');
const dislikedGrid = document.getElementById('dislikedGrid');
const likedCount = document.getElementById('likedCount');
const dislikedCount = document.getElementById('dislikedCount');
const tasteBox = document.getElementById('tasteBox');


/* ───── 내 취향 도넛 차트 ───── */
const SVG_NS = 'http://www.w3.org/2000/svg';
const DONUT = { size: 220, cx: 110, cy: 110, outer: 98, inner: 64 };

function polar(radius, angle) {
  return [DONUT.cx + radius * Math.cos(angle), DONUT.cy + radius * Math.sin(angle)];
}

// 한 조각의 경로 (시작각/끝각은 라디안, 12시 방향이 0%)
function arcPath(a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(DONUT.outer, a0);
  const [x1, y1] = polar(DONUT.outer, a1);
  const [x2, y2] = polar(DONUT.inner, a1);
  const [x3, y3] = polar(DONUT.inner, a0);
  const f = (n) => n.toFixed(2);
  return `M${f(x0)} ${f(y0)}A${DONUT.outer} ${DONUT.outer} 0 ${large} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${DONUT.inner} ${DONUT.inner} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`;
}

// 프로필 -> 조각 목록 [{ label, count, pct, color }]
// 추천한 게임에서 가장 많이 나온 태그 5개만 쓰고, 비율은 이 태그들끼리의 몫이다
function buildSlices(profile) {
  const top = profile.tags;
  const total = top.reduce((s, t) => s + t.count, 0);
  const slices = top.map((t, i) => ({ label: t.label, count: t.count, color: `var(--series-${i + 1})` }));
  // 반올림하면 합이 99%나 101%가 될 수 있어서, 소수 부분이 큰 조각부터 1%씩 나눠 합을 정확히 100%로 맞춘다
  const raw = slices.map((s) => (s.count / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  raw
    .map((v, i) => [v - Math.floor(v), i])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .forEach(([, i]) => {
      if (left > 0) { floors[i] += 1; left -= 1; }
    });
  slices.forEach((s, i) => (s.pct = floors[i]));
  return { slices, total };
}

function renderTaste(profile) {
  if (profile.liked_count === 0) {
    tasteBox.innerHTML = `
      <div class="empty">
        <strong>아직 취향을 알 수 없어요</strong>
        검색 결과에서 마음에 드는 게임에 추천을 누르면, 그 게임들의 태그를 분석해서 여기에 보여드려요.<br />
        <a class="empty-link" href="search.html">게임 검색하러 가기</a>
      </div>`;
    return;
  }
  if (profile.tags.length === 0) {
    tasteBox.innerHTML = '<div class="empty"><strong>태그를 찾지 못했어요</strong>추천한 게임의 태그를 읽지 못했어요. 다른 게임도 추천해 보거나 잠시 뒤 다시 열어 보세요.</div>';
    return;
  }

  const { slices, total } = buildSlices(profile);
  const basis = profile.basis === 'store_tags' ? 'Steam 상점 태그 기준' : '우리 사이트에서 검색된 태그 기준';

  // 도넛 조각: 12시 방향에서 시계 방향으로
  let angle = -Math.PI / 2;
  const segs = slices
    .map((s, i) => {
      const sweep = (s.count / total) * Math.PI * 2;
      const label = `${s.label}, 추천한 게임에 ${s.count}번 나왔어요 (${s.pct}%)`;
      let shape;
      if (slices.length === 1) {
        // 조각이 하나뿐이면 호 대신 고리 하나
        const mid = (DONUT.outer + DONUT.inner) / 2;
        shape = `<circle class="donut-seg" data-i="${i}" cx="${DONUT.cx}" cy="${DONUT.cy}" r="${mid}" fill="none" stroke="${s.color}" stroke-width="${DONUT.outer - DONUT.inner}" tabindex="0" role="img" aria-label="${escapeHtml(label)}" />`;
      } else {
        shape = `<path class="donut-seg" data-i="${i}" d="${arcPath(angle, angle + sweep)}" fill="${s.color}" tabindex="0" role="img" aria-label="${escapeHtml(label)}" />`;
      }
      angle += sweep;
      return shape;
    })
    .join('');

  const rows = slices
    .map(
      (s, i) => `
      <tr class="taste-row" data-i="${i}">
        <th scope="row"><span class="swatch" style="background:${s.color}" aria-hidden="true"></span>${escapeHtml(s.label)}</th>
        <td>${s.count}번</td>
        <td>${s.pct}%</td>
      </tr>`
    )
    .join('');

  tasteBox.innerHTML = `
    <div class="taste-card">
      <div class="donut-wrap">
        <svg class="donut" viewBox="0 0 ${DONUT.size} ${DONUT.size}" aria-label="추천한 게임의 태그 비율 도넛 차트">${segs}</svg>
        <div class="donut-center" aria-hidden="true">
          <span class="donut-main" id="donutMain">${profile.liked_count}</span>
          <span class="donut-sub" id="donutSub">추천한 게임</span>
        </div>
      </div>
      <div class="taste-side">
        <p class="taste-lead">추천한 게임 ${profile.liked_count}개에서 가장 많이 나온 태그 ${profile.tags.length}개예요. <span class="taste-basis">${basis}</span></p>
        <table class="taste-table">
          <thead><tr><th scope="col">태그</th><th scope="col">횟수</th><th scope="col">비율</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="taste-note">한 게임에 태그가 여러 개 있어서, 위 태그들이 나온 횟수끼리 나눈 비율이에요.</p>
      </div>
    </div>`;

  // 조각이나 표의 줄에 마우스를 올리거나 포커스하면 가운데에 수치를 보여주고 나머지는 흐리게
  const card = tasteBox.querySelector('.taste-card');
  const main = card.querySelector('#donutMain');
  const sub = card.querySelector('#donutSub');
  const defaultMain = String(profile.liked_count);
  const setActive = (i) => {
    card.classList.toggle('has-active', i !== null);
    card.querySelectorAll('[data-i]').forEach((el) => el.classList.toggle('is-active', Number(el.dataset.i) === i));
    if (i === null) {
      main.textContent = defaultMain;
      sub.textContent = '추천한 게임';
    } else {
      main.textContent = `${slices[i].pct}%`;
      sub.textContent = `${slices[i].label} ${slices[i].count}번`;
    }
  };
  card.querySelectorAll('[data-i]').forEach((el) => {
    const i = Number(el.dataset.i);
    el.addEventListener('mouseenter', () => setActive(i));
    el.addEventListener('mouseleave', () => setActive(null));
    el.addEventListener('focus', () => setActive(i));
    el.addEventListener('blur', () => setActive(null));
  });
}

let tasteSeq = 0; // 응답이 늦게 도착해도 마지막 요청 결과만 그린다
async function loadTaste() {
  const seq = ++tasteSeq;
  if (!tasteBox.firstChild) tasteBox.innerHTML = '<div class="sk-line" style="width:40%"></div>';
  try {
    const res = await apiFetch('/home/profile');
    const data = await res.json();
    if (seq !== tasteSeq) return;
    if (!res.ok) {
      tasteBox.innerHTML = `<p class="tile-error">${escapeHtml(data.error || '취향을 분석하지 못했어요.')}</p>`;
      return;
    }
    renderTaste(data);
  } catch (err) {
    if (err.message === 'unauthorized' || seq !== tasteSeq) return;
    tasteBox.innerHTML = '<p class="tile-error">서버에 연결할 수 없습니다.</p>';
  }
}

function emptyBoxHtml(id, title, desc, withLink) {
  return `<div class="empty" id="${id}"><strong>${title}</strong>${desc}${
    withLink ? '<br /><a class="empty-link" href="index.html">게임 검색하러 가기</a>' : ''
  }</div>`;
}

// 두 목록의 개수와 빈 상태 안내를 갱신
function refresh() {
  const liked = resultsGrid.querySelectorAll('.game').length;
  const disliked = dislikedGrid.querySelectorAll('.game').length;
  likedCount.textContent = liked ? `${liked}개` : '';
  dislikedCount.textContent = disliked ? `${disliked}개` : '';

  document.getElementById('emptyLiked')?.remove();
  document.getElementById('emptyDisliked')?.remove();
  if (liked === 0) {
    resultsGrid.insertAdjacentHTML(
      'afterend',
      emptyBoxHtml('emptyLiked', '아직 추천한 게임이 없어요', '검색 결과에서 마음에 드는 게임의 추천 버튼을 눌러 보세요.', true)
    );
  }
  if (disliked === 0) {
    dislikedGrid.insertAdjacentHTML(
      'afterend',
      emptyBoxHtml('emptyDisliked', '비추천한 게임이 없어요', '검색 결과가 안 맞거나 취향이 아니면 비추천에 이유를 남겨 보세요.', false)
    );
  }
}

function thumbHtml(game) {
  return game.header_image
    ? `<img class="game-thumb" src="${escapeHtml(game.header_image)}" alt="" loading="lazy" />`
    : `<div class="game-thumb game-thumb-empty">이미지 없음</div>`;
}

function scoreHtml(game) {
  const score = Number(game.score);
  return `<div class="score ${tierClass(score)}" aria-label="10점 만점에 ${score.toFixed(1)}점">
            <span class="score-num">${score.toFixed(1)}</span>
            <span class="score-max">/ 10</span>
          </div>`;
}

function titleHtml(game) {
  return `<a class="game-title" href="https://store.steampowered.com/app/${encodeURIComponent(game.appid)}" target="_blank" rel="noopener">${escapeHtml(game.name)}</a>`;
}

function renderLiked(results) {
  resultsGrid.innerHTML = results
    .map((game) => {
      const badge = game.supports_korean
        ? '<span class="badge badge-yes">한글 지원</span>'
        : '<span class="badge badge-no">한글 미지원</span>';
      const summary = aiBlock(game);
      return `
        <li class="game" data-appid="${escapeHtml(game.appid)}">
          ${thumbHtml(game)}
          <div class="game-main">
            <div class="game-title-row">${titleHtml(game)}${badge}</div>
            <p class="game-counts">추천 ${game.total_positive.toLocaleString()}명, 비추천 ${game.total_negative.toLocaleString()}명</p>
            <div class="game-actions">${likeButtonHtml(game)}</div>
          </div>
          ${scoreHtml(game)}
          ${summary ? `<div class="game-detail">${summary}</div>` : ''}
        </li>`;
    })
    .join('');
}

function renderDisliked(results) {
  dislikedGrid.innerHTML = results
    .map((game) => {
      const label =
        game.category === 'tag_mismatch'
          ? `<span class="badge badge-warn">태그 불일치: ${escapeHtml(game.mismatch_tags.join(', '))}</span>`
          : '<span class="badge badge-no">취향</span>';
      return `
        <li class="game" data-appid="${escapeHtml(game.appid)}">
          ${thumbHtml(game)}
          <div class="game-main">
            <div class="game-title-row">${titleHtml(game)}${label}</div>
            <p class="dislike-quote">${escapeHtml(game.reason_text)}</p>
            ${game.ai_reason ? `<p class="game-counts">AI 분석: ${escapeHtml(game.ai_reason)}</p>` : ''}
            <div class="game-actions"><button type="button" class="undo-btn" data-appid="${encodeURIComponent(game.appid)}">비추천 취소</button></div>
          </div>
          ${scoreHtml(game)}
        </li>`;
    })
    .join('');
}

// 추천을 취소하면 목록에서 바로 뺀다
document.addEventListener('like:changed', (e) => {
  if (e.detail.liked) return;
  e.detail.button.closest('.game')?.remove();
  refresh();
  loadTaste();
});

// 비추천 취소
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.undo-btn');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  try {
    const res = await apiFetch(`/dislikes/${btn.dataset.appid}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || '취소하지 못했습니다.');
      btn.disabled = false;
      return;
    }
    btn.closest('.game').remove();
    refresh();
  } catch (err) {
    if (err.message !== 'unauthorized') alert('서버에 연결할 수 없습니다.');
    btn.disabled = false;
  }
});

async function load() {
  statusMessage.textContent = '불러오는 중입니다.';
  try {
    const [likesRes, dislikesRes] = await Promise.all([apiFetch('/likes'), apiFetch('/dislikes')]);
    const likes = await likesRes.json();
    const dislikes = await dislikesRes.json();
    if (!likesRes.ok || !dislikesRes.ok) {
      statusMessage.classList.add('is-error');
      statusMessage.textContent = likes.error || dislikes.error || '불러오지 못했습니다.';
      return;
    }
    statusMessage.textContent = '';
    renderLiked(likes.results);
    renderDisliked(dislikes.results);
    refresh();
  } catch (err) {
    if (err.message === 'unauthorized') return;
    statusMessage.classList.add('is-error');
    statusMessage.textContent = '서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해 주세요.';
  }
}

load();
loadTaste();
