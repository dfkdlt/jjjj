const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { ready } = require('../services/ensureTables');
require('dotenv').config();

const router = express.Router();

// ───────── 회원가입: 아이디 + 이메일(중복 불가) + 비밀번호 확인 + 약관 동의 ─────────
const TERMS_VERSION = '2026-11-13'; // terms.html 내용을 바꾸면 같이 바꾼다

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase();
}
function validEmail(e) {
  return e.length <= 254 && EMAIL_RE.test(e);
}
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return '비밀번호는 8자 이상이어야 해요.';
  if (pw.length > 72) return '비밀번호는 72자 이하로 입력해 주세요.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '비밀번호에 영문과 숫자를 모두 넣어 주세요.';
  return null;
}

router.post('/register', async (req, res) => {
  const body = req.body || {};
  const username = String(body.username || '').trim();
  const { password, passwordConfirm } = body;
  const email = normalizeEmail(body.email);

  if (!username || !password) return res.status(400).json({ error: '아이디와 비밀번호를 입력하세요.' });
  if (username.length < 3 || username.length > 30) return res.status(400).json({ error: '아이디는 3~30자로 입력해 주세요.' });
  if (!validEmail(email)) return res.status(400).json({ error: '이메일 주소 형식이 올바르지 않아요.' });
  const pwProblem = passwordProblem(password);
  if (pwProblem) return res.status(400).json({ error: pwProblem });
  if (password !== passwordConfirm) return res.status(400).json({ error: '비밀번호 확인이 일치하지 않아요.' });
  if (body.agreeTerms !== true || body.agreePrivacy !== true) {
    return res.status(400).json({ error: '이용약관과 개인정보 수집·이용에 동의해 주세요.' });
  }

  try {
    await ready;
    const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) return res.status(409).json({ error: '이미 존재하는 아이디입니다.' });
    const [emailUsed] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (emailUsed.length > 0) return res.status(409).json({ error: '이미 가입된 이메일이에요.' });

    const passwordHash = await bcrypt.hash(password, 10);
    try {
      // email_verified는 0 그대로 둔다 (메일 인증은 하지 않고, 중복만 막는다)
      await pool.query(
        'INSERT INTO users (username, password_hash, email, terms_agreed_at, terms_version) VALUES (?, ?, ?, NOW(), ?)',
        [username, passwordHash, email, TERMS_VERSION]
      );
    } catch (e) {
      if (e && e.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: /email/i.test(e.message) ? '이미 가입된 이메일이에요.' : '이미 존재하는 아이디입니다.' });
      }
      throw e;
    }

    res.status(201).json({ message: '회원가입이 완료되었습니다.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력하세요.' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.json({ token, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
