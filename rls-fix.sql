-- Run this in your Supabase SQL Editor to fix the insertion error

-- Disable RLS for the MVP so anyone can create trips and vote
ALTER TABLE trips DISABLE ROW LEVEL SECURITY;
ALTER TABLE locations DISABLE ROW LEVEL SECURITY;
ALTER TABLE trip_locations DISABLE ROW LEVEL SECURITY;
