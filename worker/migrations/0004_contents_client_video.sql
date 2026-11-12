-- Add a per-content Client Video flag for the Content table.
-- Run once against the production contentmanagement D1 database.
ALTER TABLE contents ADD COLUMN client_video INTEGER NOT NULL DEFAULT 0;
