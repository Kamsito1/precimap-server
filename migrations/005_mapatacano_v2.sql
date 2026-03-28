-- ============================================================
-- MapaTacaño v2.0 — Migration
-- Adds new fields for enhanced Chollos, Places, Events
-- Run in: supabase.com/dashboard/project/hhmorsfzxuunzbndjdyt/sql/new
-- ============================================================

-- ─── DEALS: new fields for enhanced Chollos ──────────────────
-- Multiple images (JSONB array of URLs)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]';
-- Cover image index (which image is the cover, 0-based)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS cover_index INTEGER DEFAULT 0;
-- Description
ALTER TABLE deals ADD COLUMN IF NOT EXISTS description TEXT;
-- Discount code
ALTER TABLE deals ADD COLUMN IF NOT EXISTS discount_code TEXT;
-- Availability: 'online', 'tienda', 'ambos'
ALTER TABLE deals ADD COLUMN IF NOT EXISTS availability TEXT DEFAULT 'online';
-- Physical store location (if availability is 'tienda' or 'ambos')
ALTER TABLE deals ADD COLUMN IF NOT EXISTS store_location TEXT;
-- Start date (deals can have a start date)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;
-- Expiry date already exists as expires_at
-- Expire reports counter (community voting to mark as expired)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS expire_reports INTEGER DEFAULT 0;
-- Deleted timestamp
ALTER TABLE deals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ─── PLACES: price_range for non-gas places ──────────────────
-- Price range: 1=€, 2=€€, 3=€€€, 4=€€€€
ALTER TABLE places ADD COLUMN IF NOT EXISTS price_range INTEGER;
-- Subcategory for filtering (cafe, cerveza, restaurante_menu, etc.)
ALTER TABLE places ADD COLUMN IF NOT EXISTS subcategory TEXT;
-- Monthly fee for services like gyms
ALTER TABLE places ADD COLUMN IF NOT EXISTS monthly_fee REAL;
-- Verified by community votes
ALTER TABLE places ADD COLUMN IF NOT EXISTS verified_count INTEGER DEFAULT 0;
-- Google Place ID for enrichment
ALTER TABLE places ADD COLUMN IF NOT EXISTS google_place_id TEXT;
-- Photos JSONB array
ALTER TABLE places ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]';

-- ─── EVENTS: photos support ──────────────────────────────────
ALTER TABLE events ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]';
-- Province/region for filtering
ALTER TABLE events ADD COLUMN IF NOT EXISTS province TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS region TEXT;

-- ─── DEAL REPORTS (timo/scam reports) ────────────────────────
CREATE TABLE IF NOT EXISTS deal_reports (
  id BIGSERIAL PRIMARY KEY,
  deal_id BIGINT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT DEFAULT 'timo',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(deal_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_deal_reports_deal ON deal_reports(deal_id);

-- ─── PLACE VOTES (verify price range) ────────────────────────
CREATE TABLE IF NOT EXISTS place_votes (
  id BIGSERIAL PRIMARY KEY,
  place_id BIGINT NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(place_id, user_id)
);

-- ─── USER SETTINGS (notification preferences) ───────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_enabled INTEGER DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_region TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_city TEXT;

-- ─── NEW INDEXES ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_deals_starts ON deals(starts_at);
CREATE INDEX IF NOT EXISTS idx_deals_expires ON deals(expires_at);
CREATE INDEX IF NOT EXISTS idx_places_subcategory ON places(subcategory);
CREATE INDEX IF NOT EXISTS idx_places_price_range ON places(price_range);
CREATE INDEX IF NOT EXISTS idx_events_region ON events(region);
CREATE INDEX IF NOT EXISTS idx_events_province ON events(province);

-- ─── RPC: Increment expire reports ──────────────────────────
CREATE OR REPLACE FUNCTION deal_expire_report(did BIGINT)
RETURNS INTEGER AS $$
DECLARE
  new_count INTEGER;
BEGIN
  UPDATE deals SET expire_reports = COALESCE(expire_reports, 0) + 1 WHERE id = did
  RETURNING expire_reports INTO new_count;
  -- Auto-deactivate if 50+ reports
  IF new_count >= 50 THEN
    UPDATE deals SET is_active = 0 WHERE id = did;
  END IF;
  RETURN new_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── RPC: Increment place verified count ─────────────────────
CREATE OR REPLACE FUNCTION place_verify(pid BIGINT)
RETURNS void AS $$
  UPDATE places SET verified_count = COALESCE(verified_count, 0) + 1 WHERE id = pid;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT 'MapaTacaño v2.0 migration complete ✅' AS status;
