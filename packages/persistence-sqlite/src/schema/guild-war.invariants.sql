CREATE TRIGGER guild_wars_no_reopen
BEFORE UPDATE OF status ON guild_wars
WHEN OLD.status = 'concluded' AND NEW.status <> 'concluded'
BEGIN
  SELECT RAISE(ABORT, 'concluded guild war cannot be reopened');
END;

CREATE TRIGGER war_team_active_insert
BEFORE INSERT ON war_teams
WHEN NOT EXISTS (SELECT 1 FROM guild_wars WHERE id = NEW.war_id AND status = 'active')
BEGIN
  SELECT RAISE(ABORT, 'concluded guild war roster is immutable');
END;

CREATE TRIGGER war_team_active_update
BEFORE UPDATE ON war_teams
WHEN OLD.war_id IS NOT NEW.war_id
  OR NOT EXISTS (SELECT 1 FROM guild_wars WHERE id = NEW.war_id AND status = 'active')
BEGIN
  SELECT RAISE(ABORT, 'concluded guild war roster is immutable');
END;

CREATE TRIGGER war_team_active_delete
BEFORE DELETE ON war_teams
WHEN EXISTS (SELECT 1 FROM guild_wars WHERE id = OLD.war_id AND status = 'concluded')
  AND EXISTS (SELECT 1 FROM guild_wars WHERE id = OLD.war_id)
BEGIN
  SELECT RAISE(ABORT, 'concluded guild war roster is immutable');
END;

CREATE TRIGGER war_member_team_scope_insert
BEFORE INSERT ON war_members
WHEN NEW.team_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM war_teams WHERE id = NEW.team_id AND war_id = NEW.war_id)
BEGIN
  SELECT RAISE(ABORT, 'war member team is outside guild war');
END;

CREATE TRIGGER war_member_team_scope_update
BEFORE UPDATE OF war_id, team_id ON war_members
WHEN NEW.team_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM war_teams WHERE id = NEW.team_id AND war_id = NEW.war_id)
BEGIN
  SELECT RAISE(ABORT, 'war member team is outside guild war');
END;

CREATE TRIGGER war_member_active_insert
BEFORE INSERT ON war_members
WHEN NOT EXISTS (SELECT 1 FROM guild_wars WHERE id = NEW.war_id AND status = 'active')
BEGIN
  SELECT RAISE(ABORT, 'concluded guild war roster is immutable');
END;

CREATE TRIGGER war_member_participant_insert
BEFORE INSERT ON war_members
WHEN EXISTS (SELECT 1 FROM guild_wars WHERE id = NEW.war_id AND status = 'active')
  AND NOT EXISTS (
    SELECT 1
    FROM guild_wars
    JOIN event_participants
      ON event_participants.event_id = guild_wars.event_id
     AND event_participants.user_id = NEW.user_id
    WHERE guild_wars.id = NEW.war_id
  )
BEGIN
  SELECT RAISE(ABORT, 'active guild war members must be event participants');
END;

CREATE TRIGGER war_member_participant_update
BEFORE UPDATE OF war_id, user_id ON war_members
WHEN EXISTS (SELECT 1 FROM guild_wars WHERE id = NEW.war_id AND status = 'active')
  AND NOT EXISTS (
    SELECT 1
    FROM guild_wars
    JOIN event_participants
      ON event_participants.event_id = guild_wars.event_id
     AND event_participants.user_id = NEW.user_id
    WHERE guild_wars.id = NEW.war_id
  )
BEGIN
  SELECT RAISE(ABORT, 'active guild war members must be event participants');
END;

CREATE TRIGGER active_war_participant_delete
BEFORE DELETE ON event_participants
WHEN EXISTS (
  SELECT 1
  FROM guild_wars
  JOIN war_members ON war_members.war_id = guild_wars.id
  WHERE guild_wars.status = 'active'
    AND guild_wars.event_id = OLD.event_id
    AND war_members.user_id = OLD.user_id
)
BEGIN
  SELECT RAISE(ABORT, 'active guild war roster member must remain an event participant');
END;

CREATE TRIGGER war_member_active_roster_update
BEFORE UPDATE OF war_id, team_id, user_id, role_tag, sort_order ON war_members
WHEN OLD.war_id IS NOT NEW.war_id
  OR NOT EXISTS (SELECT 1 FROM guild_wars WHERE id = NEW.war_id AND status = 'active')
BEGIN
  SELECT RAISE(ABORT, 'concluded guild war roster is immutable');
END;

CREATE TRIGGER war_member_active_delete
BEFORE DELETE ON war_members
WHEN EXISTS (SELECT 1 FROM guild_wars WHERE id = OLD.war_id AND status = 'concluded')
  AND EXISTS (SELECT 1 FROM guild_wars WHERE id = OLD.war_id)
BEGIN
  SELECT RAISE(ABORT, 'concluded guild war roster is immutable');
END;
