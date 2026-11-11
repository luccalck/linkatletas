# Dicionário do banco implementado

Gerado por `pnpm exec tsx scripts/banco/export-schema.ts` após as migrations, consultando apenas metadados PostgreSQL. Não contém dados pessoais. As 35 tabelas de domínio e as tabelas tecnicas `schema_migrations` e `media_uploads` refletem o banco implementado.

O [DER](../diagramas/der.mmd) resume os atributos, mas inclui todas as relações FK. O modelo de classes é conceitual; cardinalidades do DER refletem restrições físicas, incluindo referências opcionais. Campos `resource_id` polimórficos são autorizados pela aplicação e não são FKs.

## administrative_audit

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| actor_id | uuid | Sim | FK → users |
| subject_id | uuid | Sim | FK → users |
| action | text | Não | — |
| reason | text | Não | — |
| created_at | timestamp with time zone | Não | — |

Restrições:

- `administrative_audit_actor_id_fkey`: `FOREIGN KEY (actor_id) REFERENCES users(id)`.
- `administrative_audit_pkey`: `PRIMARY KEY (id)`.
- `administrative_audit_subject_id_fkey`: `FOREIGN KEY (subject_id) REFERENCES users(id)`.

Índices:

- `administrative_audit_pkey`: `CREATE UNIQUE INDEX administrative_audit_pkey ON public.administrative_audit USING btree (id)`.
- `idx_administrative_audit_actor_id_fkey`: `CREATE INDEX idx_administrative_audit_actor_id_fkey ON public.administrative_audit USING btree (actor_id)`.
- `idx_administrative_audit_subject_id_fkey`: `CREATE INDEX idx_administrative_audit_subject_id_fkey ON public.administrative_audit USING btree (subject_id)`.

## billing_audit

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| actor_id | uuid | Sim | FK → users |
| contract_id | uuid | Sim | FK → contracts |
| action | text | Não | — |
| reason | text | Não | — |
| created_at | timestamp with time zone | Não | — |

Restrições:

- `billing_audit_actor_id_fkey`: `FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL`.
- `billing_audit_contract_id_fkey`: `FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE`.
- `billing_audit_pkey`: `PRIMARY KEY (id)`.

Índices:

- `billing_audit_pkey`: `CREATE UNIQUE INDEX billing_audit_pkey ON public.billing_audit USING btree (id)`.
- `idx_billing_audit_actor_id_fkey`: `CREATE INDEX idx_billing_audit_actor_id_fkey ON public.billing_audit USING btree (actor_id)`.
- `idx_billing_audit_contract_id_fkey`: `CREATE INDEX idx_billing_audit_contract_id_fkey ON public.billing_audit USING btree (contract_id)`.

## billing_events

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | text | Não | PK |
| event | text | Não | — |
| event_at | timestamp with time zone | Não | — |
| payload | jsonb | Não | — |
| received_at | timestamp with time zone | Não | — |
| processed_at | timestamp with time zone | Sim | — |
| attempts | integer | Não | — |
| next_attempt_at | timestamp with time zone | Não | — |
| processing_note | text | Não | — |

Restrições:

- `billing_events_pkey`: `PRIMARY KEY (id)`.

Índices:

- `billing_events_pending_processing`: `CREATE INDEX billing_events_pending_processing ON public.billing_events USING btree (next_attempt_at, received_at) WHERE (processed_at IS NULL)`.
- `billing_events_pkey`: `CREATE UNIQUE INDEX billing_events_pkey ON public.billing_events USING btree (id)`.

## billing_jobs

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| subscription_id | uuid | Não | FK → billing_subscriptions |
| kind | text | Não | — |
| state | text | Não | — |
| attempts | integer | Não | — |
| note | text | Não | — |
| created_at | timestamp with time zone | Não | — |
| updated_at | timestamp with time zone | Não | — |

Restrições:

- `billing_jobs_kind_check`: `CHECK ((kind = ANY (ARRAY['checkout'::text, 'cancellation'::text, 'reconciliation'::text])))`.
- `billing_jobs_pkey`: `PRIMARY KEY (id)`.
- `billing_jobs_state_check`: `CHECK ((state = ANY (ARRAY['running'::text, 'uncertain'::text, 'confirmed'::text, 'failed'::text])))`.
- `billing_jobs_subscription_id_fkey`: `FOREIGN KEY (subscription_id) REFERENCES billing_subscriptions(id) ON DELETE CASCADE`.

Índices:

- `billing_jobs_pkey`: `CREATE UNIQUE INDEX billing_jobs_pkey ON public.billing_jobs USING btree (id)`.
- `idx_billing_jobs_subscription_id_fkey`: `CREATE INDEX idx_billing_jobs_subscription_id_fkey ON public.billing_jobs USING btree (subscription_id)`.

## billing_payments

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| subscription_id | uuid | Não | FK → billing_subscriptions |
| provider_payment_id | text | Não | UNIQUE |
| amount_cents | integer | Não | — |
| net_cents | integer | Não | — |
| status | text | Não | — |
| paid_at | timestamp with time zone | Sim | — |
| due_date | date | Sim | — |
| event_at | timestamp with time zone | Não | — |
| coach_share_cents | integer | Não | — |
| platform_share_cents | integer | Não | — |

Restrições:

- `billing_payments_nonnegative`: `CHECK (((amount_cents >= 0) AND (net_cents >= 0) AND (coach_share_cents >= 0) AND (platform_share_cents >= 0)))`.
- `billing_payments_pkey`: `PRIMARY KEY (id)`.
- `billing_payments_provider_payment_id_key`: `UNIQUE (provider_payment_id)`.
- `billing_payments_subscription_id_fkey`: `FOREIGN KEY (subscription_id) REFERENCES billing_subscriptions(id) ON DELETE CASCADE`.

Índices:

- `billing_payments_pkey`: `CREATE UNIQUE INDEX billing_payments_pkey ON public.billing_payments USING btree (id)`.
- `billing_payments_provider_payment_id_key`: `CREATE UNIQUE INDEX billing_payments_provider_payment_id_key ON public.billing_payments USING btree (provider_payment_id)`.
- `idx_billing_payments_subscription_id_fkey`: `CREATE INDEX idx_billing_payments_subscription_id_fkey ON public.billing_payments USING btree (subscription_id)`.

## billing_plans

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| coach_id | uuid | Não | FK → users; PK |
| name | text | Não | — |
| amount_cents | integer | Não | — |
| active | boolean | Não | — |

Restrições:

- `billing_plans_amount_cents_check`: `CHECK (((amount_cents >= 100) AND (amount_cents <= 10000000)))`.
- `billing_plans_coach_id_fkey`: `FOREIGN KEY (coach_id) REFERENCES users(id) ON DELETE CASCADE`.
- `billing_plans_pkey`: `PRIMARY KEY (coach_id)`.

Índices:

- `billing_plans_pkey`: `CREATE UNIQUE INDEX billing_plans_pkey ON public.billing_plans USING btree (coach_id)`.

## billing_settings

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | integer | Não | PK |
| commission_bps | integer | Não | — |
| grace_days | integer | Não | — |

Restrições:

- `billing_settings_commission_bps_check`: `CHECK (((commission_bps >= 0) AND (commission_bps <= 5000)))`.
- `billing_settings_grace_days_check`: `CHECK (((grace_days >= 0) AND (grace_days <= 30)))`.
- `billing_settings_id_check`: `CHECK ((id = 1))`.
- `billing_settings_pkey`: `PRIMARY KEY (id)`.

Índices:

- `billing_settings_pkey`: `CREATE UNIQUE INDEX billing_settings_pkey ON public.billing_settings USING btree (id)`.

## billing_splits

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| provider_split_id | text | Não | PK |
| payment_id | uuid | Não | FK → billing_payments |
| wallet_id | text | Não | — |
| amount_cents | integer | Não | — |
| status | text | Não | — |
| event_at | timestamp with time zone | Não | — |

Restrições:

- `billing_splits_nonnegative`: `CHECK ((amount_cents >= 0))`.
- `billing_splits_payment_id_fkey`: `FOREIGN KEY (payment_id) REFERENCES billing_payments(id) ON DELETE CASCADE`.
- `billing_splits_pkey`: `PRIMARY KEY (provider_split_id)`.

Índices:

- `billing_splits_pkey`: `CREATE UNIQUE INDEX billing_splits_pkey ON public.billing_splits USING btree (provider_split_id)`.
- `idx_billing_splits_payment_id_fkey`: `CREATE INDEX idx_billing_splits_payment_id_fkey ON public.billing_splits USING btree (payment_id)`.

## billing_subscriptions

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| contract_id | uuid | Não | FK → contracts; UNIQUE |
| plan_name | text | Não | — |
| amount_cents | integer | Não | — |
| commission_bps | integer | Não | — |
| environment | text | Não | — |
| state | text | Não | — |
| provider_checkout_id | text | Sim | UNIQUE |
| provider_subscription_id | text | Sim | UNIQUE |
| provider_customer_id | text | Sim | — |
| checkout_url | text | Sim | — |
| paid_until | timestamp with time zone | Sim | — |
| grace_until | timestamp with time zone | Sim | — |
| cancellation_confirmed | boolean | Não | — |
| cancellation_reason | text | Não | — |
| cancellation_started_at | timestamp with time zone | Sim | — |
| last_event_at | timestamp with time zone | Sim | — |
| created_at | timestamp with time zone | Não | — |

Restrições:

- `billing_subscriptions_amount_cents_check`: `CHECK ((amount_cents > 0))`.
- `billing_subscriptions_commission_bounds`: `CHECK (((commission_bps >= 0) AND (commission_bps <= 5000)))`.
- `billing_subscriptions_contract_id_fkey`: `FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE`.
- `billing_subscriptions_contract_id_key`: `UNIQUE (contract_id)`.
- `billing_subscriptions_environment_check`: `CHECK ((environment = ANY (ARRAY['sandbox'::text, 'production'::text])))`.
- `billing_subscriptions_pkey`: `PRIMARY KEY (id)`.
- `billing_subscriptions_provider_checkout_id_key`: `UNIQUE (provider_checkout_id)`.
- `billing_subscriptions_provider_subscription_id_key`: `UNIQUE (provider_subscription_id)`.
- `billing_subscriptions_state_check`: `CHECK ((state = ANY (ARRAY['awaiting_payment'::text, 'regular'::text, 'grace'::text, 'suspended'::text, 'cancellation_requested'::text, 'ended'::text, 'uncertain'::text])))`.

Índices:

- `billing_subscriptions_contract_id_key`: `CREATE UNIQUE INDEX billing_subscriptions_contract_id_key ON public.billing_subscriptions USING btree (contract_id)`.
- `billing_subscriptions_pkey`: `CREATE UNIQUE INDEX billing_subscriptions_pkey ON public.billing_subscriptions USING btree (id)`.
- `billing_subscriptions_provider_checkout_id_key`: `CREATE UNIQUE INDEX billing_subscriptions_provider_checkout_id_key ON public.billing_subscriptions USING btree (provider_checkout_id)`.
- `billing_subscriptions_provider_subscription_id_key`: `CREATE UNIQUE INDEX billing_subscriptions_provider_subscription_id_key ON public.billing_subscriptions USING btree (provider_subscription_id)`.

## billing_wallets

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| coach_id | uuid | Não | FK → users; PK |
| wallet_id | text | Não | UNIQUE |
| updated_at | timestamp with time zone | Não | — |

Restrições:

- `billing_wallets_coach_id_fkey`: `FOREIGN KEY (coach_id) REFERENCES users(id) ON DELETE CASCADE`.
- `billing_wallets_pkey`: `PRIMARY KEY (coach_id)`.
- `billing_wallets_wallet_id_key`: `UNIQUE (wallet_id)`.

Índices:

- `billing_wallets_pkey`: `CREATE UNIQUE INDEX billing_wallets_pkey ON public.billing_wallets USING btree (coach_id)`.
- `billing_wallets_wallet_id_key`: `CREATE UNIQUE INDEX billing_wallets_wallet_id_key ON public.billing_wallets USING btree (wallet_id)`.

## consent_history

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| user_id | uuid | Sim | FK → users |
| purpose | text | Não | — |
| granted | boolean | Não | — |
| version | text | Não | — |
| created_at | timestamp with time zone | Não | — |

Restrições:

- `consent_history_pkey`: `PRIMARY KEY (id)`.
- `consent_history_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`.

Índices:

- `consent_history_pkey`: `CREATE UNIQUE INDEX consent_history_pkey ON public.consent_history USING btree (id)`.
- `idx_consent_history_user_id_fkey`: `CREATE INDEX idx_consent_history_user_id_fkey ON public.consent_history USING btree (user_id)`.

## consents

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| user_id | uuid | Não | PK; FK → users |
| purpose | text | Não | PK |
| granted | boolean | Não | — |
| version | text | Não | — |
| updated_at | timestamp with time zone | Não | — |

Restrições:

- `consents_pkey`: `PRIMARY KEY (user_id, purpose)`.
- `consents_purpose_check`: `CHECK ((purpose = ANY (ARRAY['performance'::text, 'health'::text, 'communications'::text])))`.
- `consents_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`.

Índices:

- `consents_pkey`: `CREATE UNIQUE INDEX consents_pkey ON public.consents USING btree (user_id, purpose)`.

## consultation_history

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| consultation_id | uuid | Não | FK → consultations |
| actor_id | uuid | Não | FK → users |
| action | text | Não | — |
| previous_starts_at | timestamp with time zone | Sim | — |
| new_starts_at | timestamp with time zone | Sim | — |
| reason | text | Não | — |
| created_at | timestamp with time zone | Não | — |

Restrições:

- `consultation_history_actor_id_fkey`: `FOREIGN KEY (actor_id) REFERENCES users(id)`.
- `consultation_history_consultation_id_fkey`: `FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE CASCADE`.
- `consultation_history_pkey`: `PRIMARY KEY (id)`.

Índices:

- `consultation_history_pkey`: `CREATE UNIQUE INDEX consultation_history_pkey ON public.consultation_history USING btree (id)`.
- `idx_consultation_history_actor_id_fkey`: `CREATE INDEX idx_consultation_history_actor_id_fkey ON public.consultation_history USING btree (actor_id)`.
- `idx_consultation_history_consultation_id_fkey`: `CREATE INDEX idx_consultation_history_consultation_id_fkey ON public.consultation_history USING btree (consultation_id)`.

## consultations

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| contract_id | uuid | Não | FK → contracts |
| title | text | Não | — |
| description_ciphertext | text | Não | — |
| starts_at | timestamp with time zone | Não | — |
| duration_minutes | integer | Não | — |
| status | text | Não | — |
| meeting_url | text | Sim | — |
| external_event_id | text | Sim | — |
| created_at | timestamp with time zone | Não | — |
| updated_at | timestamp with time zone | Não | — |

Restrições:

- `consultations_contract_id_fkey`: `FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE`.
- `consultations_duration_minutes_check`: `CHECK (((duration_minutes >= 15) AND (duration_minutes <= 180)))`.
- `consultations_pkey`: `PRIMARY KEY (id)`.
- `consultations_status_check`: `CHECK ((status = ANY (ARRAY['scheduled'::text, 'cancelled'::text, 'completed'::text])))`.
- `consultations_title_check`: `CHECK (((char_length(title) >= 3) AND (char_length(title) <= 120)))`.

Índices:

- `consultations_calendar`: `CREATE INDEX consultations_calendar ON public.consultations USING btree (starts_at) WHERE (status = 'scheduled'::text)`.
- `consultations_pkey`: `CREATE UNIQUE INDEX consultations_pkey ON public.consultations USING btree (id)`.
- `idx_consultations_contract_id_fkey`: `CREATE INDEX idx_consultations_contract_id_fkey ON public.consultations USING btree (contract_id)`.

## contracts

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | UNIQUE; PK |
| athlete_id | uuid | Não | FK → users; UNIQUE |
| coach_id | uuid | Não | FK → users; UNIQUE |
| status | text | Não | — |
| created_at | timestamp with time zone | Não | — |
| decided_at | timestamp with time zone | Sim | — |
| ended_at | timestamp with time zone | Sim | — |
| cancellation_reason | text | Não | — |
| athlete_role | text | Não | FK → users |
| coach_role | text | Não | FK → users |

Restrições:

- `contracts_athlete_role_fkey`: `FOREIGN KEY (athlete_id, athlete_role) REFERENCES users(id, role) ON DELETE CASCADE`.
- `contracts_check`: `CHECK ((athlete_id <> coach_id))`.
- `contracts_coach_role_fkey`: `FOREIGN KEY (coach_id, coach_role) REFERENCES users(id, role) ON DELETE CASCADE`.
- `contracts_members_unique`: `UNIQUE (id, athlete_id, coach_id)`.
- `contracts_pkey`: `PRIMARY KEY (id)`.
- `contracts_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text, 'cancelled'::text, 'suspended'::text])))`.

Índices:

- `contracts_coach`: `CREATE INDEX contracts_coach ON public.contracts USING btree (coach_id, status)`.
- `contracts_members_unique`: `CREATE UNIQUE INDEX contracts_members_unique ON public.contracts USING btree (id, athlete_id, coach_id)`.
- `contracts_pkey`: `CREATE UNIQUE INDEX contracts_pkey ON public.contracts USING btree (id)`.
- `idx_contracts_athlete_id_fkey`: `CREATE INDEX idx_contracts_athlete_id_fkey ON public.contracts USING btree (athlete_id)`.
- `one_current_contract`: `CREATE UNIQUE INDEX one_current_contract ON public.contracts USING btree (athlete_id, coach_id) WHERE (status = ANY (ARRAY['pending'::text, 'active'::text, 'suspended'::text]))`.

## executions

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| workout_id | uuid | Não | FK → workouts; UNIQUE |
| completed_blocks | _int4 | Não | — |
| effort | integer | Não | — |
| notes | text | Não | — |
| metrics | jsonb | Não | — |
| updated_at | timestamp with time zone | Não | — |
| private_payload | text | Sim | — |

Restrições:

- `executions_effort_check`: `CHECK (((effort >= 1) AND (effort <= 10)))`.
- `executions_pkey`: `PRIMARY KEY (id)`.
- `executions_workout_id_fkey`: `FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE`.
- `executions_workout_id_key`: `UNIQUE (workout_id)`.

Índices:

- `executions_pkey`: `CREATE UNIQUE INDEX executions_pkey ON public.executions USING btree (id)`.
- `executions_workout_id_key`: `CREATE UNIQUE INDEX executions_workout_id_key ON public.executions USING btree (workout_id)`.

## exercise_blocks

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| workout_id | uuid | Não | FK → workouts; UNIQUE |
| position | integer | Não | UNIQUE |
| definition | jsonb | Não | — |

Restrições:

- `exercise_blocks_pkey`: `PRIMARY KEY (id)`.
- `exercise_blocks_position_check`: `CHECK (("position" >= 0))`.
- `exercise_blocks_workout_id_fkey`: `FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE`.
- `exercise_blocks_workout_id_position_key`: `UNIQUE (workout_id, "position")`.

Índices:

- `exercise_blocks_pkey`: `CREATE UNIQUE INDEX exercise_blocks_pkey ON public.exercise_blocks USING btree (id)`.
- `exercise_blocks_workout_id_position_key`: `CREATE UNIQUE INDEX exercise_blocks_workout_id_position_key ON public.exercise_blocks USING btree (workout_id, "position")`.

## mail_outbox

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| user_id | uuid | Sim | FK → users |
| recipient | text | Não | — |
| subject | text | Não | — |
| encrypted_body | text | Não | — |
| attempts | integer | Não | — |
| sent_at | timestamp with time zone | Sim | — |
| next_attempt_at | timestamp with time zone | Não | — |
| created_at | timestamp with time zone | Não | — |
| last_error | text | Sim | — |
| purpose | text | Não | — |
| reset_token_hash | text | Sim | FK → password_resets |
| expires_at | timestamp with time zone | Sim | — |
| discarded_at | timestamp with time zone | Sim | — |
| discard_reason | text | Sim | — |

Restrições:

- `mail_outbox_discard_state`: `CHECK ((((discarded_at IS NULL) AND (discard_reason IS NULL)) OR ((discarded_at IS NOT NULL) AND (sent_at IS NULL) AND (encrypted_body = ''::text) AND (discard_reason IS NOT NULL) AND (discard_reason = ANY (ARRAY['legacy'::text, 'expired'::text, 'used'::text, 'inactive_account'::text, 'invalid_reference'::text])))))`.
- `mail_outbox_pkey`: `PRIMARY KEY (id)`.
- `mail_outbox_purpose`: `CHECK ((purpose = ANY (ARRAY['legacy'::text, 'notification'::text, 'password_reset'::text])))`.
- `mail_outbox_reset_reference`: `CHECK ((((purpose = 'password_reset'::text) AND (reset_token_hash IS NOT NULL) AND (expires_at IS NOT NULL)) OR ((purpose = ANY (ARRAY['legacy'::text, 'notification'::text])) AND (reset_token_hash IS NULL) AND (expires_at IS NULL))))`.
- `mail_outbox_reset_token_hash_fkey`: `FOREIGN KEY (reset_token_hash) REFERENCES password_resets(token_hash) ON DELETE CASCADE`.
- `mail_outbox_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`.

Índices:

- `idx_mail_outbox_user_id_fkey`: `CREATE INDEX idx_mail_outbox_user_id_fkey ON public.mail_outbox USING btree (user_id)`.
- `mail_outbox_pending_delivery`: `CREATE INDEX mail_outbox_pending_delivery ON public.mail_outbox USING btree (next_attempt_at, created_at) WHERE ((sent_at IS NULL) AND (discarded_at IS NULL) AND (attempts < 5))`.
- `mail_outbox_pkey`: `CREATE UNIQUE INDEX mail_outbox_pkey ON public.mail_outbox USING btree (id)`.
- `mail_outbox_reset_reference`: `CREATE INDEX mail_outbox_reset_reference ON public.mail_outbox USING btree (reset_token_hash)`.

## media

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| owner_id | uuid | Não | FK → users |
| purpose | text | Não | — |
| resource_id | uuid | Não | — |
| name | text | Não | — |
| mime_type | text | Não | — |
| size | integer | Não | — |
| object_key | text | Não | UNIQUE |
| created_at | timestamp with time zone | Não | — |
| deleted_at | timestamp with time zone | Sim | — |

Restrições:

- `media_object_key_key`: `UNIQUE (object_key)`.
- `media_owner_id_fkey`: `FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE`.
- `media_pkey`: `PRIMARY KEY (id)`.
- `media_purpose_check`: `CHECK ((purpose = ANY (ARRAY['verification'::text, 'instruction'::text, 'performance'::text, 'message'::text])))`.
- `media_size_check`: `CHECK ((size > 0))`.

Índices:

- `idx_media_owner_id_fkey`: `CREATE INDEX idx_media_owner_id_fkey ON public.media USING btree (owner_id)`.
- `media_object_key_key`: `CREATE UNIQUE INDEX media_object_key_key ON public.media USING btree (object_key)`.
- `media_pkey`: `CREATE UNIQUE INDEX media_pkey ON public.media USING btree (id)`.
- `media_resource`: `CREATE INDEX media_resource ON public.media USING btree (resource_id) WHERE (deleted_at IS NULL)`.

## media_feedback

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| media_id | uuid | Não | FK → media |
| author_id | uuid | Não | FK → users |
| encrypted_text | text | Não | — |
| created_at | timestamp with time zone | Não | — |

Restrições:

- `media_feedback_author_id_fkey`: `FOREIGN KEY (author_id) REFERENCES users(id)`.
- `media_feedback_media_id_fkey`: `FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE`.
- `media_feedback_pkey`: `PRIMARY KEY (id)`.

Índices:

- `idx_media_feedback_author_id_fkey`: `CREATE INDEX idx_media_feedback_author_id_fkey ON public.media_feedback USING btree (author_id)`.
- `idx_media_feedback_media_id_fkey`: `CREATE INDEX idx_media_feedback_media_id_fkey ON public.media_feedback USING btree (media_id)`.
- `media_feedback_pkey`: `CREATE UNIQUE INDEX media_feedback_pkey ON public.media_feedback USING btree (id)`.

## media_uploads

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| owner_id | uuid | Não | FK → users |
| purpose | text | Não | — |
| resource_id | uuid | Não | — |
| name | text | Não | — |
| mime_type | text | Não | — |
| size | integer | Não | — |
| parts | integer | Não | — |
| media_id | uuid | Sim | FK → media |
| expires_at | timestamp with time zone | Não | — |

Restrições:

- `media_uploads_media_id_fkey`: `FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL`.
- `media_uploads_owner_id_fkey`: `FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE`.
- `media_uploads_parts_check`: `CHECK (((parts > 0) AND (parts <= 17)))`.
- `media_uploads_pkey`: `PRIMARY KEY (id)`.
- `media_uploads_purpose_check`: `CHECK ((purpose = ANY (ARRAY['verification'::text, 'instruction'::text, 'performance'::text, 'message'::text])))`.
- `media_uploads_size_check`: `CHECK (((size > 0) AND (size <= 52428800)))`.

Índices:

- `idx_media_uploads_media_id_fkey`: `CREATE INDEX idx_media_uploads_media_id_fkey ON public.media_uploads USING btree (media_id)`.
- `media_uploads_expiry`: `CREATE INDEX media_uploads_expiry ON public.media_uploads USING btree (expires_at)`.
- `media_uploads_owner`: `CREATE INDEX media_uploads_owner ON public.media_uploads USING btree (owner_id)`.
- `media_uploads_pkey`: `CREATE UNIQUE INDEX media_uploads_pkey ON public.media_uploads USING btree (id)`.

## messages

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| contract_id | uuid | Não | FK → contracts |
| sender_id | uuid | Não | FK → users |
| body_ciphertext | text | Não | — |
| media_id | uuid | Sim | FK → media |
| created_at | timestamp with time zone | Não | — |
| read_at | timestamp with time zone | Sim | — |
| athlete_id | uuid | Não | FK → contracts |
| coach_id | uuid | Não | FK → contracts |

Restrições:

- `messages_contract_members_fkey`: `FOREIGN KEY (contract_id, athlete_id, coach_id) REFERENCES contracts(id, athlete_id, coach_id) ON UPDATE CASCADE ON DELETE CASCADE`.
- `messages_media_id_fkey`: `FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL`.
- `messages_pkey`: `PRIMARY KEY (id)`.
- `messages_sender_id_fkey`: `FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE`.
- `messages_sender_participant`: `CHECK (((sender_id = athlete_id) OR (sender_id = coach_id)))`.

Índices:

- `idx_messages_media_id_fkey`: `CREATE INDEX idx_messages_media_id_fkey ON public.messages USING btree (media_id)`.
- `idx_messages_sender_id_fkey`: `CREATE INDEX idx_messages_sender_id_fkey ON public.messages USING btree (sender_id)`.
- `messages_history`: `CREATE INDEX messages_history ON public.messages USING btree (contract_id, created_at DESC, id DESC)`.
- `messages_pkey`: `CREATE UNIQUE INDEX messages_pkey ON public.messages USING btree (id)`.

## metric_types

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| sport | text | Não | PK |
| key | text | Não | PK |
| label | text | Não | — |
| unit | text | Não | — |
| min | double precision | Não | — |
| max | double precision | Não | — |

Restrições:

- `metric_types_check`: `CHECK ((min <= max))`.
- `metric_types_pkey`: `PRIMARY KEY (sport, key)`.

Índices:

- `metric_types_pkey`: `CREATE UNIQUE INDEX metric_types_pkey ON public.metric_types USING btree (sport, key)`.

## notifications

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| user_id | uuid | Não | FK → users |
| kind | text | Não | — |
| title | text | Não | — |
| resource_id | uuid | Sim | — |
| created_at | timestamp with time zone | Não | — |
| read_at | timestamp with time zone | Sim | — |

Restrições:

- `notifications_pkey`: `PRIMARY KEY (id)`.
- `notifications_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`.

Índices:

- `notifications_pkey`: `CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id)`.
- `notifications_user`: `CREATE INDEX notifications_user ON public.notifications USING btree (user_id, created_at DESC)`.

## password_resets

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| token_hash | text | Não | PK |
| user_id | uuid | Não | FK → users |
| expires_at | timestamp with time zone | Não | — |
| used_at | timestamp with time zone | Sim | — |
| created_at | timestamp with time zone | Não | — |

Restrições:

- `password_resets_pkey`: `PRIMARY KEY (token_hash)`.
- `password_resets_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`.

Índices:

- `idx_password_resets_user_id_fkey`: `CREATE INDEX idx_password_resets_user_id_fkey ON public.password_resets USING btree (user_id)`.
- `password_resets_expiry`: `CREATE INDEX password_resets_expiry ON public.password_resets USING btree (expires_at)`.
- `password_resets_pkey`: `CREATE UNIQUE INDEX password_resets_pkey ON public.password_resets USING btree (token_hash)`.

## privacy_requests

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| user_id | uuid | Não | FK → users |
| status | text | Não | — |
| requested_at | timestamp with time zone | Não | — |
| completed_at | timestamp with time zone | Sim | — |

Restrições:

- `privacy_requests_pkey`: `PRIMARY KEY (id)`.
- `privacy_requests_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'retained-financial'::text])))`.
- `privacy_requests_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`.

Índices:

- `idx_privacy_requests_user_id_fkey`: `CREATE INDEX idx_privacy_requests_user_id_fkey ON public.privacy_requests USING btree (user_id)`.
- `privacy_requests_pkey`: `CREATE UNIQUE INDEX privacy_requests_pkey ON public.privacy_requests USING btree (id)`.

## private_health

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| user_id | uuid | Não | PK; FK → users |
| encrypted_data | text | Não | — |
| updated_at | timestamp with time zone | Não | — |

Restrições:

- `private_health_pkey`: `PRIMARY KEY (user_id)`.
- `private_health_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`.

Índices:

- `private_health_pkey`: `CREATE UNIQUE INDEX private_health_pkey ON public.private_health USING btree (user_id)`.

## profiles

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| user_id | uuid | Não | PK; FK → users |
| city | text | Não | — |
| bio | text | Não | — |
| sports | _text | Não | — |
| goals | _text | Não | — |
| levels | _text | Não | — |
| availability | _text | Não | — |
| mode | text | Não | — |
| budget | numeric | Não | — |
| price | numeric | Não | — |
| cref | text | Não | — |
| verification_status | text | Não | — |
| verification_reason | text | Não | — |
| verification_expires_at | timestamp with time zone | Sim | — |

Restrições:

- `profiles_budget_check`: `CHECK ((budget >= (0)::numeric))`.
- `profiles_mode_check`: `CHECK ((mode = ANY (ARRAY['online'::text, 'presencial'::text, 'hibrido'::text])))`.
- `profiles_pkey`: `PRIMARY KEY (user_id)`.
- `profiles_price_check`: `CHECK ((price >= (0)::numeric))`.
- `profiles_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`.
- `profiles_verification_status_check`: `CHECK ((verification_status = ANY (ARRAY['unsubmitted'::text, 'pending'::text, 'approved'::text, 'rejected'::text, 'suspended'::text, 'expired'::text])))`.

Índices:

- `profiles_pkey`: `CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (user_id)`.

## review_moderation

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| review_id | uuid | Não | FK → reviews |
| reviewer_id | uuid | Não | FK → users |
| hidden | boolean | Não | — |
| reason | text | Não | — |
| created_at | timestamp with time zone | Não | — |

Restrições:

- `review_moderation_pkey`: `PRIMARY KEY (id)`.
- `review_moderation_reason_check`: `CHECK (((char_length(reason) >= 5) AND (char_length(reason) <= 1000)))`.
- `review_moderation_review_id_fkey`: `FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE`.
- `review_moderation_reviewer_id_fkey`: `FOREIGN KEY (reviewer_id) REFERENCES users(id)`.

Índices:

- `idx_review_moderation_review_id_fkey`: `CREATE INDEX idx_review_moderation_review_id_fkey ON public.review_moderation USING btree (review_id)`.
- `idx_review_moderation_reviewer_id_fkey`: `CREATE INDEX idx_review_moderation_reviewer_id_fkey ON public.review_moderation USING btree (reviewer_id)`.
- `review_moderation_pkey`: `CREATE UNIQUE INDEX review_moderation_pkey ON public.review_moderation USING btree (id)`.

## review_reports

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| review_id | uuid | Não | FK → reviews; UNIQUE |
| reporter_id | uuid | Não | FK → users; UNIQUE |
| reason | text | Não | — |
| created_at | timestamp with time zone | Não | — |

Restrições:

- `review_reports_pkey`: `PRIMARY KEY (id)`.
- `review_reports_reason_check`: `CHECK (((char_length(reason) >= 5) AND (char_length(reason) <= 1000)))`.
- `review_reports_reporter_id_fkey`: `FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE`.
- `review_reports_review_id_fkey`: `FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE`.
- `review_reports_review_id_reporter_id_key`: `UNIQUE (review_id, reporter_id)`.

Índices:

- `idx_review_reports_reporter_id_fkey`: `CREATE INDEX idx_review_reports_reporter_id_fkey ON public.review_reports USING btree (reporter_id)`.
- `review_reports_pkey`: `CREATE UNIQUE INDEX review_reports_pkey ON public.review_reports USING btree (id)`.
- `review_reports_review_id_reporter_id_key`: `CREATE UNIQUE INDEX review_reports_review_id_reporter_id_key ON public.review_reports USING btree (review_id, reporter_id)`.

## reviews

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| contract_id | uuid | Não | UNIQUE; FK → contracts |
| athlete_id | uuid | Não | FK → users; FK → contracts |
| coach_id | uuid | Não | FK → users; FK → contracts |
| rating | integer | Não | — |
| body | text | Não | — |
| reply | text | Sim | — |
| replied_at | timestamp with time zone | Sim | — |
| hidden | boolean | Não | — |
| created_at | timestamp with time zone | Não | — |
| updated_at | timestamp with time zone | Não | — |

Restrições:

- `reviews_athlete_id_fkey`: `FOREIGN KEY (athlete_id) REFERENCES users(id) ON DELETE CASCADE`.
- `reviews_body_check`: `CHECK (((char_length(body) >= 5) AND (char_length(body) <= 2000)))`.
- `reviews_coach_id_fkey`: `FOREIGN KEY (coach_id) REFERENCES users(id) ON DELETE CASCADE`.
- `reviews_contract_id_key`: `UNIQUE (contract_id)`.
- `reviews_contract_members_fkey`: `FOREIGN KEY (contract_id, athlete_id, coach_id) REFERENCES contracts(id, athlete_id, coach_id) ON DELETE CASCADE`.
- `reviews_pkey`: `PRIMARY KEY (id)`.
- `reviews_rating_check`: `CHECK (((rating >= 1) AND (rating <= 5)))`.
- `reviews_reply_check`: `CHECK (((char_length(reply) >= 5) AND (char_length(reply) <= 2000)))`.

Índices:

- `idx_reviews_athlete_id_fkey`: `CREATE INDEX idx_reviews_athlete_id_fkey ON public.reviews USING btree (athlete_id)`.
- `reviews_coach`: `CREATE INDEX reviews_coach ON public.reviews USING btree (coach_id, created_at DESC)`.
- `reviews_contract_id_key`: `CREATE UNIQUE INDEX reviews_contract_id_key ON public.reviews USING btree (contract_id)`.
- `reviews_pkey`: `CREATE UNIQUE INDEX reviews_pkey ON public.reviews USING btree (id)`.

## schema_migrations

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| version | text | Não | PK |
| checksum | text | Não | — |
| applied_at | timestamp with time zone | Não | — |

Restrições:

- `schema_migrations_pkey`: `PRIMARY KEY (version)`.

Índices:

- `schema_migrations_pkey`: `CREATE UNIQUE INDEX schema_migrations_pkey ON public.schema_migrations USING btree (version)`.

## sessions

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| token_hash | text | Não | PK |
| user_id | uuid | Não | FK → users |
| expires_at | timestamp with time zone | Não | — |
| created_at | timestamp with time zone | Não | — |

Restrições:

- `sessions_pkey`: `PRIMARY KEY (token_hash)`.
- `sessions_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`.

Índices:

- `idx_sessions_user_id_fkey`: `CREATE INDEX idx_sessions_user_id_fkey ON public.sessions USING btree (user_id)`.
- `sessions_expiry`: `CREATE INDEX sessions_expiry ON public.sessions USING btree (expires_at)`.
- `sessions_pkey`: `CREATE UNIQUE INDEX sessions_pkey ON public.sessions USING btree (token_hash)`.

## users

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | UNIQUE; PK |
| name | text | Não | — |
| email | text | Não | UNIQUE |
| password_hash | text | Não | — |
| role | text | Não | UNIQUE |
| created_at | timestamp with time zone | Não | — |
| disabled_at | timestamp with time zone | Sim | — |

Restrições:

- `users_email_check`: `CHECK ((email = lower(email)))`.
- `users_email_key`: `UNIQUE (email)`.
- `users_id_role_unique`: `UNIQUE (id, role)`.
- `users_name_check`: `CHECK (((length(name) >= 2) AND (length(name) <= 100)))`.
- `users_pkey`: `PRIMARY KEY (id)`.
- `users_role_check`: `CHECK ((role = ANY (ARRAY['athlete'::text, 'coach'::text, 'admin'::text])))`.

Índices:

- `users_email_key`: `CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email)`.
- `users_id_role_unique`: `CREATE UNIQUE INDEX users_id_role_unique ON public.users USING btree (id, role)`.
- `users_pkey`: `CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)`.

## verification_audit

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| verification_id | uuid | Não | FK → verifications |
| reviewer_id | uuid | Não | FK → users |
| decision | text | Não | — |
| reason | text | Não | — |
| created_at | timestamp with time zone | Não | — |

Restrições:

- `verification_audit_decision_check`: `CHECK ((decision = ANY (ARRAY['approved'::text, 'rejected'::text])))`.
- `verification_audit_pkey`: `PRIMARY KEY (id)`.
- `verification_audit_reviewer_id_fkey`: `FOREIGN KEY (reviewer_id) REFERENCES users(id)`.
- `verification_audit_verification_id_fkey`: `FOREIGN KEY (verification_id) REFERENCES verifications(id) ON DELETE CASCADE`.

Índices:

- `idx_verification_audit_reviewer_id_fkey`: `CREATE INDEX idx_verification_audit_reviewer_id_fkey ON public.verification_audit USING btree (reviewer_id)`.
- `idx_verification_audit_verification_id_fkey`: `CREATE INDEX idx_verification_audit_verification_id_fkey ON public.verification_audit USING btree (verification_id)`.
- `verification_audit_pkey`: `CREATE UNIQUE INDEX verification_audit_pkey ON public.verification_audit USING btree (id)`.

## verifications

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| coach_id | uuid | Não | FK → users |
| cref | text | Não | — |
| evidence | text | Não | — |
| status | text | Não | — |
| reason | text | Não | — |
| submitted_at | timestamp with time zone | Não | — |
| reviewed_at | timestamp with time zone | Sim | — |
| reviewer_id | uuid | Sim | FK → users |
| document_id | uuid | Sim | FK → media |
| expires_at | timestamp with time zone | Sim | — |
| source | text | Não | — |

Restrições:

- `verification_document`: `FOREIGN KEY (document_id) REFERENCES media(id)`.
- `verifications_coach_id_fkey`: `FOREIGN KEY (coach_id) REFERENCES users(id) ON DELETE CASCADE`.
- `verifications_pkey`: `PRIMARY KEY (id)`.
- `verifications_reviewer_id_fkey`: `FOREIGN KEY (reviewer_id) REFERENCES users(id)`.
- `verifications_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))`.

Índices:

- `idx_verification_document`: `CREATE INDEX idx_verification_document ON public.verifications USING btree (document_id)`.
- `idx_verifications_coach_id_fkey`: `CREATE INDEX idx_verifications_coach_id_fkey ON public.verifications USING btree (coach_id)`.
- `idx_verifications_reviewer_id_fkey`: `CREATE INDEX idx_verifications_reviewer_id_fkey ON public.verifications USING btree (reviewer_id)`.
- `one_pending_verification`: `CREATE UNIQUE INDEX one_pending_verification ON public.verifications USING btree (coach_id) WHERE (status = 'pending'::text)`.
- `verifications_pkey`: `CREATE UNIQUE INDEX verifications_pkey ON public.verifications USING btree (id)`.

## workouts

| Coluna | Tipo PostgreSQL | Nulo | Chave/restrição |
|---|---|---|---|
| id | uuid | Não | PK |
| contract_id | uuid | Não | FK → contracts |
| title | text | Não | — |
| sport | text | Não | — |
| scheduled_date | date | Não | — |
| instructions | text | Não | — |
| status | text | Não | — |
| created_at | timestamp with time zone | Não | — |

Restrições:

- `workouts_contract_id_fkey`: `FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE`.
- `workouts_pkey`: `PRIMARY KEY (id)`.
- `workouts_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text])))`.

Índices:

- `workouts_contract`: `CREATE INDEX workouts_contract ON public.workouts USING btree (contract_id)`.
- `workouts_pkey`: `CREATE UNIQUE INDEX workouts_pkey ON public.workouts USING btree (id)`.

