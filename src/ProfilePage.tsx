import { useState, useRef } from 'react';
import { X, TrendingUp, Award, BookOpen, Target, Star, Clock, BarChart2, Zap, ChevronRight, Camera, Check, Pencil } from 'lucide-react';
import type { LearningContext, LearningSession } from './supabase';
import { updateProfile } from './supabase';

// ── Types ─────────────────────────────────────────────────────────────────────
type ProfileTab = 'profile' | 'progress' | 'history' | 'achievements';

interface ProfilePageProps {
  context: LearningContext;
  bg: string;
  card: string;
  panelGlass: string;
  totalCorrections: number;
  initialTab?: ProfileTab;
  onClose: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
  onProfileUpdated: (displayName: string | null, avatarData: string | null) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const LEVEL_COLOR: Record<string, string> = {
  A1: '#6366f1', A2: '#8b5cf6', B1: '#3b82f6',
  B2: '#06b6d4', C1: '#10b981', C2: '#f59e0b',
};

const SKILL_KEYS: Array<{ key: keyof LearningSession; label: string; emoji: string }> = [
  { key: 'communication_score', label: 'Communication',  emoji: '💬' },
  { key: 'vocabulary_score',    label: 'Vocabulary',     emoji: '📖' },
  { key: 'grammar_score',       label: 'Grammar',        emoji: '✏️' },
  { key: 'verb_tense_score',    label: 'Verb Tenses',    emoji: '⏰' },
  { key: 'fluency_score',       label: 'Fluency',        emoji: '🌊' },
  { key: 'confidence_score',    label: 'Confidence',     emoji: '⭐' },
  { key: 'pronunciation_score', label: 'Pronunciation',  emoji: '🎤' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function avgSkill(sessions: LearningSession[], key: keyof LearningSession): number | null {
  const vals = sessions
    .map(s => s[key] as number | null)
    .filter((v): v is number => v !== null);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

function scoreColor(v: number) {
  if (v >= 8) return '#10b981';
  if (v >= 6) return '#f59e0b';
  return '#ef4444';
}

function scoreLabel(v: number) {
  if (v >= 9) return 'Excellent';
  if (v >= 8) return 'Very Good';
  if (v >= 7) return 'Good';
  if (v >= 6) return 'Fair';
  return 'Needs Work';
}

// ── Component ─────────────────────────────────────────────────────────────────
// ── Image compress helper ─────────────────────────────────────────────────────
async function compressImage(file: File, size = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      // Crop to square from center
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = reject;
    img.src = url;
  });
}

export function ProfilePage({
  context, bg, card, panelGlass,
  totalCorrections, initialTab = 'profile', onClose, onOpenSettings, onSignOut, onProfileUpdated,
}: ProfilePageProps) {
  const { profile, passport, recentSessions, gaps, strengths } = context;

  // ── Editable profile state ──
  const [activeTab, setActiveTab]     = useState<ProfileTab>(initialTab);
  const [displayName, setDisplayName] = useState(profile.display_name ?? '');
  const [avatarData, setAvatarData]   = useState<string | null>(profile.avatar_data ?? null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSaving, setIsSaving]       = useState(false);
  const [saveOk, setSaveOk]           = useState(false);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoClick = () => fileInputRef.current?.click();

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setAvatarData(compressed);
      // Save immediately on photo change
      setIsSaving(true);
      await updateProfile(profile.id, { avatar_data: compressed });
      onProfileUpdated(displayName || null, compressed);
    } catch { /* ignore */ } finally {
      setIsSaving(false);
      e.target.value = '';
    }
  };

  const handleSaveName = async () => {
    setIsSaving(true);
    try {
      const name = displayName.trim() || null;
      await updateProfile(profile.id, { display_name: name ?? undefined });
      onProfileUpdated(name, avatarData);
      setSaveOk(true);
      setIsEditingName(false);
      setTimeout(() => setSaveOk(false), 2000);
    } catch { /* ignore */ } finally {
      setIsSaving(false);
    }
  };

  const sessions    = passport?.sessions_completed ?? 0;
  const words       = passport?.words_learned ?? 0;
  const level       = passport?.current_level ?? profile.current_level ?? 'A2';
  const targetLevel = profile.target_level ?? 'B2';
  const levelIdx    = LEVELS.indexOf(level);
  const targetIdx   = LEVELS.indexOf(targetLevel);

  const overallScores = recentSessions.map(s => s.overall_score).filter((v): v is number => v !== null);
  const avgOverall    = overallScores.length
    ? Math.round(overallScores.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, overallScores.length))
    : 0;

  const levelProgress = sessions === 0 ? 0
    : Math.min(100, Math.round(avgOverall * 0.55 + Math.min(sessions, 30) / 30 * 45));

  const hours = Math.round(sessions * 0.5);

  const skills = SKILL_KEYS.map(sk => ({
    ...sk,
    score: avgSkill(recentSessions, sk.key),
  }));

  // Member since
  const memberSince = (() => {
    try {
      const d = new Date((profile as any).created_at);
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } catch { return 'Recently joined'; }
  })();

  // Achievements
  const achievements = [
    { emoji: '🥇', title: 'First Conversation',   unlocked: sessions >= 1,  desc: 'Your learning journey began.' },
    { emoji: '🔥', title: '5 Sessions',            unlocked: sessions >= 5,  desc: 'Consistency is building.' },
    { emoji: '🥈', title: '10 Sessions',           unlocked: sessions >= 10, desc: 'Serious commitment shown.' },
    { emoji: '🥉', title: '25 Sessions',           unlocked: sessions >= 25, desc: 'Dedicated student.' },
    { emoji: '🏅', title: '50 Sessions',           unlocked: sessions >= 50, desc: 'Learning champion.' },
    { emoji: '📚', title: '50 Words Learned',      unlocked: words >= 50,    desc: 'Vocabulary is growing.' },
    { emoji: '📖', title: '100 Words Learned',     unlocked: words >= 100,   desc: 'Vocabulary builder.' },
    { emoji: '🎤', title: '5 Hours Speaking',      unlocked: hours >= 5,     desc: 'Voice practice master.' },
    { emoji: '⭐', title: 'Score 80+',             unlocked: overallScores.some(s => s >= 80), desc: 'Excellent session.' },
    { emoji: '💎', title: 'Score 90+',             unlocked: overallScores.some(s => s >= 90), desc: 'Outstanding performance.' },
    { emoji: '🏆', title: `Reached ${level}`,     unlocked: levelIdx >= 1,  desc: 'Level milestone reached.' },
    { emoji: '🚀', title: `Reached ${LEVELS[Math.min(levelIdx + 1, 5)]}`, unlocked: levelIdx >= 2, desc: 'Moving up!' },
  ];
  const unlocked = achievements.filter(a => a.unlocked);
  const locked   = achievements.filter(a => !a.unlocked);

  // Auto insights
  const insights: string[] = [];
  if (recentSessions.length >= 4) {
    const rec = overallScores.slice(0, 3);
    const old = overallScores.slice(3, 6);
    if (old.length) {
      const diff = Math.round(rec.reduce((a, b) => a + b, 0) / rec.length - old.reduce((a, b) => a + b, 0) / old.length);
      if (diff > 2) insights.push(`📈 Overall score improved by ${diff} points in your recent sessions.`);
      else if (diff < -2) insights.push(`📌 Overall score dipped slightly — keep practicing consistently.`);
      else insights.push(`➡ Your performance has been stable across recent sessions.`);
    }
  }
  const bestSkill  = [...skills].filter(s => s.score !== null).sort((a, b) => b.score! - a.score!)[0];
  const worstSkill = [...skills].filter(s => s.score !== null).sort((a, b) => a.score! - b.score!)[0];
  if (bestSkill?.score)  insights.push(`💪 ${bestSkill.label} is your strongest skill (${bestSkill.score}/10) — great asset.`);
  if (worstSkill?.score) insights.push(`🎯 ${worstSkill.label} (${worstSkill.score}/10) is your top improvement opportunity.`);
  if (gaps.length)       insights.push(`📌 ${gaps[0].topic_name} has come up ${gaps[0].frequency}× — your highest-priority focus area.`);
  if (sessions > 0)      insights.push(`🎓 ${sessions} session${sessions !== 1 ? 's' : ''} completed. Every conversation counts!`);

  // Predefined goals
  const goals = [
    {
      title: `Reach ${targetLevel}`,
      desc: `Progress from ${level} to ${targetLevel}`,
      progress: levelIdx >= targetIdx ? 100 : Math.round(levelProgress * (levelIdx / Math.max(1, targetIdx))),
      icon: '🎯',
    },
    {
      title: 'Improve Grammar',
      desc: 'Achieve 8/10 in Grammar',
      progress: Math.min(100, Math.round(((avgSkill(recentSessions, 'grammar_score') ?? 0) / 10) * 100)),
      icon: '✏️',
    },
    {
      title: 'Build Fluency',
      desc: 'Achieve 8/10 in Fluency',
      progress: Math.min(100, Math.round(((avgSkill(recentSessions, 'fluency_score') ?? 0) / 10) * 100)),
      icon: '🌊',
    },
    {
      title: 'Expand Vocabulary',
      desc: '100 words learned',
      progress: Math.min(100, Math.round((words / 100) * 100)),
      icon: '📖',
    },
  ];

  const sectionCard = `rounded-2xl p-4 border border-slate-700/40`;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: bg }}>

      {/* Sticky header + tabs */}
      <div className="sticky top-0 z-10 border-b border-slate-800/50 backdrop-blur" style={{ background: panelGlass }}>
        <div className="flex items-center gap-3 px-5 py-3.5">
          <button onClick={onClose}
            className="p-2 rounded-xl border border-slate-700/50 bg-slate-800/60 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
          <span className="font-bold text-white text-sm flex-1">
            {activeTab === 'profile' ? 'My Profile' : activeTab === 'progress' ? 'Learning Progress' : activeTab === 'history' ? 'Session History' : 'Achievements'}
          </span>
          <button onClick={() => { onOpenSettings(); onClose(); }}
            className="text-xs text-slate-500 hover:text-indigo-400 transition-colors px-2">
            Settings
          </button>
        </div>
        {/* Tab bar */}
        <div className="flex px-4 gap-1 pb-0.5 overflow-x-auto">
          {([
            { id: 'profile',      label: 'Profile',     icon: '👤' },
            { id: 'progress',     label: 'Progress',    icon: '📈' },
            { id: 'history',      label: 'History',     icon: '🕒' },
            { id: 'achievements', label: 'Achievements',icon: '🏆' },
          ] as const).map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg whitespace-nowrap transition-colors border-b-2 ${
                activeTab === tab.id
                  ? 'text-indigo-300 border-indigo-500'
                  : 'text-slate-500 border-transparent hover:text-slate-300'
              }`}>
              <span>{tab.icon}</span>{tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4 pb-10">

        {/* ══ TAB: PROFILE ════════════════════════════════════════════════════ */}
        {activeTab === 'profile' && <>

        {/* ── Profile Header ───────────────────────────────────────────────── */}
        <div className={`${sectionCard} flex flex-col gap-4`} style={{ background: card }}>

          {/* Avatar + basic info row */}
          <div className="flex items-center gap-4">
            {/* Clickable avatar */}
            <div className="relative shrink-0 group">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
              />
              <button
                onClick={handlePhotoClick}
                className="w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center relative focus:outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ background: `linear-gradient(135deg, ${LEVEL_COLOR[level] ?? '#6366f1'}, ${LEVEL_COLOR[targetLevel] ?? '#8b5cf6'})` }}
                title="Click to change photo"
              >
                {avatarData ? (
                  <img src={avatarData} alt="profile" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl font-bold text-white">{profile.email[0].toUpperCase()}</span>
                )}
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera className="w-5 h-5 text-white" />
                </div>
              </button>
              {isSaving && (
                <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-slate-900 flex items-center justify-center">
                  <div className="w-3 h-3 rounded-full border border-indigo-400 border-t-transparent animate-spin" />
                </div>
              )}
              {saveOk && (
                <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-600 flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-white" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-400 mb-2">{profile.email}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                  style={{ background: LEVEL_COLOR[level] ?? '#6366f1' }}>
                  {level} — Current
                </span>
                <span className="text-[10px] font-bold text-indigo-400 border border-indigo-500/40 px-2 py-0.5 rounded-full">
                  Target: {targetLevel}
                </span>
              </div>
              <p className="text-[9px] text-slate-600 mt-1.5">Member since {memberSince}</p>
            </div>
          </div>

          {/* Editable name row */}
          <div className="border-t border-slate-700/40 pt-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Your name (Luna will use it)</p>
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setIsEditingName(false); }}
                  placeholder="Your first name..."
                  maxLength={40}
                  className="flex-1 px-3 py-2 rounded-xl text-sm text-slate-200 placeholder-slate-600 border border-slate-600/60 focus:outline-none focus:border-indigo-500/60 transition-colors"
                  style={{ background: 'rgba(15,23,42,0.6)' }}
                />
                <button
                  onClick={handleSaveName}
                  disabled={isSaving}
                  className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold transition-colors flex items-center gap-1">
                  {isSaving ? <div className="w-3 h-3 rounded-full border border-white/30 border-t-white animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save
                </button>
                <button onClick={() => setIsEditingName(false)} className="px-2 py-2 text-slate-500 hover:text-slate-300 text-xs">✕</button>
              </div>
            ) : (
              <button
                onClick={() => setIsEditingName(true)}
                className="flex items-center gap-2 group w-full text-left">
                <span className={`text-base font-bold ${displayName ? 'text-white' : 'text-slate-600 italic'}`}>
                  {displayName || 'Add your name…'}
                </span>
                <Pencil className="w-3.5 h-3.5 text-slate-600 group-hover:text-indigo-400 transition-colors" />
                {saveOk && <Check className="w-3.5 h-3.5 text-emerald-400" />}
              </button>
            )}
          </div>
        </div>

        {/* ── Stats Grid ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: <BarChart2 className="w-4 h-4" />, value: sessions, label: 'Sessions', color: '#6366f1' },
            { icon: <Clock className="w-4 h-4" />, value: `${hours}h`, label: 'Hours Practiced', color: '#3b82f6' },
            { icon: <BookOpen className="w-4 h-4" />, value: words, label: 'Words Learned', color: '#10b981' },
            { icon: <Target className="w-4 h-4" />, value: totalCorrections, label: 'Corrections', color: '#f59e0b' },
          ].map(({ icon, value, label, color }) => (
            <div key={label} className={`${sectionCard} flex flex-col items-center gap-2 text-center`} style={{ background: card }}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: color + '22', color }}>
                {icon}
              </div>
              <span className="text-2xl font-bold text-white">{value}</span>
              <span className="text-[10px] text-slate-500 leading-tight">{label}</span>
            </div>
          ))}
        </div>

        </>}

        {/* ══ TAB: PROGRESS (level + skills + focus + goals + insights) ═══════ */}
        {activeTab === 'progress' && <>

        {/* ── Level Progress ───────────────────────────────────────────────── */}
        <div className={sectionCard} style={{ background: card }}>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-indigo-400" />
            <span className="text-sm font-bold text-white">English Journey</span>
            <span className="ml-auto text-xs text-indigo-400 font-semibold">{levelProgress}%</span>
          </div>

          {/* Level track */}
          <div className="flex items-center gap-1 mb-3">
            {LEVELS.map((l, i) => (
              <div key={l} className="flex-1 flex flex-col items-center gap-1">
                <div className={`w-full h-2 rounded-full transition-all ${
                  i < levelIdx ? 'opacity-100' : i === levelIdx ? 'opacity-100' : 'opacity-20'
                }`} style={{ background: i <= levelIdx ? (LEVEL_COLOR[l] ?? '#6366f1') : '#334155' }} />
                <span className={`text-[8px] font-bold ${i === levelIdx ? 'text-white' : i < levelIdx ? 'text-slate-400' : 'text-slate-700'}`}>{l}</span>
              </div>
            ))}
          </div>

          {/* Progress within current level */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>{level}</span>
              <span>{levelProgress}% toward {LEVELS[Math.min(levelIdx + 1, 5)]}</span>
            </div>
            <div className="h-3 rounded-full bg-slate-800/60 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${levelProgress}%`, background: `linear-gradient(90deg, ${LEVEL_COLOR[level] ?? '#6366f1'}, ${LEVEL_COLOR[LEVELS[Math.min(levelIdx + 1, 5)]] ?? '#8b5cf6'})` }} />
            </div>
            <p className="text-[10px] text-slate-500 text-center">
              {sessions === 0 ? 'Start your first session to begin tracking progress' :
               levelProgress >= 80 ? `🎉 Almost ready for ${LEVELS[Math.min(levelIdx + 1, 5)]}!` :
               `Keep practicing — you're making progress!`}
            </p>
          </div>
        </div>

        {/* ── Skill Dashboard ──────────────────────────────────────────────── */}
        <div className={sectionCard} style={{ background: card }}>
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 className="w-4 h-4 text-indigo-400" />
            <span className="text-sm font-bold text-white">Skill Dashboard</span>
            {sessions === 0 && <span className="text-[10px] text-slate-600 ml-auto">— complete a session to see scores</span>}
          </div>
          <div className="space-y-3">
            {skills.map(({ label, emoji, score }) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-300 flex items-center gap-1.5">
                    <span>{emoji}</span>{label}
                  </span>
                  <div className="flex items-center gap-2">
                    {score !== null && (
                      <span className="text-[9px] font-semibold" style={{ color: scoreColor(score) }}>
                        {scoreLabel(score)}
                      </span>
                    )}
                    <span className="text-xs font-bold text-white w-8 text-right">
                      {score !== null ? `${score}/10` : '—'}
                    </span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-slate-800/60 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: score !== null ? `${score * 10}%` : '0%',
                      background: score !== null
                        ? `linear-gradient(90deg, ${scoreColor(score)}, ${scoreColor(score)}99)`
                        : 'transparent',
                    }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Focus Areas + Strengths (side by side on desktop) ───────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

          {/* Focus Areas */}
          <div className={sectionCard} style={{ background: card }}>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-bold text-white">Current Focus</span>
            </div>
            {gaps.length === 0 ? (
              <p className="text-xs text-slate-600">No weaknesses detected yet.</p>
            ) : (
              <div className="space-y-2">
                {gaps.slice(0, 5).map((gap, i) => (
                  <div key={gap.id} className="flex items-center gap-2">
                    <span className="text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: i === 0 ? '#ef444422' : i === 1 ? '#f59e0b22' : '#6366f122', color: i === 0 ? '#ef4444' : i === 1 ? '#f59e0b' : '#818cf8' }}>
                      {i + 1}
                    </span>
                    <span className="text-xs text-slate-300 flex-1 truncate">{gap.topic_name}</span>
                    <span className="text-[9px] text-slate-600 shrink-0">{gap.frequency}×</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Strengths */}
          <div className={sectionCard} style={{ background: card }}>
            <div className="flex items-center gap-2 mb-3">
              <Star className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-bold text-white">Strengths</span>
            </div>
            {strengths.length === 0 ? (
              <p className="text-xs text-slate-600">Complete sessions to discover your strengths.</p>
            ) : (
              <div className="space-y-2">
                {strengths.slice(0, 5).map(s => (
                  <div key={s.id} className="flex items-center justify-between">
                    <span className="text-xs text-emerald-300">{s.skill_name}</span>
                    <div className="flex items-center gap-1">
                      {[...Array(Math.min(5, Math.round((s.strength_score / 10) * 5)))].map((_, i) => (
                        <div key={i} className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      ))}
                      {[...Array(Math.max(0, 5 - Math.round((s.strength_score / 10) * 5)))].map((_, i) => (
                        <div key={i} className="w-1.5 h-1.5 rounded-full bg-slate-700" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Learning Goals ───────────────────────────────────────────────── */}
        <div className={sectionCard} style={{ background: card }}>
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-4 h-4 text-violet-400" />
            <span className="text-sm font-bold text-white">Learning Goals</span>
          </div>
          <div className="space-y-3">
            {goals.map(goal => (
              <div key={goal.title}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-300 flex items-center gap-1.5">
                    <span>{goal.icon}</span>{goal.title}
                  </span>
                  <span className="text-xs font-bold text-indigo-400">{goal.progress}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-800/60 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500"
                    style={{ width: `${goal.progress}%` }} />
                </div>
                <p className="text-[10px] text-slate-600 mt-0.5">{goal.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Progress Insights (moved here from bottom) ──────────────────── */}
        {insights.length > 0 && (
          <div className={sectionCard} style={{ background: card }}>
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-indigo-400" />
              <span className="text-sm font-bold text-white">Progress Insights</span>
            </div>
            <div className="space-y-2">
              {insights.map((insight, i) => (
                <p key={i} className="text-xs text-slate-300 leading-relaxed py-1.5 border-b border-slate-800/40 last:border-0">
                  {insight}
                </p>
              ))}
            </div>
          </div>
        )}

        </>}

        {/* ══ TAB: HISTORY ════════════════════════════════════════════════════ */}
        {activeTab === 'history' && <>

        {/* ── Session History ──────────────────────────────────────────────── */}
        {recentSessions.length > 0 && (
          <div className={sectionCard} style={{ background: card }}>
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-bold text-white">Session History</span>
              <span className="ml-auto text-[10px] text-slate-600">last {Math.min(5, recentSessions.length)} sessions</span>
            </div>
            <div className="space-y-2">
              {recentSessions.slice(0, 5).map((s) => {
                const date = new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                const score = s.overall_score;
                const isExpanded = expandedSession === s.id;
                const hasReport = Boolean(s.report_text);
                return (
                  <div key={s.id} className="rounded-xl overflow-hidden border border-slate-700/30">
                    {/* Row header — click to expand if report available */}
                    <button
                      onClick={() => hasReport && setExpandedSession(isExpanded ? null : s.id)}
                      className={`w-full flex items-center gap-3 p-2.5 text-left transition-colors ${hasReport ? 'hover:bg-slate-700/30 cursor-pointer' : 'cursor-default'} bg-slate-800/40`}
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                        style={{ background: score !== null ? scoreColor(score / 10) + '33' : '#1e293b', color: score !== null ? scoreColor(score / 10) : '#64748b' }}>
                        {score ?? '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-300">{date}</span>
                          {score !== null && (
                            <div className="flex items-center gap-1.5">
                              <div className="h-1.5 w-16 rounded-full bg-slate-700 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${score}%`, background: scoreColor(score / 10) }} />
                              </div>
                              <span className="text-[10px] font-semibold" style={{ color: scoreColor(score / 10) }}>{score}</span>
                            </div>
                          )}
                        </div>
                        {s.next_focus && (
                          <p className="text-[10px] text-slate-600 truncate mt-0.5 text-left">Focus: {s.next_focus}</p>
                        )}
                      </div>
                      {hasReport && (
                        <ChevronRight className={`w-3.5 h-3.5 text-slate-600 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      )}
                    </button>

                    {/* Expanded report */}
                    {isExpanded && s.report_text && (
                      <div className="px-4 py-3 border-t border-slate-700/30 bg-slate-900/40">
                        <pre className="text-[11px] text-slate-300 whitespace-pre-wrap leading-relaxed font-sans">
                          {s.report_text}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        </>}

        {/* ══ TAB: ACHIEVEMENTS ═══════════════════════════════════════════════ */}
        {activeTab === 'achievements' && <>

        {/* ── Achievements ─────────────────────────────────────────────────── */}
        <div className={sectionCard} style={{ background: card }}>
          <div className="flex items-center gap-2 mb-4">
            <Award className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-bold text-white">Achievements</span>
            <span className="ml-auto text-[10px] text-amber-400 font-semibold">
              {unlocked.length}/{achievements.length}
            </span>
          </div>

          {/* Unlocked */}
          {unlocked.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              {unlocked.map(a => (
                <div key={a.title} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-amber-950/20 border border-amber-700/20">
                  <span className="text-2xl leading-none">{a.emoji}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-amber-300 truncate">{a.title}</p>
                    <p className="text-[9px] text-slate-600 truncate">{a.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Locked */}
          {locked.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {locked.slice(0, 4).map(a => (
                <div key={a.title} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-800/30 border border-slate-700/20 opacity-40">
                  <span className="text-2xl leading-none grayscale">{a.emoji}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-400 truncate">{a.title}</p>
                    <p className="text-[9px] text-slate-600 truncate">{a.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Sign Out ─────────────────────────────────────────────────────── */}
        <button
          onClick={onSignOut}
          className="w-full py-3 rounded-2xl border border-rose-500/20 text-rose-400 text-sm font-semibold hover:bg-rose-500/10 transition-colors flex items-center justify-center gap-2">
          Sign Out
          <ChevronRight className="w-4 h-4" />
        </button>

        </>}

      </div>
    </div>
  );
}
