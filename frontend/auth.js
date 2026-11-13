const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const authMessage = document.getElementById('authMessage');

function clearMessage() {
  authMessage.textContent = '';
  authMessage.classList.remove('is-ok');
}

tabLogin.addEventListener('click', () => {
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  loginForm.hidden = false;
  registerForm.hidden = true;
  clearMessage();
});

tabRegister.addEventListener('click', () => {
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  registerForm.hidden = false;
  loginForm.hidden = true;
  clearMessage();
});

// 이미 로그인되어 있으면 바로 메인 페이지로 이동
if (localStorage.getItem('token')) {
  window.location.href = 'index.html';
}

async function postJson(path, payload) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {}
  return { res, data };
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const { res, data } = await postJson('/auth/login', { username, password });
    if (!res.ok) {
      authMessage.textContent = data.error || '로그인에 실패했습니다.';
      return;
    }
    localStorage.setItem('token', data.token);
    localStorage.setItem('username', data.username);
    window.location.href = 'index.html';
  } catch (err) {
    authMessage.textContent = '서버에 연결할 수 없습니다.';
  }
});

// ───────── 회원가입 ─────────
const el = (id) => document.getElementById(id);
const regUsername = el('registerUsername');
const regEmail = el('registerEmail');
const emailHint = el('emailHint');
const regPw = el('registerPassword');
const regPw2 = el('registerPasswordConfirm');
const pwHint = el('pwHint');
const agreeAll = el('agreeAll');
const agreeTerms = el('agreeTerms');
const agreePrivacy = el('agreePrivacy');
const regSubmit = el('registerSubmit');

function setHint(node, text, kind) {
  node.textContent = text || '';
  node.classList.toggle('is-ok', kind === 'ok');
  node.classList.toggle('is-err', kind === 'err');
}
function emailValue() {
  return regEmail.value.trim().toLowerCase();
}
function validEmailFormat(v) {
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}
function passwordProblem(pw) {
  if (pw.length < 8) return '8자 이상 입력해 주세요.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '영문과 숫자를 모두 넣어 주세요.';
  return null;
}

function updateEmailHint() {
  const v = emailValue();
  if (!v) return setHint(emailHint, '', null);
  if (!validEmailFormat(v)) return setHint(emailHint, '이메일 주소 형식이 올바르지 않아요.', 'err');
  setHint(emailHint, '', null);
}

function updatePwHint() {
  if (!regPw.value && !regPw2.value) return setHint(pwHint, '', null);
  const problem = passwordProblem(regPw.value);
  if (problem) return setHint(pwHint, `비밀번호: ${problem}`, 'err');
  if (!regPw2.value) return setHint(pwHint, '', null);
  if (regPw.value !== regPw2.value) return setHint(pwHint, '비밀번호가 서로 달라요.', 'err');
  setHint(pwHint, '비밀번호가 일치해요.', 'ok');
}

function updateSubmit() {
  const ok =
    regUsername.value.trim().length >= 3 &&
    validEmailFormat(emailValue()) &&
    !passwordProblem(regPw.value) &&
    regPw.value === regPw2.value &&
    agreeTerms.checked &&
    agreePrivacy.checked;
  regSubmit.disabled = !ok;
}

regEmail.addEventListener('input', () => {
  updateEmailHint();
  updateSubmit();
});
[regUsername, regPw, regPw2].forEach((n) =>
  n.addEventListener('input', () => {
    updatePwHint();
    updateSubmit();
  })
);

// 약관 동의: 전체 동의 ↔ 개별 항목 연동
agreeAll.addEventListener('change', () => {
  agreeTerms.checked = agreePrivacy.checked = agreeAll.checked;
  updateSubmit();
});
[agreeTerms, agreePrivacy].forEach((c) =>
  c.addEventListener('change', () => {
    agreeAll.checked = agreeTerms.checked && agreePrivacy.checked;
    updateSubmit();
  })
);

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (regSubmit.disabled) return;
  clearMessage();
  regSubmit.disabled = true;
  try {
    const { res, data } = await postJson('/auth/register', {
      username: regUsername.value.trim(),
      email: emailValue(),
      password: regPw.value,
      passwordConfirm: regPw2.value,
      agreeTerms: agreeTerms.checked,
      agreePrivacy: agreePrivacy.checked,
    });
    if (!res.ok) {
      authMessage.textContent = data.error || '회원가입에 실패했습니다.';
      if (res.status === 409) setHint(emailHint, '', null);
      updateSubmit();
      return;
    }
    registerForm.reset();
    setHint(emailHint, '', null);
    setHint(pwHint, '', null);
    updateSubmit();
    tabLogin.click();
    authMessage.classList.add('is-ok');
    authMessage.textContent = '가입이 끝났어요. 이제 로그인해 주세요.';
  } catch (err) {
    authMessage.textContent = '서버에 연결할 수 없습니다.';
    updateSubmit();
  }
});
