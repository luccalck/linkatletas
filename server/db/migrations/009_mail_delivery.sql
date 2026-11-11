ALTER TABLE mail_outbox
 ADD COLUMN purpose TEXT NOT NULL DEFAULT 'legacy',
 ADD COLUMN reset_token_hash TEXT REFERENCES password_resets(token_hash) ON DELETE CASCADE,
 ADD COLUMN expires_at TIMESTAMPTZ,
 ADD COLUMN discarded_at TIMESTAMPTZ,
 ADD COLUMN discard_reason TEXT,
 ADD CONSTRAINT mail_outbox_purpose CHECK(purpose IN ('legacy','notification','password_reset')),
 ADD CONSTRAINT mail_outbox_reset_reference CHECK(
  (purpose='password_reset' AND reset_token_hash IS NOT NULL AND expires_at IS NOT NULL)
  OR (purpose IN ('legacy','notification') AND reset_token_hash IS NULL AND expires_at IS NULL)
 ),
 ADD CONSTRAINT mail_outbox_discard_state CHECK(
  (discarded_at IS NULL AND discard_reason IS NULL)
  OR (discarded_at IS NOT NULL AND sent_at IS NULL AND encrypted_body='' AND discard_reason IS NOT NULL AND discard_reason IN ('legacy','expired','used','inactive_account','invalid_reference'))
 );

CREATE INDEX mail_outbox_reset_reference ON mail_outbox(reset_token_hash);
DROP INDEX mail_outbox_pending_delivery;
CREATE INDEX mail_outbox_pending_delivery ON mail_outbox(next_attempt_at,created_at) WHERE sent_at IS NULL AND discarded_at IS NULL AND attempts<5;
