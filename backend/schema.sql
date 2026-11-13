-- ===================================================
-- Steam 게임 리뷰 검색 서비스 - DB 스키마 (MySQL)
-- ===================================================

CREATE DATABASE IF NOT EXISTS steam_review_app
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE steam_review_app;

-- 회원 정보
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(254) NULL UNIQUE,
  email_verified TINYINT(1) NOT NULL DEFAULT 0, -- 메일 인증은 하지 않아 항상 0
  terms_agreed_at TIMESTAMP NULL,
  terms_version VARCHAR(20) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 게임 정보 (Steam + SteamSpy에서 수집한 캐시 데이터)
CREATE TABLE IF NOT EXISTS games (
  id INT AUTO_INCREMENT PRIMARY KEY,
  appid INT UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  total_positive INT DEFAULT 0,
  total_negative INT DEFAULT 0,
  score DECIMAL(3,1) DEFAULT 0.0,        -- 0.0 ~ 10.0 점
  supports_korean TINYINT(1) DEFAULT 0,  -- 한글 지원 여부
  header_image VARCHAR(500),             -- 썸네일 이미지 URL
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 게임별 "가장 유익한" 리뷰 상위 N개 캐시
CREATE TABLE IF NOT EXISTS game_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  game_id INT NOT NULL,
  review_text TEXT,
  translated_text TEXT NULL,     -- 한국어 번역본 (원문이 한국어가 아닐 때만 채워짐)
  voted_up TINYINT(1),          -- 1: 추천, 0: 비추천
  votes_up INT DEFAULT 0,       -- "유용해요" 투표 수
  language VARCHAR(50),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE INDEX idx_game_reviews_game_id ON game_reviews(game_id);

-- 게임 - 키워드(태그/장르) 매핑 (다대다)
CREATE TABLE IF NOT EXISTS game_keywords (
  id INT AUTO_INCREMENT PRIMARY KEY,
  game_id INT NOT NULL,
  keyword VARCHAR(100) NOT NULL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_game_keyword (game_id, keyword)
);

CREATE INDEX idx_game_keywords_keyword ON game_keywords(keyword);
CREATE INDEX idx_games_score ON games(score DESC);

-- AI가 변환한 키워드 -> Steam 태그 매핑 캐시 (같은 키워드는 AI를 다시 호출하지 않음)
CREATE TABLE IF NOT EXISTS keyword_ai_cache (
  keyword VARCHAR(100) PRIMARY KEY,
  tags VARCHAR(500) NOT NULL,       -- JSON 배열 문자열 예: ["Horror"]
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AI가 만든 리뷰 요약 캐시 (같은 게임은 AI를 다시 호출하지 않음)
CREATE TABLE IF NOT EXISTS game_summaries (
  appid INT PRIMARY KEY,            -- games.appid 기준 (games 캐시를 비워도 요약은 안전하게 유지)
  summary TEXT NOT NULL,            -- JSON: {"summary": "...", "pros": [...], "cons": [...]}
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 사용자가 추천(좋아요)한 게임 (서버 시작 시 자동 생성되므로 직접 실행하지 않아도 됩니다)
CREATE TABLE IF NOT EXISTS user_likes (
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
);

-- 비추천: 사용자가 쓴 이유와 AI 분석 결과 (서버 시작 시 자동 생성)
CREATE TABLE IF NOT EXISTS user_dislikes (
  user_id INT NOT NULL,
  appid INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  header_image VARCHAR(500),
  score DECIMAL(3,1) DEFAULT 0.0,
  reason_text VARCHAR(500) NOT NULL,
  category VARCHAR(20) NOT NULL,          -- tag_mismatch | personal
  mismatch_tags VARCHAR(300) NOT NULL,    -- JSON 배열
  ai_reason VARCHAR(300),
  searched_tags VARCHAR(300),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, appid),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- "이 게임은 이 태그가 아니다" 의견 (사용자 1명당 게임+태그 1표)
CREATE TABLE IF NOT EXISTS tag_reports (
  user_id INT NOT NULL,
  appid INT NOT NULL,
  tag VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, appid, tag),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 게임별 Steam 상점 태그 캐시 (취향 분석용, 서버 시작 시 자동 생성)
CREATE TABLE IF NOT EXISTS game_tags (
  appid INT NOT NULL,
  tag VARCHAR(100) NOT NULL,
  rank_no INT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (appid, tag)
);

-- 검색 기록 (사용자별로 같은 검색어는 한 줄, 서버 시작 시 자동 생성)
CREATE TABLE IF NOT EXISTS search_history (
  user_id INT NOT NULL,
  kw_hash CHAR(40) NOT NULL,
  keyword VARCHAR(200) NOT NULL,
  search_count INT NOT NULL DEFAULT 1,
  last_searched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, kw_hash),
  KEY idx_history_user_last (user_id, last_searched_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 게임별 가격/할인 캐시 (할인 알림용, 서버 시작 시 자동 생성)
CREATE TABLE IF NOT EXISTS game_prices (
  appid INT NOT NULL PRIMARY KEY,
  discount_percent INT NOT NULL DEFAULT 0,
  initial_formatted VARCHAR(50),
  final_formatted VARCHAR(50),
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 친구 (requester가 addressee에게 보낸 요청. status: pending | accepted, 서버 시작 시 자동 생성)
CREATE TABLE IF NOT EXISTS friendships (
  requester_id INT NOT NULL,
  addressee_id INT NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (requester_id, addressee_id),
  KEY idx_friend_addressee (addressee_id, status),
  FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 사용자 설정 (likes_private=1이면 친구에게도 내 추천 목록을 숨김)
CREATE TABLE IF NOT EXISTS user_settings (
  user_id INT NOT NULL PRIMARY KEY,
  likes_private TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 게임 상세 화면용 Steam 소개 정보 캐시 (서버 시작 시 자동 생성)
CREATE TABLE IF NOT EXISTS game_details (
  appid INT NOT NULL PRIMARY KEY,
  payload MEDIUMTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

