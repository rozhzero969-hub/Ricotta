-- Rico conversations are ephemeral in the browser. Remove the former
-- device-and-role backup, including the conversations it stored.
drop table if exists public.app_assistant_chats;
