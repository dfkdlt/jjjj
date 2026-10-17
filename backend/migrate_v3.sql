USE steam_review_app;

ALTER TABLE game_reviews
  ADD COLUMN translated_text TEXT NULL;
