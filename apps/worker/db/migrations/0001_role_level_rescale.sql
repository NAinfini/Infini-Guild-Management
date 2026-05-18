-- Rescale builtin role levels from 1/2/3 to 100/500/999
-- to allow custom roles to slot between tiers.

UPDATE roles SET level = 999, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 'admin' AND level = 3;
UPDATE roles SET level = 500, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 'moderator' AND level = 2;
UPDATE roles SET level = 100, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 'member' AND level = 1;
