-- Rico now uses one locked Gemini configuration. The Gemini API key remains
-- in app_secrets; these older provider-selection records are no longer read.
delete from public.app_secrets
where key in ('assistant_provider', 'anthropic_api_key', 'assistant_model', 'gemini_model');
