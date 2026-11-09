// 게임 상세 화면: Steam 상점 링크를 누르면 바로 Steam으로 가지 않고 이 사이트 안에서 정보를 보여 준다.
// (common.js 다음에 불러온다)
(function () {
  const APP_LINK = /^https:\/\/store\.steampowered\.com\/app\/(\d+)/;
  let overlay = null;
  let lastFocus = null;
  let reqToken = 0;
  let hlsPromise = null;

  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (!hlsPromise) {
      hlsPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js';
        s.onload = () => resolve(window.Hls);
        s.onerror = () => reject(new Error('hls load failed'));
        document.head.appendChild(s);
      });
    }
    return hlsPromise;
  }

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'dm-overlay';
    overlay.hidden = true;
    overlay.innerHTML = '<div class="dm" role="dialog" aria-modal="true" aria-label="게임 상세 정보"><button type="button" class="dm-close" aria-label="닫기">×</button><div class="dm-body"></div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('.dm-close')) close();
    });
    overlay.addEventListener('click', onInner);
    return overlay;
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    reqToken++;
    overlay.hidden = true;
    overlay.querySelector('.dm-body').innerHTML = ''; // 재생 중인 영상도 함께 멈춘다
    document.body.classList.remove('dm-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  const BODY = () => overlay.querySelector('.dm-body');

  function show(inner) {
    BODY().innerHTML = inner;
  }

  async function open(appid, hint) {
    ensureOverlay();
    const token = ++reqToken;
    overlay.hidden = false;
    document.body.classList.add('dm-open');
    overlay.querySelector('.dm-close').focus();
    show(`<div class="dm-loading">${hint && hint.name ? `<strong>${escapeHtml(hint.name)}</strong><br />` : ''}게임 정보를 불러오는 중이에요…</div>`);
    try {
      const res = await apiFetch(`/games/${encodeURIComponent(appid)}/detail`);
      const data = await res.json();
      if (token !== reqToken) return;
      if (!res.ok) {
        show(errorHtml(appid, data.error || '게임 정보를 가져오지 못했어요.'));
        return;
      }
      render(data);
    } catch (err) {
      if (token !== reqToken) return;
      show(errorHtml(appid, '서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'));
    }
  }

  function steamBtn(appid) {
    return `<a class="btn dm-steam" data-external href="https://store.steampowered.com/app/${encodeURIComponent(appid)}" target="_blank" rel="noopener">스팀에서 보기</a>`;
  }

  function errorHtml(appid, msg) {
    return `<div class="dm-loading"><p>${escapeHtml(msg)}</p>${steamBtn(appid)}</div>`;
  }

  function priceHtmlLocal(p) {
    if (!p) return '정보 없음';
    if (p.state === 'free') return '무료';
    if (p.discount_percent > 0) {
      return `<span class="price-off">-${p.discount_percent}%</span> <s class="price-old">${escapeHtml(p.initial_formatted)}</s> ${escapeHtml(p.final_formatted)}`;
    }
    return escapeHtml(p.final_formatted);
  }

  function render(data) {
    const d = data.detail || {};
    const g = data.game || {};
    const appid = data.appid;
    const name = d.name || g.name || '';
    const hero = d.header_image || g.header_image;
    const media = [];
    (d.movies || []).forEach((m) => media.push({ kind: 'video', m }));
    (d.screenshots || []).forEach((s) => media.push({ kind: 'shot', s }));

    const hasScore = g.score !== null && g.score !== undefined && !Number.isNaN(Number(g.score));
    const score = hasScore ? Number(g.score) : null;
    const tiles = [
      score !== null ? tile('겜슐랭 점수', `<span class="${tierClass(score)}">${score.toFixed(1)}</span> / 10`) : '',
      score !== null ? tile('스팀 평가', `추천 ${Number(g.total_positive).toLocaleString()} · 비추천 ${Number(g.total_negative).toLocaleString()}`) : '',
      tile('가격', priceHtmlLocal(d.price)),
      d.release_date ? tile('출시일', escapeHtml(d.release_date)) : '',
      d.developers && d.developers.length ? tile('개발사', escapeHtml(d.developers.join(', '))) : '',
      d.publishers && d.publishers.length ? tile('배급사', escapeHtml(d.publishers.join(', '))) : '',
      d.metacritic ? tile('메타크리틱', String(d.metacritic)) : '',
      g.supports_korean !== undefined && score !== null ? tile('한국어', g.supports_korean ? '지원' : '미지원') : '',
    ].join('');

    const genres = (d.genres || []).map((t) => `<span class="dm-chip">${escapeHtml(t)}</span>`).join('');
    const stale = data.stale ? '<p class="dm-note">Steam이 바빠서 저장해 둔 정보를 보여 주고 있어요.</p>' : '';

    show(`
      <div class="dm-hero">${hero ? `<img src="${escapeHtml(hero)}" alt="" />` : ''}</div>
      <div class="dm-head">
        <h2 class="dm-title">${escapeHtml(name)}</h2>
        ${steamBtn(appid)}
      </div>
      ${genres ? `<div class="dm-chips">${genres}</div>` : ''}
      ${d.short_description ? `<p class="dm-desc">${escapeHtml(d.short_description)}</p>` : ''}
      <div class="dm-tiles">${tiles}</div>
      ${media.length ? `<h3 class="dm-h">소개 영상과 사진</h3><div class="dm-gallery"><div class="dm-stage"></div><div class="dm-thumbs"></div></div>` : '<p class="dm-note">Steam에 등록된 영상이나 사진이 없어요.</p>'}
      ${g.ai_summary ? `<div class="dm-ai">${aiBlock(g)}</div>` : ''}
      ${stale}
    `);
    if (media.length) setupGallery(media);
  }

  function tile(label, valueHtml) {
    return `<div class="dm-tile"><span class="dm-tile-label">${label}</span><span class="dm-tile-value">${valueHtml}</span></div>`;
  }

  function setupGallery(media) {
    const stage = BODY().querySelector('.dm-stage');
    const thumbs = BODY().querySelector('.dm-thumbs');
    thumbs.innerHTML = media
      .map((it, i) => {
        const src = it.kind === 'video' ? it.m.thumbnail : it.s.thumb || it.s.full;
        return `<button type="button" class="dm-thumb${it.kind === 'video' ? ' is-video' : ''}" data-i="${i}" aria-label="${it.kind === 'video' ? '영상' : '사진'} ${i + 1}">${src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" />` : ''}</button>`;
      })
      .join('');
    thumbs.addEventListener('click', (e) => {
      const b = e.target.closest('.dm-thumb');
      if (b) select(Number(b.dataset.i));
    });

    function select(i) {
      const it = media[i];
      thumbs.querySelectorAll('.dm-thumb').forEach((t, k) => t.classList.toggle('is-active', k === i));
      if (it.kind === 'shot') {
        stage.innerHTML = `<img src="${escapeHtml(it.s.full || it.s.thumb)}" alt="" />`;
        return;
      }
      const m = it.m;
      const sources = [m.mp4 ? `<source src="${escapeHtml(m.mp4)}" type="video/mp4" />` : '', m.webm ? `<source src="${escapeHtml(m.webm)}" type="video/webm" />` : ''].join('');
      stage.innerHTML = `<video controls playsinline preload="metadata" ${m.thumbnail ? `poster="${escapeHtml(m.thumbnail)}"` : ''}>${sources}</video>`;
      const video = stage.querySelector('video');
      if (!sources && m.hls) {
        if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = m.hls;
        else loadHls().then((Hls) => { if (Hls && Hls.isSupported() && stage.contains(video)) { const h = new Hls(); h.loadSource(m.hls); h.attachMedia(video); } }).catch(() => {
          stage.innerHTML = '<p class="dm-note">이 영상은 여기서 재생할 수 없어요. "스팀에서 보기"에서 확인해 주세요.</p>';
        });
      }
    }
    select(0);
  }

  function onInner(e) {
    // 상세 화면 안의 링크 처리는 따로 필요 없음 (스팀 버튼은 새 탭)
  }

  // 스팀 상점 게임 링크를 가로채서 상세 화면을 연다. Ctrl/Cmd/휠 클릭이나 data-external 링크는 그대로 둔다.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.hasAttribute('data-external')) return;
    const m = APP_LINK.exec(a.href);
    if (!m) return;
    e.preventDefault();
    lastFocus = a;
    const card = a.closest('.game, .tile');
    const nameEl = a.matches('.game-title') ? a : card && card.querySelector('.game-title, .tile-title');
    open(m[1], { name: nameEl ? nameEl.textContent.trim() : '' });
  });

  window.openGameDetail = open;
})();
