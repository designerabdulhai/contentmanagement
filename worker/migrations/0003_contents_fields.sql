-- Add fields used by the live React Content page to existing D1 contents rows.
-- Run this migration once against the production contentmanagement D1 database.
-- Do not run duplicate ALTER statements after they have been applied.

ALTER TABLE contents ADD COLUMN channel TEXT;
ALTER TABLE contents ADD COLUMN emergency INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contents ADD COLUMN document_link TEXT;
ALTER TABLE contents ADD COLUMN file_path TEXT;
