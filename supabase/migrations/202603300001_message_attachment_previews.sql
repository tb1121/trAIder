alter table public.messages
add column if not exists attachment_data_url text;
