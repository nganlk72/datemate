-- Run this in your Supabase SQL Editor

-- 1. Create Trips Table
CREATE TABLE trips (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT,
  headcount INT,
  budget INT,
  city TEXT,
  meetup_mode TEXT DEFAULT 'independent',
  meetup_lat DOUBLE PRECISION,
  meetup_lon DOUBLE PRECISION,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT DEFAULT 'planning'
);

-- 2. Create Locations Table
--    place_key = "lat,lon" string — stable dedup key, provider-agnostic
CREATE TABLE locations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  place_key TEXT UNIQUE,           -- format: "21.0289,105.8522"
  name TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  category TEXT,
  estimated_price INT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create Trip Locations Mapping
CREATE TABLE trip_locations (
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
  votes INT DEFAULT 0,
  estimated_cost INT,
  duration_minutes INT DEFAULT 60,
  PRIMARY KEY (trip_id, location_id)
);

-- 4. Trip Participants
CREATE TABLE trip_participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  name TEXT,
  avatar_emoji TEXT,
  budget INT,
  start_lat DOUBLE PRECISION,
  start_lon DOUBLE PRECISION,
  preferences JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Live User Locations (for GPS tracking)
CREATE TABLE user_locations (
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  participant_name TEXT,
  avatar_emoji TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (trip_id, participant_name)
);

-- 6. Location Reviews
CREATE TABLE location_reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
  reviewer_name TEXT,
  rating INT,
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ─── MIGRATION (if you already have the old schema) ───────────────────────────

-- ALTER TABLE locations ADD COLUMN IF NOT EXISTS place_key TEXT UNIQUE;
-- ALTER TABLE trips ADD COLUMN IF NOT EXISTS meetup_mode TEXT DEFAULT 'independent';
-- ALTER TABLE trips ADD COLUMN IF NOT EXISTS meetup_lat DOUBLE PRECISION;
-- ALTER TABLE trips ADD COLUMN IF NOT EXISTS meetup_lon DOUBLE PRECISION;
-- ALTER TABLE trip_locations ADD COLUMN IF NOT EXISTS estimated_cost INT;
-- ALTER TABLE trip_locations ADD COLUMN IF NOT EXISTS duration_minutes INT DEFAULT 60;
