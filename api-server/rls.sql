-- RLS policies
-- Run this in Supabase SQL Editor after creating tables via drizzle-kit push.
-- Writes always go through Hono (service_role key) which bypasses RLS.
-- These policies only govern direct reads from Godot via the anon key.
--
-- For auth.jwt()->'sub' to work with Godot direct reads,
-- the JWT sent by the Godot Supabase client must be signed with Supabase's
-- own JWT secret. Revisit when implementing SupabaseClient in Godot.

-- Enable RLS on all three tables
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE division_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;

-- Players: can read their own row
CREATE POLICY "players_select_own"
  ON players FOR SELECT
  USING ((auth.jwt()->>'sub')::uuid = id);

-- Division templates: can read their own templates
CREATE POLICY "division_templates_select_own"
  ON division_templates FOR SELECT
  USING ((auth.jwt()->>'sub')::uuid = player_id);

-- Game sessions: anyone can read (public match history)
CREATE POLICY "game_sessions_select_all"
  ON game_sessions FOR SELECT
  USING (true);
