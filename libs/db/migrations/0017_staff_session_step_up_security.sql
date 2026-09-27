-- A session's authentication level and time move with its sign-in, step-ups and refreshes
-- (KTD20, U29), so the app role may update them like the session's other moving parts.
GRANT UPDATE (authentication_level, authenticated_at) ON public.staff_sessions TO pl_app;
