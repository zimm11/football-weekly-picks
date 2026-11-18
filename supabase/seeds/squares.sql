-- Squares seed (local only), loaded after seed.sql. Uses its four accounts (password `password123`).
--
-- What you get:
--   * "Squares Crew", a Squares league with invite link /join/local-squares: Commish (admin@example.com) is
--     its admin, Pat and Sam are members. Alex isn't in it, so you can join it from /join/local-squares.
--   * An open board for the 2026 season's Super Bowl, typed in by hand (BUF at SEA, Sunday 2027-02-14 at
--     6:30pm Eastern), 10 squares per player. Pat holds three squares, Commish two, and the guest "Uncle Ray"
--     two (an admin typed them; guest squares count against nobody's limit). Sam holds none, so Sam gets the
--     evening-before reminder at 7pm Eastern on 2027-02-13.
--   * A finished board from the 2025 season's Super Bowl (KC at PHI), drawn, with four quarter results. The
--     halftime square was empty, so that quarter has no winner, and the final includes overtime.
-- Both boards are listed on the league's Boards tab, the open one first; a commissioner adds another with
-- Boards → New board. Nothing here is drawn on the open board: press Lock and draw on /boards/<id>/manage, or
-- let it lock itself at kickoff (move the API's clock with CLOCK_OVERRIDE; see the README).

insert into leagues (id, name, time_zone, invite_code, type, management)
values ('5c5c5c5c-0000-4000-8000-000000000001', 'Squares Crew', 'America/New_York', 'local-squares', 'squares', 'auto');

insert into league_members (league_id, user_id, role, joined_at) values
  ('5c5c5c5c-0000-4000-8000-000000000001', '11111111-1111-4111-8111-000000000001', 'admin',  '2026-08-01T12:00:00Z'),
  ('5c5c5c5c-0000-4000-8000-000000000001', '11111111-1111-4111-8111-000000000002', 'member', '2026-08-01T12:00:00Z'),
  ('5c5c5c5c-0000-4000-8000-000000000001', '11111111-1111-4111-8111-000000000003', 'member', '2026-08-01T12:00:00Z');

-- The open board: a game typed in by hand, so no external id, year or week.
insert into square_boards (id, league_id, home_team, away_team, kickoff, max_per_player)
values ('5c5c5c5c-0000-4000-8000-000000000101', '5c5c5c5c-0000-4000-8000-000000000001', 'SEA', 'BUF',
        '2027-02-14T23:30:00Z', 10);

insert into square_claims (board_id, row, col, user_id, guest_name) values
  ('5c5c5c5c-0000-4000-8000-000000000101', 0, 0, '11111111-1111-4111-8111-000000000002', null),
  ('5c5c5c5c-0000-4000-8000-000000000101', 3, 7, '11111111-1111-4111-8111-000000000002', null),
  ('5c5c5c5c-0000-4000-8000-000000000101', 9, 4, '11111111-1111-4111-8111-000000000002', null),
  ('5c5c5c5c-0000-4000-8000-000000000101', 5, 5, '11111111-1111-4111-8111-000000000001', null),
  ('5c5c5c5c-0000-4000-8000-000000000101', 2, 8, '11111111-1111-4111-8111-000000000001', null),
  ('5c5c5c5c-0000-4000-8000-000000000101', 1, 1, null, 'Uncle Ray'),
  ('5c5c5c5c-0000-4000-8000-000000000101', 6, 2, null, 'Uncle Ray');

-- The finished board. Home digits across the top, away digits down the side.
insert into square_boards (id, league_id, home_team, away_team, kickoff, max_per_player, home_digits, away_digits, drawn_at)
values ('5c5c5c5c-0000-4000-8000-000000000102', '5c5c5c5c-0000-4000-8000-000000000001', 'PHI', 'KC',
        '2026-02-08T23:30:00Z', 10,
        '{3,0,7,1,4,9,2,6,8,5}', '{8,4,1,0,2,3,9,5,7,6}', '2026-02-08T23:30:00Z');

-- Q1 PHI 7 KC 3 → column 2 (7), row 5 (3): Pat. Half PHI 14 KC 10 → column 4, row 3: nobody.
-- Q3 PHI 17 KC 17 → column 2, row 8: Commish. Final PHI 26 KC 20 after overtime → column 7 (6), row 3 (0): Sam.
insert into square_claims (board_id, row, col, user_id, guest_name) values
  ('5c5c5c5c-0000-4000-8000-000000000102', 5, 2, '11111111-1111-4111-8111-000000000002', null),
  ('5c5c5c5c-0000-4000-8000-000000000102', 8, 2, '11111111-1111-4111-8111-000000000001', null),
  ('5c5c5c5c-0000-4000-8000-000000000102', 3, 7, '11111111-1111-4111-8111-000000000003', null),
  ('5c5c5c5c-0000-4000-8000-000000000102', 0, 0, null, 'Uncle Ray');

insert into square_scores (board_id, period, home_score, away_score, by_admin) values
  ('5c5c5c5c-0000-4000-8000-000000000102', 'q1', 7, 3, true),
  ('5c5c5c5c-0000-4000-8000-000000000102', 'half', 14, 10, true),
  ('5c5c5c5c-0000-4000-8000-000000000102', 'q3', 17, 17, true),
  ('5c5c5c5c-0000-4000-8000-000000000102', 'final', 26, 20, true);
