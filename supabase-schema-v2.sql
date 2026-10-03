-- Run this in your Supabase SQL Editor to support the new "Voting Lobby" feature

CREATE TABLE trip_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  name TEXT,
  avatar_emoji TEXT,
  budget INT,
  start_lat DOUBLE PRECISION,
  start_lon DOUBLE PRECISION,
  preferences JSONB
);

-- Disable RLS so guests can join the lobby freely
ALTER TABLE trip_participants DISABLE ROW LEVEL SECURITY;

-- VERY IMPORTANT: 
-- 1. Go to your Supabase Dashboard
-- 2. Click "Database" on the left menu
-- 3. Click "Publications" (or "Replication")
-- 4. Click the "supabase_realtime" publication
-- 5. Toggle the switch ON for 'trip_participants' and 'trip_locations'
-- This makes the live avatars and voting work instantly!
