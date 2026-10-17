// 친구 페이지: 친구 요청, 받은 요청 수락/거절, 친구 목록, 친구가 추천한 게임, 공개 설정
const addForm = document.getElementById('addForm');
const addInput = document.getElementById('addInput');
const addMsg = document.getElementById('addMsg');
const incomingSection = document.getElementById('incomingSection');
const incomingList = document.getElementById('incomingList');
const outgoingSection = document.getElementById('outgoingSection');
const outgoingList = document.getElementById('outgoingList');
const friendsBox = document.getElementById('friendsBox');
const shareLikes = document.getElementById('shareLikes');
const likesSection = document.getElementById('likesSection');
const likesBox = document.getElementById('likesBox');

let overview = null;
let selectedId = null; // 추천 목록을 보고 있는 친구
let likesSeq = 0; // 응답이 늦게 와도 마지막 선택의 결과만 그린다

const setCount = (id, n) => (document.getElementById(id).textContent = n ? `${n}명` : '');

function say(text, isError = false) {
  addMsg.classList.toggle('is-error', isError);
  addMsg.textContent = text;
}

function avatar(name) {
  return `<span class="avatar" aria-hidden="true">${escapeHtml(Array.from(name)[0] || '?')}</span>`;
}

function personRow(p, sub, actions, extraClass = '') {
  return `
    <li class="person ${extraClass}" data-id="${Number(p.id)}">
      ${avatar(p.username)}
      <div class="person-main">
        <strong class="person-name">${escapeHtml(p.username)}</strong>
        <span class="person-sub">${sub}</span>
      </div>
      <div class="person-actions">${actions}</div>
    </li>`;
}

function renderOverview(data) {
  overview = data;
  shareLikes.checked = !data.me.likes_private;

  incomingSection.hidden = data.incoming.length === 0;
  setCount('incomingCount', data.incoming.length);
  incomingList.innerHTML = data.incoming
    .map((p) =>
      personRow(
        p,
        '친구 요청을 보냈어요',
        `<button type="button" class="btn btn-small" data-act="accept">수락</button>
         <button type="button" class="btn btn-quiet btn-small" data-act="decline">거절</button>`
      )
    )
    .join('');

  outgoingSection.hidden = data.outgoing.length === 0;
  setCount('outgoingCount', data.outgoing.length);
  outgoingList.innerHTML = data.outgoing
    .map((p) => personRow(p, '상대가 수락하면 친구가 돼요', '<button type="button" class="btn btn-quiet btn-small" data-act="cancel">요청 취소</button>'))
    .join('');

  setCount('friendsCount', data.friends.length);
  if (data.friends.length === 0) {
    friendsBox.innerHTML = `<div class="empty"><strong>아직 친구가 없어요</strong>위에 친구의 아이디를 입력해서 요청을 보내 보세요. 상대가 수락하면 서로 추천한 게임을 볼 수 있어요.</div>`;
  } else {
    friendsBox.innerHTML = `<ul class="people">${data.friends
      .map((p) => {
        const sub = p.likes_private ? '추천 목록을 비공개로 해 뒀어요' : `추천한 게임 ${p.likes_count}개`;
        const view = `<button type="button" class="btn btn-quiet btn-small" data-act="view"${p.likes_private ? ' disabled' : ''}>추천 목록 보기</button>`;
        return personRow(p, sub, `${view}<button type="button" class="link-btn" data-act="remove">삭제</button>`, p.id === selectedId ? 'is-selected' : '');
      })
      .join('')}</ul>`;
  }

  // 선택해 둔 친구가 목록에서 사라졌으면(삭제 등) 추천 목록 영역을 닫는다
  if (selectedId && !data.friends.some((f) => f.id === selectedId && !f.likes_private)) closeLikes();
  if (typeof setFriendBadge === 'function') setFriendBadge(data.incoming.length);
}

async function loadOverview() {
  try {
    const res = await apiFetch('/friends');
    const data = await res.json();
    if (!res.ok) {
      friendsBox.innerHTML = `<p class="tile-error">${escapeHtml(data.error || '친구 목록을 불러오지 못했어요.')}</p>`;
      return false;
    }
    renderOverview(data);
    return true;
  } catch (err) {
    if (err.message !== 'unauthorized') friendsBox.innerHTML = '<p class="tile-error">서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해 주세요.</p>';
    return false;
  }
}

/* ───── 친구 요청 ───── */
addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = addInput.value.trim();
  if (!username) return;
  const btn = addForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  say('');
  try {
    const res = await apiFetch('/friends/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const data = await res.json();
    if (!res.ok) {
      say(data.error || '요청을 보내지 못했어요.', true);
      return;
    }
    addInput.value = '';
    say(
      data.status === 'accepted'
        ? `${data.user.username}님과 친구가 되었어요.`
        : `${data.user.username}님에게 친구 요청을 보냈어요. 수락하면 친구가 돼요.`
    );
    loadOverview();
  } catch (err) {
    if (err.message !== 'unauthorized') say('서버에 연결할 수 없습니다.', true);
  } finally {
    btn.disabled = false;
  }
});

/* ───── 목록의 버튼들 (이벤트 위임) ───── */
async function act(btn, path, options, failText) {
  btn.disabled = true;
  try {
    const res = await apiFetch(path, options);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      say(data.error || failText, true);
      return false;
    }
    say('');
    return true;
  } catch (err) {
    if (err.message !== 'unauthorized') say('서버에 연결할 수 없습니다.', true);
    return false;
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const row = btn.closest('.person');
  const id = Number(row.dataset.id);
  const name = row.querySelector('.person-name').textContent;

  switch (btn.dataset.act) {
    case 'accept':
      if (await act(btn, `/friends/${id}/accept`, { method: 'POST' }, '수락하지 못했어요.')) {
        say(`${name}님과 친구가 되었어요.`);
      }
      loadOverview();
      break;
    case 'decline':
      await act(btn, `/friends/${id}/decline`, { method: 'POST' }, '거절하지 못했어요.');
      loadOverview();
      break;
    case 'cancel':
      await act(btn, `/friends/${id}`, { method: 'DELETE' }, '취소하지 못했어요.');
      loadOverview();
      break;
    case 'remove':
      if (!window.confirm(`${name}님을 친구에서 삭제할까요?`)) return;
      if (selectedId === id) closeLikes();
      await act(btn, `/friends/${id}`, { method: 'DELETE' }, '삭제하지 못했어요.');
      loadOverview();
      break;
    case 'view':
      selectFriend(id);
      break;
  }
});

/* ───── 내 공개 설정 ───── */
shareLikes.addEventListener('change', async () => {
  const wantShare = shareLikes.checked;
  shareLikes.disabled = true;
  try {
    const res = await apiFetch('/friends/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ likes_private: !wantShare }),
    });
    if (!res.ok) throw new Error('save');
    say(wantShare ? '친구가 내 추천 목록을 볼 수 있어요.' : '이제 친구도 내 추천 목록을 볼 수 없어요.');
  } catch (err) {
    if (err.message === 'unauthorized') return;
    shareLikes.checked = !wantShare; // 저장하지 못했으면 되돌린다
    say('설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.', true);
  } finally {
    shareLikes.disabled = false;
  }
});

/* ───── 친구가 추천한 게임 ───── */
function closeLikes() {
  selectedId = null;
  likesSeq++;
  likesSection.hidden = true;
  likesBox.innerHTML = '';
  history.replaceState(null, '', 'friends.html');
  document.querySelectorAll('.person.is-selected').forEach((el) => el.classList.remove('is-selected'));
}

function likedCardHtml(game) {
  const thumb = game.header_image
    ? `<img class="game-thumb" src="${escapeHtml(game.header_image)}" alt="" loading="lazy" />`
    : `<div class="game-thumb game-thumb-empty">이미지 없음</div>`;
  const badge = game.supports_korean
    ? '<span class="badge badge-yes">한글 지원</span>'
    : '<span class="badge badge-no">한글 미지원</span>';
  const score = Number(game.score);
  const summary = aiBlock(game);
  return `
    <li class="game" data-appid="${escapeHtml(game.appid)}">
      ${thumb}
      <div class="game-main">
        <div class="game-title-row">
          <a class="game-title" href="https://store.steampowered.com/app/${encodeURIComponent(game.appid)}" target="_blank" rel="noopener">${escapeHtml(game.name)}</a>
          ${badge}
        </div>
        <p class="game-counts">추천 ${Number(game.total_positive).toLocaleString()}명, 비추천 ${Number(game.total_negative).toLocaleString()}명</p>
        <div class="game-actions">${likeButtonHtml(game)}</div>
      </div>
      <div class="score ${tierClass(score)}" aria-label="10점 만점에 ${score.toFixed(1)}점">
        <span class="score-num">${score.toFixed(1)}</span>
        <span class="score-max">/ 10</span>
      </div>
      ${summary ? `<div class="game-detail">${summary}</div>` : ''}
    </li>`;
}

async function selectFriend(id) {
  const friend = overview && overview.friends.find((f) => f.id === id);
  if (!friend) return;
  selectedId = id;
  const seq = ++likesSeq;
  history.replaceState(null, '', `friends.html?friend=${id}`);
  document.querySelectorAll('.person').forEach((el) => el.classList.toggle('is-selected', Number(el.dataset.id) === id && !!el.querySelector('[data-act="view"]')));

  likesSection.hidden = false;
  document.getElementById('likesHeading').firstChild.textContent = `${friend.username}님이 추천한 게임 `;
  document.getElementById('likesCount').textContent = '';
  likesBox.innerHTML = '<div class="sk-line" style="width:40%"></div>';
  likesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const res = await apiFetch(`/friends/${id}/likes`);
    const data = await res.json();
    if (seq !== likesSeq) return;
    if (!res.ok) {
      likesBox.innerHTML = `<div class="empty"><strong>${data.private ? '비공개예요' : '볼 수 없어요'}</strong>${escapeHtml(data.error || '추천 목록을 불러오지 못했어요.')}</div>`;
      if (data.private) loadOverview();
      return;
    }
    document.getElementById('likesCount').textContent = data.count ? `${data.count}개` : '';
    likesBox.innerHTML = data.results.length
      ? `<ol class="results results-plain">${data.results.map(likedCardHtml).join('')}</ol>`
      : `<div class="empty"><strong>아직 추천한 게임이 없어요</strong>${escapeHtml(friend.username)}님이 게임을 추천하면 여기에 나타나요.</div>`;
  } catch (err) {
    if (err.message === 'unauthorized' || seq !== likesSeq) return;
    likesBox.innerHTML = '<p class="tile-error">서버에 연결할 수 없습니다.</p>';
  }
}

(async function init() {
  const ok = await loadOverview();
  const wanted = Number(new URLSearchParams(location.search).get('friend'));
  if (ok && wanted) selectFriend(wanted);
})();
