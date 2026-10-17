const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const authMessage = document.getElementById('authMessage');

tabLogin.addEventListener('click', () => {
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  loginForm.hidden = false;
  registerForm.hidden = true;
  authMessage.textContent = '';
  authMessage.classList.remove('is-ok');
});

tabRegister.addEventListener('click', () => {
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  registerForm.hidden = false;
  loginForm.hidden = true;
  authMessage.textContent = '';
  authMessage.classList.remove('is-ok');
});

// 이미 로그인되어 있으면 바로 메인 페이지로 이동
if (localStorage.getItem('token')) {
  window.location.href = 'index.html';
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

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

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('registerUsername').value;
  const password = document.getElementById('registerPassword').value;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      authMessage.textContent = data.error || '회원가입에 실패했습니다.';
      return;
    }

    tabLogin.click();
    authMessage.classList.add('is-ok');
    authMessage.textContent = '가입이 끝났어요. 이제 로그인해 주세요.';
  } catch (err) {
    authMessage.textContent = '서버에 연결할 수 없습니다.';
  }
});
