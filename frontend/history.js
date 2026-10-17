// 검색 기록: 검색창 아래에 최근 검색과 자주 찾은 검색을 칩으로 보여주고, 누르면 바로 다시 검색한다.
// app.js보다 먼저 불러오며, 검색창 요소는 누를 때 찾아 쓴다.
const historyBox = document.getElementById('historyBox');
const historyRecent = document.getElementById('historyRecent');
const historyFrequent = document.getElementById('historyFrequent');

function historyItemHtml(item, showCount) {
  const k = escapeHtml(item.keyword);
  const count = showCount ? `<span class="history-count">${Number(item.count)}회</span>` : '';
  return `
    <li class="history-item">
      <button type="button" class="history-run" data-keyword="${k}" title="${k}"><span class="history-text">${k}</span>${count}</button>
      <button type="button" class="history-del" data-keyword="${k}" aria-label="${k} 기록 지우기">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </li>`;
}

function fillHistoryGroup(group, list, items, showCount) {
  group.hidden = items.length === 0;
  list.innerHTML = items.map((it) => historyItemHtml(it, showCount)).join('');
}

function renderHistory(data) {
  fillHistoryGroup(historyRecent, historyRecent.querySelector('.history-list'), data.recent || [], false);
  fillHistoryGroup(historyFrequent, historyFrequent.querySelector('.history-list'), data.frequent || [], true);
  historyBox.hidden = (data.recent || []).length + (data.frequent || []).length === 0;
}

// 기록을 불러와 그린다. 실패해도 검색 자체에는 영향이 없으므로 조용히 숨긴다.
async function refreshHistory() {
  try {
    const res = await apiFetch('/history');
    if (!res.ok) throw new Error('history');
    renderHistory(await res.json());
  } catch (err) {
    historyBox.hidden = true;
  }
}

historyBox.addEventListener('click', async (e) => {
  const run = e.target.closest('.history-run');
  if (run) {
    const input = document.getElementById('keywordInput');
    input.value = run.dataset.keyword;
    input.dispatchEvent(new Event('input')); // 추천 키워드 칩 표시도 맞춘다
    document.getElementById('searchForm').requestSubmit();
    return;
  }

  const del = e.target.closest('.history-del');
  if (del) {
    del.disabled = true;
    try {
      await apiFetch(`/history?keyword=${encodeURIComponent(del.dataset.keyword)}`, { method: 'DELETE' });
    } catch (err) {
      if (err.message === 'unauthorized') return;
    }
    refreshHistory();
    return;
  }

  if (e.target.closest('#clearHistory')) {
    if (!window.confirm('검색 기록을 모두 지울까요?')) return;
    try {
      await apiFetch('/history/all', { method: 'DELETE' });
    } catch (err) {
      if (err.message === 'unauthorized') return;
    }
    refreshHistory();
  }
});

refreshHistory();
