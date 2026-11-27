ALTER TABLE public.private_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY private_health_owner ON public.private_health
  USING (user_id = NULLIF(current_setting('linkatletas.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('linkatletas.user_id', true), '')::uuid);

CREATE POLICY private_health_backup_read ON public.private_health
  FOR SELECT USING (current_user = 'linkatletas_backup_reader');
