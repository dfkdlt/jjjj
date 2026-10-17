-- AI 키워드 매핑 캐시 테이블 추가 (이미 DB를 만든 경우 한 번만 실행)
USE steam_review_app;

CREATE TABLE IF NOT EXISTS keyword_ai_cache (
  keyword VARCHAR(100) PRIMARY KEY,
  tags VARCHAR(500) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
