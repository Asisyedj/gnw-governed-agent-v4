-- Align interlock persistence with the application governance schema.
ALTER TABLE interlocks ADD COLUMN IF NOT EXISTS reason TEXT;