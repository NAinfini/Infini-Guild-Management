CREATE TRIGGER storage_items_initialize_balance
AFTER INSERT ON storage_items
BEGIN
  INSERT INTO storage_balances (item_id, quantity, updated_at)
  VALUES (NEW.id, 0, NEW.created_at);
END;

CREATE TRIGGER storage_ledger_validate_insert
BEFORE INSERT ON storage_ledger_entries
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM storage_batches AS batch
    JOIN storage_items AS item ON item.id = NEW.item_id
    WHERE batch.id = NEW.batch_id
      AND batch.actor_id = NEW.actor_id
      AND batch.transaction_type = NEW.type
      AND batch.recipient_user_id IS NEW.recipient_user_id
      AND batch.note IS NEW.note
      AND batch.created_at = NEW.created_at
      AND (
        batch.access_mode = 'stock_admin'
        OR (
          batch.access_mode = 'member_self'
          AND batch.actor_id = batch.recipient_user_id
          AND (
            (NEW.type = 'intake' AND item.allow_member_deposit = 1)
            OR (NEW.type = 'distribute' AND item.allow_member_withdraw = 1)
          )
        )
      )
  ) THEN RAISE(ABORT, 'storage_ledger_authorization_invalid') END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM storage_balances WHERE item_id = NEW.item_id
  ) THEN RAISE(ABORT, 'storage_balance_missing') END;

  SELECT CASE WHEN NEW.quantity_delta = 0
    THEN RAISE(ABORT, 'storage_balance_no_change')
  END;

  SELECT CASE WHEN (
    SELECT quantity + NEW.quantity_delta = quantity
    FROM storage_balances
    WHERE item_id = NEW.item_id
  ) THEN RAISE(ABORT, 'storage_balance_delta_too_small') END;

  SELECT CASE WHEN (
    SELECT quantity + NEW.quantity_delta
    FROM storage_balances
    WHERE item_id = NEW.item_id
  ) < 0 THEN RAISE(ABORT, 'storage_balance_negative') END;

  SELECT CASE WHEN abs((
    SELECT quantity + NEW.quantity_delta
    FROM storage_balances
    WHERE item_id = NEW.item_id
  )) >= 1e308 THEN RAISE(ABORT, 'storage_balance_non_finite') END;
END;

CREATE TRIGGER storage_ledger_apply_balance
AFTER INSERT ON storage_ledger_entries
BEGIN
  UPDATE storage_balances
  SET quantity = quantity + NEW.quantity_delta,
      updated_at = NEW.created_at
  WHERE item_id = NEW.item_id;

  SELECT CASE WHEN changes() <> 1
    THEN RAISE(ABORT, 'storage_balance_update_failed')
  END;
END;

-- A storage item revision covers its mutable metadata, linked images, and
-- ledger-backed quantity.  Keep it strictly monotonic even when two writes
-- share the same request timestamp.
CREATE TRIGGER storage_ledger_advance_item_revision
AFTER INSERT ON storage_ledger_entries
BEGIN
  UPDATE storage_items
  SET updated_at = CASE
    WHEN julianday(updated_at) IS NOT NULL
      AND julianday(updated_at) >= julianday(NEW.created_at)
      THEN strftime('%Y-%m-%dT%H:%M:%fZ', julianday(updated_at) + 0.001 / 86400.0)
    ELSE NEW.created_at
  END
  WHERE id = NEW.item_id;

  SELECT CASE WHEN changes() <> 1
    THEN RAISE(ABORT, 'storage_item_revision_update_failed')
  END;
END;

CREATE TRIGGER storage_ledger_immutable_update
BEFORE UPDATE ON storage_ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'storage_ledger_immutable');
END;

CREATE TRIGGER storage_ledger_immutable_delete
BEFORE DELETE ON storage_ledger_entries
WHEN NOT EXISTS (
  SELECT 1
  FROM system_test_artifacts AS artifacts
  JOIN system_test_runs AS runs ON runs.id = artifacts.run_id
  WHERE runs.status = 'cleaning'
    AND (
      (artifacts.artifact_type = 'storage_batch' AND artifacts.artifact_key = OLD.batch_id)
      OR (artifacts.artifact_type = 'storage_item' AND artifacts.artifact_key = OLD.item_id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'storage_ledger_immutable');
END;
