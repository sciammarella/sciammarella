-- Server-side monitoring schedule. Runs every minute and asks the
-- `monitor-missions` Edge Function to process missions whose next_check_at is due.
-- Monitoring therefore never depends on a browser tab being open.
--
-- Prerequisites (run once, with your real values, in the SQL editor):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'farebuddy_project_url');
--   select vault.create_secret('<random-long-secret>', 'farebuddy_cron_secret');
-- and set the same CRON_SECRET for the Edge Function:
--   supabase secrets set CRON_SECRET=<random-long-secret>

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'farebuddy-monitor-missions',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'farebuddy_project_url') || '/functions/v1/monitor-missions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'farebuddy_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
