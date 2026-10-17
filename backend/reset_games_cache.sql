-- 게임/리뷰/키워드 캐시만 전부 삭제 (users 테이블은 그대로 유지)
-- 다음 검색부터는 캐시가 없으니 Steam/SteamSpy에서 새로 가져오고,
-- 번역 컬럼(translated_text)도 포함해서 새로 저장됩니다.

USE steam_review_app;

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE game_reviews;
TRUNCATE TABLE game_keywords;
TRUNCATE TABLE games;
SET FOREIGN_KEY_CHECKS = 1;
