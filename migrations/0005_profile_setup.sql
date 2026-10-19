ALTER TABLE profiles ADD COLUMN setup_completed_at TEXT;

-- Existing members keep their chosen profile and timezone without another setup step.
UPDATE profiles SET setup_completed_at = updated_at;
