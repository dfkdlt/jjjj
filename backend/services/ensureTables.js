// 추천/비추천 기능에 필요한 테이블을 서버 시작 시 자동으로 만든다 (이미 있으면 아무 일도 없음).
// 그래서 MySQL에서 따로 SQL을 실행하지 않아도 된다. (schema.sql에도 같은 정의가 들어 있음)
const pool = require('../db');

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS user_likes (
    user_id INT NOT NULL,
    appid INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    header_image VARCHAR(500),
    score DECIMAL(3,1) DEFAULT 0.0,
    total_positive INT DEFAULT 0,
    total_negative INT DEFAULT 0,
    supports_korean TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, appid),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  // 비추천: 사용자가 쓴 이유(reason_text)와 AI 분석 결과(category: tag_mismatch | personal)
  `CREATE TABLE IF NOT EXISTS user_dislikes (
    user_id INT NOT NULL,
    appid INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    header_image VARCHAR(500),
    score DECIMAL(3,1) DEFAULT 0.0,
    reason_text VARCHAR(500) NOT NULL,
    category VARCHAR(20) NOT NULL,
    mismatch_tags VARCHAR(300) NOT NULL,
    ai_reason VARCHAR(300),
    searched_tags VARCHAR(300),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, appid),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  // "이 게임은 이 태그가 아니다" 의견 (사용자 1명당 게임+태그 1표). N명 이상이면 모두의 검색에서 제외된다.
  `CREATE TABLE IF NOT EXISTS tag_reports (
    user_id INT NOT NULL,
    appid INT NOT NULL,
    tag VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, appid, tag),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  // 게임별 Steam 상점 태그 캐시 (취향 분석용). rank_no가 작을수록 Steam에서 투표가 많은 태그
  `CREATE TABLE IF NOT EXISTS game_tags (
    appid INT NOT NULL,
    tag VARCHAR(100) NOT NULL,
    rank_no INT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (appid, tag)
  )`,
  // 검색 기록: 사용자별로 같은 검색어는 한 줄로 모으고 횟수를 센다. kw_hash = 소문자로 바꾼 검색어의 sha1
  `CREATE TABLE IF NOT EXISTS search_history (
    user_id INT NOT NULL,
    kw_hash CHAR(40) NOT NULL,
    keyword VARCHAR(200) NOT NULL,
    search_count INT NOT NULL DEFAULT 1,
    last_searched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, kw_hash),
    KEY idx_history_user_last (user_id, last_searched_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  // 게임별 가격/할인 캐시 (할인 알림용). 몇 시간마다 Steam에서 다시 읽는다
  `CREATE TABLE IF NOT EXISTS game_prices (
    appid INT NOT NULL PRIMARY KEY,
    discount_percent INT NOT NULL DEFAULT 0,
    initial_formatted VARCHAR(50),
    final_formatted VARCHAR(50),
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  // 친구: requester가 addressee에게 보낸 요청. status = pending(수락 대기) | accepted(서로 친구)
  `CREATE TABLE IF NOT EXISTS friendships (
    requester_id INT NOT NULL,
    addressee_id INT NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (requester_id, addressee_id),
    KEY idx_friend_addressee (addressee_id, status),
    FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  // 사용자 설정. likes_private=1이면 친구에게도 내 추천 목록을 보여주지 않는다
  `CREATE TABLE IF NOT EXISTS user_settings (
    user_id INT NOT NULL PRIMARY KEY,
    likes_private TINYINT(1) NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
];

const ready = (async () => {
  for (const sql of STATEMENTS) await pool.query(sql);
})().catch((err) => {
  console.error('[추천/비추천] 테이블 생성 실패:', err.message);
});

module.exports = { ready };
