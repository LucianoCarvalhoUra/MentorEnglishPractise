import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!)
  : null;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StudentProfile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_data: string | null;
  native_language: string;
  current_level: string;
  target_level: string;
}

export interface LearningPassport {
  student_id: string;
  sessions_completed: number;
  words_learned: number;
  current_level: string;
  target_level: string;
  progress_percentage: number;
  strongest_skill: string | null;
  weakest_skill: string | null;
  last_updated: string;
}

export interface LearningSession {
  id: string;
  student_id: string;
  overall_score: number | null;
  communication_score: number | null;
  vocabulary_score: number | null;
  grammar_score: number | null;
  verb_tense_score: number | null;
  fluency_score: number | null;
  confidence_score: number | null;
  pronunciation_score: number | null;
  summary: string | null;
  next_focus: string | null;
  report_text: string | null;
  created_at: string;
}

export interface LearningGap {
  id: string;
  topic_name: string;
  frequency: number;
  severity: string;
  last_detected: string;
}

export interface LearningStrength {
  id: string;
  skill_name: string;
  strength_score: number;
}

export interface LearningContext {
  profile: StudentProfile;
  passport: LearningPassport | null;
  recentSessions: LearningSession[];
  gaps: LearningGap[];
  strengths: LearningStrength[];
}

export interface SessionScores {
  overall: number | null;
  communication: number | null;
  vocabulary: number | null;
  grammar: number | null;
  verbTense: number | null;
  fluency: number | null;
  confidence: number | null;
  pronunciation: number | null;
  nextFocus: string;
  summary: string;
  reportText: string;
}

// ── Profile ────────────────────────────────────────────────────────────────────

export async function updateProfile(
  id: string,
  updates: { display_name?: string; avatar_data?: string },
): Promise<void> {
  if (!supabase) return;
  await supabase.from('student_profiles').update(updates).eq('id', id);
}

export async function getOrCreateProfile(email: string): Promise<StudentProfile> {
  if (!supabase) throw new Error('Supabase not configured');
  const normalizedEmail = email.toLowerCase().trim();

  const { data: existing } = await supabase
    .from('student_profiles')
    .select('*')
    .eq('email', normalizedEmail)
    .single();

  if (existing) return existing as StudentProfile;

  const { data: created, error } = await supabase
    .from('student_profiles')
    .insert({ email: normalizedEmail })
    .select()
    .single();

  if (error || !created) throw new Error(error?.message ?? 'Failed to create profile');

  await supabase.from('learning_passport').insert({ student_id: created.id });

  return created as StudentProfile;
}

// ── Learning Context ───────────────────────────────────────────────────────────

export async function loadLearningContext(studentId: string): Promise<LearningContext | null> {
  if (!supabase) return null;
  try {
    const [profileRes, passportRes, sessionsRes, gapsRes, strengthsRes] = await Promise.all([
      supabase.from('student_profiles').select('*').eq('id', studentId).single(),
      supabase.from('learning_passport').select('*').eq('student_id', studentId).single(),
      supabase.from('learning_sessions').select('*').eq('student_id', studentId)
        .order('created_at', { ascending: false }).limit(10),
      supabase.from('learning_gaps').select('*').eq('student_id', studentId)
        .order('frequency', { ascending: false }).limit(8),
      supabase.from('learning_strengths').select('*').eq('student_id', studentId)
        .order('strength_score', { ascending: false }).limit(5),
    ]);

    if (!profileRes.data) return null;

    return {
      profile: profileRes.data as StudentProfile,
      passport: passportRes.data as LearningPassport | null,
      recentSessions: (sessionsRes.data ?? []) as LearningSession[],
      gaps: (gapsRes.data ?? []) as LearningGap[],
      strengths: (strengthsRes.data ?? []) as LearningStrength[],
    };
  } catch {
    return null;
  }
}

// ── Session Save ───────────────────────────────────────────────────────────────

export async function saveSessionData(studentId: string, scores: SessionScores): Promise<void> {
  if (!supabase) return;
  // 1. Save session record
  await supabase.from('learning_sessions').insert({
    student_id: studentId,
    overall_score: scores.overall,
    communication_score: scores.communication,
    vocabulary_score: scores.vocabulary,
    grammar_score: scores.grammar,
    verb_tense_score: scores.verbTense,
    fluency_score: scores.fluency,
    confidence_score: scores.confidence,
    pronunciation_score: scores.pronunciation,
    summary: scores.summary || null,
    report_text: scores.reportText || null,
    next_focus: scores.nextFocus || null,
  });

  // 2. Identify weak and strong skills (threshold: < 7 weak, >= 8 strong)
  const skillMap: Array<{ key: keyof SessionScores; label: string }> = [
    { key: 'communication', label: 'Communication' },
    { key: 'vocabulary',    label: 'Vocabulary' },
    { key: 'grammar',       label: 'Grammar' },
    { key: 'verbTense',     label: 'Verb Tenses' },
    { key: 'fluency',       label: 'Fluency' },
    { key: 'confidence',    label: 'Confidence' },
    { key: 'pronunciation', label: 'Pronunciation' },
  ];

  const weakSkills  = skillMap.filter(s => (scores[s.key] as number | null) !== null && (scores[s.key] as number) < 7);
  const strongSkills = skillMap.filter(s => (scores[s.key] as number | null) !== null && (scores[s.key] as number) >= 8);

  // 3. Update learning gaps (upsert — increment frequency)
  for (const skill of weakSkills) {
    const { data: existing } = await supabase
      .from('learning_gaps')
      .select('id, frequency')
      .eq('student_id', studentId)
      .eq('topic_name', skill.label)
      .single();

    if (existing) {
      await supabase.from('learning_gaps').update({
        frequency: existing.frequency + 1,
        last_detected: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await supabase.from('learning_gaps').insert({
        student_id: studentId,
        topic_name: skill.label,
        frequency: 1,
        severity: (scores[skill.key] as number) < 5 ? 'high' : 'medium',
      });
    }
  }

  // 4. Update learning strengths (upsert)
  for (const skill of strongSkills) {
    const score = scores[skill.key] as number;
    const { data: existing } = await supabase
      .from('learning_strengths')
      .select('id')
      .eq('student_id', studentId)
      .eq('skill_name', skill.label)
      .single();

    if (existing) {
      await supabase.from('learning_strengths').update({
        strength_score: score,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await supabase.from('learning_strengths').insert({
        student_id: studentId,
        skill_name: skill.label,
        strength_score: score,
      });
    }
  }

  // 5. Update passport
  const { data: passport } = await supabase
    .from('learning_passport')
    .select('sessions_completed')
    .eq('student_id', studentId)
    .single();

  const sortedWeak   = [...weakSkills].sort((a, b) => (scores[a.key] as number) - (scores[b.key] as number));
  const sortedStrong = [...strongSkills].sort((a, b) => (scores[b.key] as number) - (scores[a.key] as number));
  const sessionsCompleted = (passport?.sessions_completed ?? 0) + 1;

  await supabase.from('learning_passport').upsert({
    student_id: studentId,
    sessions_completed: sessionsCompleted,
    weakest_skill:   sortedWeak[0]?.label   ?? null,
    strongest_skill: sortedStrong[0]?.label ?? null,
    last_updated: new Date().toISOString(),
  });
}

// ── Score Parser ───────────────────────────────────────────────────────────────

export function parseReportScores(reportText: string): SessionScores {
  const skill = (name: string): number | null => {
    const m = reportText.match(new RegExp(`${name}\\s*\\.+\\s*(\\d+)/10`));
    return m ? parseInt(m[1]) : null;
  };

  const overallMatch  = reportText.match(/Overall Score:\s*(\d+)\/100/);
  const nextFocusMatch = reportText.match(/Next Focus:\s*([^\n]+)/);
  const summaryMatch  = reportText.match(/🌟 Coach['']s Summary\n([\s\S]+?)(?:\n---|$)/);

  return {
    overall:       overallMatch  ? parseInt(overallMatch[1])   : null,
    communication: skill('Communication'),
    vocabulary:    skill('Vocabulary'),
    grammar:       skill('Grammar'),
    verbTense:     skill('Verb Tenses'),
    fluency:       skill('Fluency'),
    confidence:    skill('Confidence'),
    pronunciation: skill('Pronunciation'),
    nextFocus:     nextFocusMatch ? nextFocusMatch[1].trim() : '',
    summary:       summaryMatch  ? summaryMatch[1].trim()    : '',
    reportText,
  };
}

// ── Learning Context Block (for system prompt) ─────────────────────────────────

export function buildLearningContextBlock(ctx: LearningContext | null): string {
  if (!ctx) return '';

  const { passport, recentSessions, gaps, strengths } = ctx;
  const sessions = passport?.sessions_completed ?? 0;
  const level    = passport?.current_level ?? ctx.profile.current_level ?? 'A2';
  const lastScore = recentSessions[0]?.overall_score;
  const nextFocus = recentSessions[0]?.next_focus;

  const topGaps = gaps.slice(0, 5).map(g => g.topic_name);
  const topStrengths = strengths.slice(0, 3).map(s => s.skill_name);

  const startingLevel = level === 'A1' ? 1 : level === 'A2' ? 1 : level === 'B1' ? 2 : level === 'B2' ? 3 : 3;

  return `
# Student Learning Memory — ${sessions} session${sessions !== 1 ? 's' : ''} completed
Current Level: ${level} → Target: ${ctx.profile.target_level ?? 'B2'}
${topStrengths.length ? `Strong Areas: ${topStrengths.join(', ')}` : ''}
${topGaps.length      ? `Recurring Weaknesses: ${topGaps.join(', ')}` : ''}
${lastScore != null   ? `Last Session Score: ${lastScore}/100` : ''}
${nextFocus           ? `Recommended Focus: ${nextFocus}` : ''}

SILENT PERSONALIZATION:
• Start questions at Level ${startingLevel} (based on current level)
• NEVER mention memory, scores, history, or learning data to the student
• Use weaknesses to naturally guide topic selection and grammar opportunities
• Use strengths to calibrate upper difficulty ceiling
• If Fluency is weak → use simpler, shorter questions
• If Confidence is weak → increase encouragement, reduce question difficulty
• Move toward Recommended Focus through natural conversation topics`.trim();
}
