-- Re-evaluate current briefs when editorial policy changes without replaying delivered events.
ALTER TABLE clusters ADD COLUMN editorial_policy_version TEXT;
