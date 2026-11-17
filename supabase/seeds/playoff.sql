-- Playoff pick'em seed (local only), loaded after seed.sql. Uses its accounts (password `password123`).
--
-- What you get:
--   * "Playoff Bracket", a Guillotine Playoff pick'em league with invite link /join/local-playoff: Commish
--     (admin@example.com) is its admin, Pat and Sam are members. Alex isn't in it, so you can join from the link.
--   * Its 2025 playoffs, all four rounds final (one or two games each, typed in by hand). Sam's Wild Card POW
--     lost, so Sam is "Out: Wild Card"; Pat's Divisional POW lost, so Pat is "Out: Divisional"; Commish won
--     every POW and is the champion with 13 points (Pat 3, Sam 0). The Super Bowl total was 42.
--   * Its 2026 playoffs, Guillotine, with no rounds yet: automation asks ESPN for the Wild Card round from
--     Week 18's Sunday (2027-01-10). Before then, the League tab's Rounds card creates a round by hand.
-- Pat and Sam haven't seen the Super Bowl recap yet, so it opens for them on the league.

insert into leagues (id, name, time_zone, invite_code, type, management)
values ('9a9a9a9a-0000-4000-8000-000000000001', 'Playoff Bracket', 'America/New_York', 'local-playoff', 'playoff', 'auto');

insert into league_members (league_id, user_id, role, joined_at) values
  ('9a9a9a9a-0000-4000-8000-000000000001', '11111111-1111-4111-8111-000000000001', 'admin',  '2025-12-01T12:00:00Z'),
  ('9a9a9a9a-0000-4000-8000-000000000001', '11111111-1111-4111-8111-000000000002', 'member', '2025-12-01T12:00:00Z'),
  ('9a9a9a9a-0000-4000-8000-000000000001', '11111111-1111-4111-8111-000000000003', 'member', '2025-12-01T12:00:00Z');

insert into seasons (id, league_id, year, settings) values
  ('9a9a9a9a-0000-4000-8000-000000000011', '9a9a9a9a-0000-4000-8000-000000000001', 2025, '{"format":"guillotine"}'),
  ('9a9a9a9a-0000-4000-8000-000000000012', '9a9a9a9a-0000-4000-8000-000000000001', 2026, '{"format":"guillotine"}');

-- The 2025 rounds: Wild Card (19), Divisional (20), Conference (21), Super Bowl (22), each final.
insert into weeks (id, season_id, number, status, finalized_at) values
  ('9a9a9a9a-0000-4000-8000-000000000119', '9a9a9a9a-0000-4000-8000-000000000011', 19, 'final', '2026-01-13T06:00:00Z'),
  ('9a9a9a9a-0000-4000-8000-000000000120', '9a9a9a9a-0000-4000-8000-000000000011', 20, 'final', '2026-01-19T06:00:00Z'),
  ('9a9a9a9a-0000-4000-8000-000000000121', '9a9a9a9a-0000-4000-8000-000000000011', 21, 'final', '2026-01-26T06:00:00Z'),
  ('9a9a9a9a-0000-4000-8000-000000000122', '9a9a9a9a-0000-4000-8000-000000000011', 22, 'final', '2026-02-09T06:00:00Z');

-- Each round's games are worth its points: 1, 2, 3, 4. Spreads are the home team's line.
insert into games (id, week_id, home_team, away_team, kickoff, spread, spread_by_admin, points, home_score, away_score) values
  -- BUF -3 wins by 7 (BUF covers); PHI -2.5 loses by 3 (SF covers).
  ('9a9a9a9a-0000-4000-8000-000000001901', '9a9a9a9a-0000-4000-8000-000000000119', 'BUF', 'JAX', '2026-01-11T18:00:00Z', -3,   true, 1, 27, 20),
  ('9a9a9a9a-0000-4000-8000-000000001902', '9a9a9a9a-0000-4000-8000-000000000119', 'PHI', 'SF',  '2026-01-11T21:30:00Z', -2.5, true, 1, 20, 23),
  -- DEN -1.5 wins by 6.
  ('9a9a9a9a-0000-4000-8000-000000002001', '9a9a9a9a-0000-4000-8000-000000000120', 'DEN', 'BUF', '2026-01-17T21:30:00Z', -1.5, true, 2, 30, 24),
  -- SEA -3 wins by 4.
  ('9a9a9a9a-0000-4000-8000-000000002101', '9a9a9a9a-0000-4000-8000-000000000121', 'SEA', 'LAR', '2026-01-25T23:30:00Z', -3,   true, 3, 31, 27),
  -- SEA -4.5 wins 29–13: a total of 42.
  ('9a9a9a9a-0000-4000-8000-000000002201', '9a9a9a9a-0000-4000-8000-000000000122', 'SEA', 'NE',  '2026-02-08T23:30:00Z', -4.5, true, 4, 29, 13);

insert into picks (week_id, game_id, user_id, side, is_pow) values
  -- Wild Card: Commish's POW (BUF) wins, Pat's (SF) wins, Sam's (JAX) loses.
  ('9a9a9a9a-0000-4000-8000-000000000119', '9a9a9a9a-0000-4000-8000-000000001901', '11111111-1111-4111-8111-000000000001', 'home', true),
  ('9a9a9a9a-0000-4000-8000-000000000119', '9a9a9a9a-0000-4000-8000-000000001902', '11111111-1111-4111-8111-000000000001', 'home', false),
  ('9a9a9a9a-0000-4000-8000-000000000119', '9a9a9a9a-0000-4000-8000-000000001901', '11111111-1111-4111-8111-000000000002', 'home', false),
  ('9a9a9a9a-0000-4000-8000-000000000119', '9a9a9a9a-0000-4000-8000-000000001902', '11111111-1111-4111-8111-000000000002', 'away', true),
  ('9a9a9a9a-0000-4000-8000-000000000119', '9a9a9a9a-0000-4000-8000-000000001901', '11111111-1111-4111-8111-000000000003', 'away', true),
  -- Divisional: Commish's POW (DEN) wins, Pat's (BUF) loses. Sam is out of picking.
  ('9a9a9a9a-0000-4000-8000-000000000120', '9a9a9a9a-0000-4000-8000-000000002001', '11111111-1111-4111-8111-000000000001', 'home', true),
  ('9a9a9a9a-0000-4000-8000-000000000120', '9a9a9a9a-0000-4000-8000-000000002001', '11111111-1111-4111-8111-000000000002', 'away', true),
  -- Conference and Super Bowl: only Commish is still picking, and wins both (the Super Bowl has no POW).
  ('9a9a9a9a-0000-4000-8000-000000000121', '9a9a9a9a-0000-4000-8000-000000002101', '11111111-1111-4111-8111-000000000001', 'home', true),
  ('9a9a9a9a-0000-4000-8000-000000000122', '9a9a9a9a-0000-4000-8000-000000002201', '11111111-1111-4111-8111-000000000001', 'home', false);

-- Everyone guessed the Super Bowl's total, eliminated or not.
insert into tiebreaker_guesses (week_id, user_id, total) values
  ('9a9a9a9a-0000-4000-8000-000000000122', '11111111-1111-4111-8111-000000000001', 45),
  ('9a9a9a9a-0000-4000-8000-000000000122', '11111111-1111-4111-8111-000000000002', 40),
  ('9a9a9a9a-0000-4000-8000-000000000122', '11111111-1111-4111-8111-000000000003', 44);

insert into week_participants (week_id, user_id)
select w.id, m.user_id
from weeks w
cross join league_members m
where w.season_id = '9a9a9a9a-0000-4000-8000-000000000011'
  and m.league_id = '9a9a9a9a-0000-4000-8000-000000000001';

-- Commish has seen every round's results; Pat and Sam get the Super Bowl recap.
insert into week_recap_views (week_id, user_id, seen_at)
select id, '11111111-1111-4111-8111-000000000001', finalized_at
from weeks where season_id = '9a9a9a9a-0000-4000-8000-000000000011';
