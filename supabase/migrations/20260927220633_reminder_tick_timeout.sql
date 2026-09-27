-- The minute tick waited only pg_net's default 5 seconds for send-push. At busy
-- minutes (sending, or a cold start) send-push takes a little longer and still
-- succeeds, but the answer was recorded as a timeout. Wait up to 30 seconds so
-- every tick's real result is kept. (The job's secret is left untouched.)
select cron.alter_job(
  j.jobid,
  command := replace(j.command, '::jsonb' || chr(10) || '  );', '::jsonb,' || chr(10) || '    timeout_milliseconds := 30000' || chr(10) || '  );')
)
from cron.job j
where j.jobname = 'ricotta-reminder-tick' and j.command not like '%timeout_milliseconds%';
