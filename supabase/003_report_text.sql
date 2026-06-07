-- MentorStudy v1.2.5 — Add report_text column to learning_sessions
-- Run in Supabase Dashboard → SQL Editor

ALTER TABLE learning_sessions
  ADD COLUMN IF NOT EXISTS report_text TEXT;
