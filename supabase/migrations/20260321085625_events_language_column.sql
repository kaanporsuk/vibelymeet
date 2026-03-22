ALTER TABLE events ADD COLUMN IF NOT EXISTS language text DEFAULT NULL;
COMMENT ON COLUMN events.language IS
  'Optional ISO 639-1 language code (e.g. en, tr, es, fr, de). NULL means no language preference / multilingual.';
