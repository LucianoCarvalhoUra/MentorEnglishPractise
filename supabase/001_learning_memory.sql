-- MentorStudy — Learning Memory Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- ── Student Profiles ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_profiles (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL,
  display_name    TEXT,
  native_language TEXT DEFAULT 'Portuguese',
  current_level   TEXT DEFAULT 'A2',
  target_level    TEXT DEFAULT 'B2',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Learning Sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_sessions (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id           UUID REFERENCES student_profiles(id) ON DELETE CASCADE,
  session_date         TIMESTAMPTZ DEFAULT NOW(),
  overall_score        INTEGER,
  communication_score  INTEGER,
  vocabulary_score     INTEGER,
  grammar_score        INTEGER,
  verb_tense_score     INTEGER,
  fluency_score        INTEGER,
  confidence_score     INTEGER,
  pronunciation_score  INTEGER,
  summary              TEXT,
  next_focus           TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── Learning Gaps (recurring weaknesses) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_gaps (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id    UUID REFERENCES student_profiles(id) ON DELETE CASCADE,
  topic_name    TEXT NOT NULL,
  frequency     INTEGER DEFAULT 1,
  severity      TEXT DEFAULT 'medium',
  last_detected TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (student_id, topic_name)
);

-- ── Learning Strengths ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_strengths (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id     UUID REFERENCES student_profiles(id) ON DELETE CASCADE,
  skill_name     TEXT NOT NULL,
  strength_score INTEGER DEFAULT 5,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (student_id, skill_name)
);

-- ── Student Vocabulary ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_vocabulary (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id    UUID REFERENCES student_profiles(id) ON DELETE CASCADE,
  word          TEXT NOT NULL,
  category      TEXT,
  mastery_score INTEGER DEFAULT 1,
  first_seen    TIMESTAMPTZ DEFAULT NOW(),
  last_seen     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (student_id, word)
);

-- ── Learning Passport (overall progress) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS learning_passport (
  student_id          UUID PRIMARY KEY REFERENCES student_profiles(id) ON DELETE CASCADE,
  sessions_completed  INTEGER DEFAULT 0,
  words_learned       INTEGER DEFAULT 0,
  current_level       TEXT DEFAULT 'A2',
  target_level        TEXT DEFAULT 'B2',
  progress_percentage INTEGER DEFAULT 0,
  strongest_skill     TEXT,
  weakest_skill       TEXT,
  last_updated        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE student_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_gaps       ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_strengths  ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_vocabulary  ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_passport   ENABLE ROW LEVEL SECURITY;

-- Allow anon key to read/write all records (app controls access by email)
CREATE POLICY "anon_all" ON student_profiles   FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON learning_sessions  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON learning_gaps      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON learning_strengths FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON student_vocabulary FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all" ON learning_passport  FOR ALL TO anon USING (true) WITH CHECK (true);
