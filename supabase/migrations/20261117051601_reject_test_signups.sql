-- Supabase Auth's "Before User Created" hook: refuse accounts on domains reserved for testing and documentation
-- (RFC 2606 and RFC 6761), which no real player can have. A refused sign-up creates no user and sends no
-- confirmation email, so a test that reaches production by mistake can't bounce mail off the sending domain.
--
-- The function is only installed here. Production turns it on in the dashboard (Authentication → Hooks →
-- Before User Created → Postgres function `public.hook_reject_test_signups`; README, "Email"). The local stack
-- leaves it off in supabase/config.toml, because E2E signs up `@example.com` users there.
CREATE OR REPLACE FUNCTION public.hook_reject_test_signups(event jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN rtrim(lower(split_part(event -> 'user' ->> 'email', '@', 2)), '.')
      ~ '(^|\.)(example\.(com|net|org)|test|example|invalid|localhost)$'
    THEN jsonb_build_object(
      'error', jsonb_build_object('http_code', 400, 'message', 'This email address can''t be used to sign up.')
    )
    ELSE '{}'::jsonb
  END
$$;--> statement-breakpoint

-- Only Supabase Auth calls it. A function in `public` is executable by PUBLIC until revoked.
REVOKE ALL ON FUNCTION public.hook_reject_test_signups(jsonb) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.hook_reject_test_signups(jsonb) TO supabase_auth_admin;
