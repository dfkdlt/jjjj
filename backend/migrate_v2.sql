-- 기존에 schema.sql로 이미 DB를 만든 경우, 이 파일을 실행해서
-- 한글지원/썸네일/유익한 리뷰 기능에 필요한 컬럼과 테이블을 추가합니다.

USE steam_review_app;

ALTER TABLE games
  ADD COLUMN supports_korean TINYINT(1) DEFAULT 0,
  ADD COLUMN header_image VARCHAR(500);

CREATE TABLE IF NOT EXISTS game_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  game_id INT NOT NULL,
  review_text TEXT,
  voted_up TINYINT(1),          -- 1: 추천, 0: 비추천
  votes_up INT DEFAULT 0,       -- "이 리뷰가 유용해요" 투표 수
  language VARCHAR(50),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE INDEX idx_game_reviews_game_id ON game_reviews(game_id);
