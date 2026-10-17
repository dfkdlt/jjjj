-- AI 리뷰 요약 저장 테이블 추가 (이미 DB를 만든 경우 한 번만 실행)
USE steam_review_app;

CREATE TABLE IF NOT EXISTS game_summaries (
  appid INT PRIMARY KEY,            -- games.appid 기준 (games 캐시를 비워도 요약은 안전하게 유지)
  summary TEXT NOT NULL,            -- JSON: {"summary": "...", "pros": [...], "cons": [...]}
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
