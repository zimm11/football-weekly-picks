-- Local dev seed: one survivor pool, "Last One Standing" (invite link /join/local-survivor), on the accounts
-- seed.sql creates (all with the password `password123`). Loaded after seed.sql; never runs in production.
--
--   * The 2026 season with 2 lives, starting in Week 8. Weeks 8–10 are closed, with made-up slates and scores
--     (games typed in, so the feed never touches them) and every week's players recorded (week_participants).
--       - Week 8: Commish (Chiefs) and Pat (Bills) win; Sam's Cowboys lose and Alex has no pick: a strike each.
--       - Week 9: Sam's Lions lose, a second strike: Sam is out. Commish, Pat and Alex win.
--       - Week 10: Pat's Dolphins lose (a strike); Alex has no pick again and is out.
--     So Commish (two lives) and Pat (one) are still in; Standings shows "2 of 4 alive" and a Lives column.
--   * Week 11 exists but is empty: the first read of the league imports its slate from ESPN and opens it, the
--     way automation fills each week. (Without a network it stays empty; the pool waits.)
--   * Week 10 has a finalization timestamp, so each account sees its recap once.
-- Nobody's status is stored: it is worked out from these weeks, picks and memberships on every read.

insert into leagues (id, name, time_zone, invite_code, type, management)
values ('22222222-2222-4222-8222-0000000000a1', 'Last One Standing', 'America/New_York', 'local-survivor', 'survivor', 'auto');

insert into league_members (league_id, user_id, role, joined_at)
select '22222222-2222-4222-8222-0000000000a1', id, role, timestamptz '2026-08-01 12:00:00+00' + n * interval '1 minute'
from profiles p
join (values
  (0, '11111111-1111-4111-8111-000000000001'::uuid, 'admin'),
  (1, '11111111-1111-4111-8111-000000000002'::uuid, 'member'),
  (2, '11111111-1111-4111-8111-000000000003'::uuid, 'member'),
  (3, '11111111-1111-4111-8111-000000000004'::uuid, 'member')
) as u (n, id, role) on u.id = p.user_id;

insert into seasons (id, league_id, year, settings)
values ('33333333-3333-4333-8333-0000000000a1', '22222222-2222-4222-8222-0000000000a1', 2026,
  '{"lives": 2, "startWeek": 8}');

insert into weeks (id, season_id, number, status, finalized_at) values
  ('44444444-4444-4444-8444-0000000000a8', '33333333-3333-4333-8333-0000000000a1', 8, 'final', '2026-11-03 12:00:00+00'),
  ('44444444-4444-4444-8444-0000000000a9', '33333333-3333-4333-8333-0000000000a1', 9, 'final', '2026-11-10 12:00:00+00'),
  ('44444444-4444-4444-8444-0000000000aa', '33333333-3333-4333-8333-0000000000a1', 10, 'final', '2026-11-16 12:00:00+00'),
  ('44444444-4444-4444-8444-0000000000ab', '33333333-3333-4333-8333-0000000000a1', 11, 'draft', null);

-- Three made-up games a week, all Sunday afternoon (points don't count in survivor; spreads are unused).
insert into games (id, week_id, away_team, home_team, kickoff, spread, points, away_score, home_score) values
  ('55555555-5555-4555-8555-0000000a0801', '44444444-4444-4444-8444-0000000000a8', 'LV',  'KC',  '2026-11-01 18:00:00+00', null, 1, 13, 27),
  ('55555555-5555-4555-8555-0000000a0802', '44444444-4444-4444-8444-0000000000a8', 'NYJ', 'BUF', '2026-11-01 18:00:00+00', null, 1, 10, 24),
  ('55555555-5555-4555-8555-0000000a0803', '44444444-4444-4444-8444-0000000000a8', 'DAL', 'NYG', '2026-11-01 21:25:00+00', null, 1, 17, 20),
  ('55555555-5555-4555-8555-0000000a0901', '44444444-4444-4444-8444-0000000000a9', 'WSH', 'PHI', '2026-11-08 18:00:00+00', null, 1, 14, 31),
  ('55555555-5555-4555-8555-0000000a0902', '44444444-4444-4444-8444-0000000000a9', 'SF',  'ARI', '2026-11-08 21:05:00+00', null, 1, 28, 16),
  ('55555555-5555-4555-8555-0000000a0903', '44444444-4444-4444-8444-0000000000a9', 'DET', 'GB',  '2026-11-08 21:25:00+00', null, 1, 20, 23),
  ('55555555-5555-4555-8555-0000000a1001', '44444444-4444-4444-8444-0000000000aa', 'CLE', 'BAL', '2026-11-15 18:00:00+00', null, 1, 9, 26),
  ('55555555-5555-4555-8555-0000000a1002', '44444444-4444-4444-8444-0000000000aa', 'MIA', 'NE',  '2026-11-15 18:00:00+00', null, 1, 17, 21),
  ('55555555-5555-4555-8555-0000000a1003', '44444444-4444-4444-8444-0000000000aa', 'SEA', 'LAR', '2026-11-15 21:25:00+00', null, 1, 24, 27);

-- side is the picked team's side of its game.
insert into survivor_picks (week_id, user_id, game_id, side) values
  ('44444444-4444-4444-8444-0000000000a8', '11111111-1111-4111-8111-000000000001', '55555555-5555-4555-8555-0000000a0801', 'home'),
  ('44444444-4444-4444-8444-0000000000a8', '11111111-1111-4111-8111-000000000002', '55555555-5555-4555-8555-0000000a0802', 'home'),
  ('44444444-4444-4444-8444-0000000000a8', '11111111-1111-4111-8111-000000000003', '55555555-5555-4555-8555-0000000a0803', 'away'),
  ('44444444-4444-4444-8444-0000000000a9', '11111111-1111-4111-8111-000000000001', '55555555-5555-4555-8555-0000000a0901', 'home'),
  ('44444444-4444-4444-8444-0000000000a9', '11111111-1111-4111-8111-000000000002', '55555555-5555-4555-8555-0000000a0902', 'away'),
  ('44444444-4444-4444-8444-0000000000a9', '11111111-1111-4111-8111-000000000003', '55555555-5555-4555-8555-0000000a0903', 'away'),
  ('44444444-4444-4444-8444-0000000000a9', '11111111-1111-4111-8111-000000000004', '55555555-5555-4555-8555-0000000a0903', 'home'),
  ('44444444-4444-4444-8444-0000000000aa', '11111111-1111-4111-8111-000000000001', '55555555-5555-4555-8555-0000000a1001', 'home'),
  ('44444444-4444-4444-8444-0000000000aa', '11111111-1111-4111-8111-000000000002', '55555555-5555-4555-8555-0000000a1002', 'away');

-- Who played each closed week, as finalizing records it: Week 8's list is the pool's entrants.
insert into week_participants (week_id, user_id)
select w.id, m.user_id
from weeks w
join league_members m on m.league_id = '22222222-2222-4222-8222-0000000000a1'
where w.season_id = '33333333-3333-4333-8333-0000000000a1' and w.status = 'final';
