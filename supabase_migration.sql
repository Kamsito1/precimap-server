-- ============================================================
-- PreciMap v3.0 — Supabase Migration
-- Run this in: supabase.com/dashboard/project/hhmorsfzxuunzbndjdyt/sql/new
-- ============================================================

-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT DEFAULT '',
  points INTEGER DEFAULT 0,
  streak INTEGER DEFAULT 0,
  last_report_date TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS places (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  lat REAL, lng REAL,
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  hours TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prices (
  id BIGSERIAL PRIMARY KEY,
  place_id BIGINT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  product TEXT NOT NULL,
  price REAL NOT NULL,
  unit TEXT DEFAULT 'unidad',
  reported_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  photo_url TEXT,
  status TEXT DEFAULT 'pending',
  votes_up INTEGER DEFAULT 0,
  votes_down INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  reported_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_votes (
  id BIGSERIAL PRIMARY KEY,
  price_id BIGINT NOT NULL REFERENCES prices(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(price_id, user_id)
);

CREATE TABLE IF NOT EXISTS price_history (
  id BIGSERIAL PRIMARY KEY,
  place_id BIGINT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  product TEXT NOT NULL,
  price REAL NOT NULL,
  reported_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_alerts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id BIGINT REFERENCES places(id) ON DELETE SET NULL,
  product TEXT,
  target_price REAL,
  is_active INTEGER DEFAULT 1,
  triggered INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS badges (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, key)
);

CREATE TABLE IF NOT EXISTS favorites (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_id BIGINT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, place_id)
);

CREATE TABLE IF NOT EXISTS deals (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT,
  affiliate_url TEXT,
  original_price REAL,
  deal_price REAL,
  discount_percent REAL,
  store TEXT,
  category TEXT DEFAULT 'otros',
  image_url TEXT,
  reported_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ai_analysis TEXT,
  ai_score INTEGER,
  votes_up INTEGER DEFAULT 0,
  votes_down INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  detected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deal_votes (
  id BIGSERIAL PRIMARY KEY,
  deal_id BIGINT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(deal_id, user_id)
);

CREATE TABLE IF NOT EXISTS deal_comments (
  id BIGSERIAL PRIMARY KEY,
  deal_id BIGINT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  parent_id BIGINT REFERENCES deal_comments(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  votes_up INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  venue TEXT, address TEXT, city TEXT DEFAULT '',
  lat REAL, lng REAL,
  price REAL, price_from REAL, price_label TEXT,
  is_free INTEGER DEFAULT 0,
  date TEXT NOT NULL, time TEXT,
  url TEXT, description TEXT,
  source TEXT DEFAULT 'user',
  reported_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  votes_up INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id BIGSERIAL PRIMARY KEY,
  deal_id BIGINT,
  store TEXT,
  original_url TEXT,
  affiliate_url TEXT,
  clicked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_deals (
  id BIGSERIAL PRIMARY KEY,
  bank_name TEXT NOT NULL,
  product_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  interest_rate REAL,
  bonus_amount REAL,
  conditions TEXT,
  url TEXT,
  affiliate_url TEXT,
  is_verified INTEGER DEFAULT 0,
  votes_up INTEGER DEFAULT 0,
  votes_down INTEGER DEFAULT 0,
  expires_at TEXT,
  source TEXT DEFAULT 'user',
  reported_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_resets (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_prices_place    ON prices(place_id);
CREATE INDEX IF NOT EXISTS idx_prices_product  ON prices(product);
CREATE INDEX IF NOT EXISTS idx_prices_active   ON prices(is_active);
CREATE INDEX IF NOT EXISTS idx_deals_category  ON deals(category);
CREATE INDEX IF NOT EXISTS idx_deals_active    ON deals(is_active);
CREATE INDEX IF NOT EXISTS idx_events_date     ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_active   ON events(is_active);
CREATE INDEX IF NOT EXISTS idx_places_city     ON places(city);
CREATE INDEX IF NOT EXISTS idx_places_cat      ON places(category);
CREATE INDEX IF NOT EXISTS idx_notifs_user     ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_comments_deal   ON deal_comments(deal_id);
CREATE INDEX IF NOT EXISTS idx_badges_user     ON badges(user_id);

-- ============================================================
-- RPC FUNCTIONS (needed by server.js)
-- ============================================================

-- Increment user points atomically
CREATE OR REPLACE FUNCTION increment_points(uid BIGINT, pts INTEGER)
RETURNS void AS $$
  UPDATE users SET points = points + pts WHERE id = uid;
$$ LANGUAGE sql SECURITY DEFINER;

-- Deal vote adjust
CREATE OR REPLACE FUNCTION deal_vote_adjust(did BIGINT, delta INTEGER)
RETURNS void AS $$
  UPDATE deals SET
    votes_up   = GREATEST(0, votes_up   + CASE WHEN delta > 0 THEN delta ELSE 0 END),
    votes_down = GREATEST(0, votes_down + CASE WHEN delta < 0 THEN ABS(delta) ELSE 0 END)
  WHERE id = did;
$$ LANGUAGE sql SECURITY DEFINER;

-- Price vote adjust
CREATE OR REPLACE FUNCTION price_vote_adjust(pid BIGINT, delta INTEGER)
RETURNS void AS $$
  UPDATE prices SET
    votes_up   = GREATEST(0, votes_up   + CASE WHEN delta > 0 THEN delta ELSE 0 END),
    votes_down = GREATEST(0, votes_down + CASE WHEN delta < 0 THEN ABS(delta) ELSE 0 END)
  WHERE id = pid;
$$ LANGUAGE sql SECURITY DEFINER;

-- Comment upvote
CREATE OR REPLACE FUNCTION comment_vote_up(cid BIGINT)
RETURNS void AS $$
  UPDATE deal_comments SET votes_up = votes_up + 1 WHERE id = cid;
$$ LANGUAGE sql SECURITY DEFINER;

-- Event upvote
CREATE OR REPLACE FUNCTION event_vote_up(eid BIGINT)
RETURNS void AS $$
  UPDATE events SET votes_up = votes_up + 1 WHERE id = eid;
$$ LANGUAGE sql SECURITY DEFINER;

-- Bank vote adjust
CREATE OR REPLACE FUNCTION bank_vote_adjust(bid BIGINT, delta INTEGER)
RETURNS void AS $$
  UPDATE bank_deals SET
    votes_up   = GREATEST(0, votes_up   + CASE WHEN delta > 0 THEN delta ELSE 0 END),
    votes_down = GREATEST(0, votes_down + CASE WHEN delta < 0 THEN ABS(delta) ELSE 0 END)
  WHERE id = bid;
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
-- STORAGE BUCKET
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('precimap', 'precimap', true)
ON CONFLICT DO NOTHING;

-- Storage policy: allow all reads (public bucket)
CREATE POLICY "Public read" ON storage.objects
  FOR SELECT USING (bucket_id = 'precimap');

-- Storage policy: allow authenticated uploads
CREATE POLICY "Auth upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'precimap');

CREATE POLICY "Auth update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'precimap');

-- ============================================================
SELECT 'PreciMap v3.0 schema ready ✅' AS status;
