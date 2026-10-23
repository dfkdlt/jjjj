const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/games');
const likeRoutes = require('./routes/likes');
const dislikeRoutes = require('./routes/dislikes');
const homeRoutes = require('./routes/home');
const historyRoutes = require('./routes/history');
const friendRoutes = require('./routes/friends');

const app = express();

// 개발 환경에서는 localhost/127.0.0.1을 혼용해서 열어도 막히지 않도록
// .env에 지정된 주소 + localhost/127.0.0.1 계열을 함께 허용합니다.
const allowedOrigins = [
  process.env.FRONTEND_ORIGIN,
  'http://localhost:5500',
  'http://127.0.0.1:5500',
].filter(Boolean);

// Netlify는 미리보기 주소(https://xxxx--내사이트.netlify.app)로도 같은 사이트를 보여 준다.
// FRONTEND_ORIGIN이 Netlify 주소면 그 사이트의 미리보기 주소도 허용한다.
let previewOrigin = null;
try {
  const host = new URL(process.env.FRONTEND_ORIGIN || '').hostname;
  const m = host.match(/^([a-z0-9-]+)\.netlify\.app$/);
  if (m) previewOrigin = new RegExp(`^https://[a-z0-9-]+--${m[1]}\\.netlify\\.app$`);
} catch (e) {}

app.use(
  cors({
    origin: (origin, callback) => {
      // origin이 없는 요청(Postman, 서버 간 호출 등)은 허용
      if (!origin || allowedOrigins.includes(origin) || (previewOrigin && previewOrigin.test(origin))) {
        callback(null, true);
      } else {
        callback(new Error('CORS 정책에 의해 차단되었습니다: ' + origin));
      }
    },
  })
);
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/games', gameRoutes);
app.use('/api/likes', likeRoutes);
app.use('/api/dislikes', dislikeRoutes);
app.use('/api/home', homeRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/friends', friendRoutes);

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Steam Review App API 서버가 실행 중입니다.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
