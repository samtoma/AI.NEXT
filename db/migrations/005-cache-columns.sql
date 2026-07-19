-- Cache observability: cannot manage the EGP 40 ceiling without seeing cache efficacy
ALTER TABLE ai_interactions ADD COLUMN IF NOT EXISTS cache_read_tokens INT;
ALTER TABLE ai_interactions ADD COLUMN IF NOT EXISTS cache_creation_tokens INT;
