-- MentorStudy v1.2.2 — Add avatar_data column to student_profiles
-- Run in Supabase Dashboard → SQL Editor

ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS avatar_data TEXT;
