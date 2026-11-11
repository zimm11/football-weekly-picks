-- Local dev seed data. Applied by `pnpm db:start` (first run) and `pnpm db:reset`. Never runs in production.
-- E2E and API tests create their own users and data and don't depend on anything here.
--
-- What you get (see README "Test accounts"):
--   * Four accounts, all with the password `password123`:
--       admin@example.com (Commish, league admin), pat@example.com, sam@example.com, alex@example.com
--   * One league, "Sunday Crew", with invite link /join/local-invite
--   * The 2026 season with Week 9 already closed: real matchups and final scores, made-up spreads,
--     and picks from all four players. Alex skipped Thursday and chose no POW, so Alex shows the
--     automatic Monday night POW.
-- Later weeks are deliberately absent: create them in the app so the import from ESPN gets exercised.

-- ---------- Accounts ----------

create temporary table seed_users (n int, id uuid, email text, display_name text, role text) on commit drop;
insert into seed_users values
  (0, '11111111-1111-4111-8111-000000000001', 'admin@example.com', 'Commish', 'admin'),
  (1, '11111111-1111-4111-8111-000000000002', 'pat@example.com',   'Pat',     'member'),
  (2, '11111111-1111-4111-8111-000000000003', 'sam@example.com',   'Sam',     'member'),
  (3, '11111111-1111-4111-8111-000000000004', 'alex@example.com',  'Alex',    'member');

-- Supabase Auth needs the token columns to be empty strings (not null) and an identity row per user.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', ''
from seed_users;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), id, id::text, 'email',
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), now(), now(), now()
from seed_users;

insert into profiles (user_id, display_name)
select id, display_name from seed_users;

-- ---------- League ----------

insert into leagues (id, name, time_zone, invite_code)
values ('22222222-2222-4222-8222-000000000001', 'Sunday Crew', 'America/New_York', 'local-invite');

insert into league_members (league_id, user_id, role, joined_at)
select '22222222-2222-4222-8222-000000000001', id, role, now() - interval '60 days' + n * interval '1 minute'
from seed_users;

insert into seasons (id, league_id, year)
values ('33333333-3333-4333-8333-000000000001', '22222222-2222-4222-8222-000000000001', 2026);

-- ---------- Week 9 of 2026, closed ----------

insert into weeks (id, season_id, number, status)
values ('44444444-4444-4444-8444-000000000009', '33333333-3333-4333-8333-000000000001', 9, 'final');

-- Real matchups, kickoffs and final scores. The spreads (home team's line) are made up.
create temporary table seed_games (
  n int, external_id text, away_team text, home_team text, kickoff timestamptz,
  spread float8, points int, away_score int, home_score int
) on commit drop;
insert into seed_games values
  ( 0, '401873037', 'JAX', 'BAL', '2026-11-06T01:15Z', -3.5, 3, 33, 10), -- Thursday night
  ( 1, '401873038', 'CIN', 'ATL', '2026-11-08T14:30Z',  2.5, 1, 34, 17), -- Sunday 9:30am ET
  ( 2, '401873040', 'DAL', 'IND', '2026-11-08T18:00Z', -1.5, 1, 27, 23),
  ( 3, '401873045', 'NYJ', 'KC',  '2026-11-08T18:00Z', -9.5, 1, 12, 35),
  ( 4, '401873042', 'DET', 'MIA', '2026-11-08T18:00Z',  4.5, 1, 19,  9),
  ( 5, '401873039', 'CLE', 'NO',  '2026-11-08T18:00Z', -2.5, 1, 22, 23),
  ( 6, '401873044', 'NYG', 'PHI', '2026-11-08T18:00Z', -6.5, 1, 19, 11),
  ( 7, '401873043', 'LAR', 'WSH', '2026-11-08T18:00Z',  3.5, 1, 20, 13),
  ( 8, '401873041', 'DEN', 'CAR', '2026-11-08T18:00Z',  5.5, 1, 26, 21),
  ( 9, '401873046', 'HOU', 'LAC', '2026-11-08T21:05Z', -1.5, 1, 44, 22),
  (10, '401873049', 'GB',  'NE',  '2026-11-08T21:25Z',  3.5, 1, 45, 27),
  (11, '401873047', 'LV',  'SF',  '2026-11-08T21:25Z', -7.5, 1, 17, 38),
  (12, '401873048', 'ARI', 'SEA', '2026-11-08T21:25Z', -6.5, 1,  3, 17),
  (13, '401873050', 'TB',  'CHI', '2026-11-09T01:20Z', -2.5, 2, 24, 27), -- Sunday night
  (14, '401873051', 'BUF', 'MIN', '2026-11-10T01:15Z',  4.5, 3, 23,  6); -- Monday night (total 29)

insert into games (id, week_id, external_id, away_team, home_team, kickoff, spread, points, away_score, home_score)
select
  ('55555555-5555-4555-8555-' || lpad(n::text, 12, '0'))::uuid,
  '44444444-4444-4444-8444-000000000009',
  external_id, away_team, home_team, kickoff, spread, points, away_score, home_score
from seed_games;

-- The Monday night game is the tiebreaker.
update weeks
set tiebreaker_game_id = '55555555-5555-4555-8555-000000000014'
where id = '44444444-4444-4444-8444-000000000009';

-- Everyone picks every game (an arbitrary but fixed mix of sides), except that Alex missed Thursday.
-- POWs: Commish on DET at MIA, Pat on Thursday night, Sam on Sunday night, Alex none.
insert into picks (week_id, game_id, user_id, side, is_pow)
select
  '44444444-4444-4444-8444-000000000009',
  ('55555555-5555-4555-8555-' || lpad(g.n::text, 12, '0'))::uuid,
  u.id,
  case when (g.n * 7 + u.n * 3 + g.n * u.n) % 3 = 0 then 'away' else 'home' end,
  (u.n, g.n) in ((0, 4), (1, 0), (2, 13))
from seed_games g
cross join seed_users u
where not (u.n = 3 and g.n = 0);

-- Guesses at the Monday night total (actual: 29).
insert into tiebreaker_guesses (week_id, user_id, total)
select '44444444-4444-4444-8444-000000000009', id, (array[41, 35, 29, 44])[n + 1]
from seed_users;
