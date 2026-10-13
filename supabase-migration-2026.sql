-- =============================================================================
-- Migration CUD Collab (à exécuter une fois, APRÈS supabase-auth-setup.sql)
-- Supabase → SQL Editor → coller ce fichier → Run.
--
-- 1. Colonnes utilisées par l'application et absentes jusqu'ici.
-- 2. Messagerie : un message = une ligne dans chat_history.
-- 3. Confidentialité : conversations et messages privés visibles seulement par
--    leurs participants (et les administrateurs). Les autres contenus
--    (forums, réunions, fichiers, notifications) restent partagés entre tout
--    le personnel connecté, ce qui est le principe d'une plateforme collaborative.
-- =============================================================================

begin;

-- 1. Colonnes manquantes ------------------------------------------------------
alter table public.users add column if not exists tel text;
alter table public.directions add column if not exists head bigint;

-- 2. Messages ---------------------------------------------------------------
create table if not exists public.chat_history (
  id              bigint primary key,
  conversation_id bigint not null,
  sender          bigint,
  text            text,
  "fileName"      text,
  "fileUrl"       text,
  sticker         text,
  time            text
);

-- 3. Fonctions d'aide pour les règles de sécurité ------------------------------
-- Identifiant (users.id) de la personne connectée.
create or replace function public.cud_current_user_id()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select u.id from public.users u
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

-- Vrai si la personne connectée est participante de la conversation.
-- Fonctionne que participants soit un tableau SQL, un json ou un jsonb
-- contenant des identifiants numériques.
create or replace function public.cud_is_participant(conv_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = conv_id
      and to_jsonb(c.participants) @> jsonb_build_array(public.cud_current_user_id())
  );
$$;

revoke all on function public.cud_current_user_id() from public;
revoke all on function public.cud_is_participant(bigint) from public;
grant execute on function public.cud_current_user_id() to authenticated;
grant execute on function public.cud_is_participant(bigint) to authenticated;

-- 4. Conversations : participants et administrateurs seulement ------------------
alter table public.conversations enable row level security;
drop policy if exists authenticated_all_access on public.conversations;
drop policy if exists conversations_participants on public.conversations;
create policy conversations_participants on public.conversations
  for all to authenticated
  using (
    public.cud_is_admin()
    or to_jsonb(participants) @> jsonb_build_array(public.cud_current_user_id())
  )
  with check (
    public.cud_is_admin()
    or to_jsonb(participants) @> jsonb_build_array(public.cud_current_user_id())
  );

-- 5. Messages : participants et administrateurs ; on n'écrit qu'en son nom ----
alter table public.chat_history enable row level security;
grant select, insert, update, delete on public.chat_history to authenticated;
drop policy if exists authenticated_all_access on public.chat_history;
drop policy if exists chat_history_participants on public.chat_history;
create policy chat_history_participants on public.chat_history
  for all to authenticated
  using (
    public.cud_is_admin()
    or public.cud_is_participant(conversation_id)
  )
  with check (
    public.cud_is_admin()
    or (sender = public.cud_current_user_id() and public.cud_is_participant(conversation_id))
  );

commit;
