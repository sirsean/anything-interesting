-- Parent Polymarket event slug for neg-risk / multi-outcome markets (website URLs use event slug).

ALTER TABLE markets ADD COLUMN event_slug TEXT;
ALTER TABLE markets ADD COLUMN event_title TEXT;
ALTER TABLE markets ADD COLUMN group_item_title TEXT;
