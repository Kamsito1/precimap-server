-- Migration: Add google_id column to users table for Google Sign-In
-- Run this in Supabase SQL Editor

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT;
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
