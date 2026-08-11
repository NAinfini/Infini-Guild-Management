CREATE TRIGGER app_migrations_immutable_update
BEFORE UPDATE ON app_migrations
BEGIN
  SELECT RAISE(ABORT, 'application migration ledger is append-only');
END;

CREATE TRIGGER app_migrations_immutable_delete
BEFORE DELETE ON app_migrations
BEGIN
  SELECT RAISE(ABORT, 'application migration ledger is append-only');
END;
