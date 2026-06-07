import { useState, useEffect, useRef } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Phone, PhoneOff, Sparkles, MessageSquare, Heart, Globe, BookOpen, X, Mic, MicOff, ChevronUp, Volume2, User, Settings, FileText, CheckCircle2, Copy } from 'lucide-react';

// Provider cascade: Groq (fastest, free) → OpenRouter (free) → Gemini (fallback)
const GROQ_KEY: string | undefined = import.meta.env.VITE_GROQ_API_KEY;
const OPENROUTER_KEY: string | undefined = import.meta.env.VITE_OPENROUTER_API_KEY;
const GEMINI_KEY: string | undefined = import.meta.env.VITE_GEMINI_API_KEY;

// Generic retry for transient errors (429 / 503)
async function retryOnRateLimit<T>(fn: () => Promise<T>, maxRetries = 1): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      const is429 = msg.includes('429');
      const is503 = msg.includes('503');
      if (!is429 && !is503) throw err;
      if (is503 || attempt === maxRetries) throw err;
      const match = msg.match(/retry in (\d+(?:\.\d+)?)s/i);
      const delaySec = match ? parseFloat(match[1]) : 2 ** attempt * 2;
      if (delaySec > 60) throw err;
      await new Promise(r => setTimeout(r, delaySec * 1000 + 500));
    }
  }
  throw new Error('Retries exhausted');
}

interface LLMMessage { role: 'user' | 'assistant'; content: string; }

async function callGroq(systemPrompt: string, messages: LLMMessage[], model = 'llama-3.1-8b-instant'): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      max_tokens: 350,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

async function callOpenRouter(systemPrompt: string, messages: LLMMessage[]): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'MentorStudy – Luna',
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.1-8b-instruct:free',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      max_tokens: 350,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

async function callGemini(systemPrompt: string, messages: LLMMessage[]): Promise<string> {
  const ai = new GoogleGenerativeAI(GEMINI_KEY!);
  const chatText = messages.map(m => `${m.role === 'user' ? 'Student' : 'Luna'}: ${m.content}`).join('\n');
  const finalPrompt = `${systemPrompt}\n\nHistory:\n${chatText}\nLuna:`;
  const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'];
  let lastErr: any;
  for (const modelName of MODELS) {
    try {
      const model = ai.getGenerativeModel({ model: modelName });
      const result = await retryOnRateLimit(() => model.generateContent(finalPrompt));
      return result.response.text().trim();
    } catch (err: any) {
      lastErr = err;
      const msg: string = err?.message ?? '';
      if (msg.includes('404') || msg.includes('429') || msg.includes('503')) continue;
      throw err;
    }
  }
  throw lastErr ?? new Error('All Gemini models unavailable');
}

// Groq → OpenRouter → Gemini cascade
async function callLLM(systemPrompt: string, messages: LLMMessage[], groqModel = 'llama-3.1-8b-instant'): Promise<string> {
  if (GROQ_KEY) return retryOnRateLimit(() => callGroq(systemPrompt, messages, groqModel));
  if (OPENROUTER_KEY) return retryOnRateLimit(() => callOpenRouter(systemPrompt, messages));
  if (GEMINI_KEY) return callGemini(systemPrompt, messages);
  throw new Error('No API key found. Add VITE_GROQ_API_KEY, VITE_OPENROUTER_API_KEY, or VITE_GEMINI_API_KEY to your .env file.');
}

const THEMES = {
  midnight: { name: 'Blue',   swatch: '#3b82f6', main: '#0a2550', panelGlass: 'rgba(10,37,80,0.97)',  card: '#0e2e60', bubble: '#10326a', report: '#081c46' },
  carbon:   { name: 'Slate',  swatch: '#94a3b8', main: '#111318', panelGlass: 'rgba(17,19,24,0.97)',  card: '#1a1e26', bubble: '#1c2028', report: '#141620' },
  forest:   { name: 'Green',  swatch: '#22c55e', main: '#0a4d10', panelGlass: 'rgba(10,77,16,0.97)',  card: '#0e5c14', bubble: '#106018', report: '#084210' },
  violet:   { name: 'Purple', swatch: '#a855f7', main: '#1e0a5e', panelGlass: 'rgba(30,10,94,0.97)',  card: '#260c70', bubble: '#280e76', report: '#180850' },
  ember:    { name: 'Orange', swatch: '#f97316', main: '#7c2e00', panelGlass: 'rgba(124,46,0,0.97)',  card: '#8c3600', bubble: '#923a00', report: '#6c2800' },
  ocean:    { name: 'Cyan',   swatch: '#06b6d4', main: '#04385a', panelGlass: 'rgba(4,56,90,0.97)',   card: '#064468', bubble: '#08486e', report: '#042e4c' },
  rose:     { name: 'Red',    swatch: '#ef4444', main: '#7a0e0e', panelGlass: 'rgba(122,14,14,0.97)', card: '#8a1212', bubble: '#901616', report: '#680c0c' },
  amber:    { name: 'Yellow', swatch: '#eab308', main: '#5e4600', panelGlass: 'rgba(94,70,0,0.97)',   card: '#6e5200', bubble: '#725600', report: '#503c00' },
} as const;
type ThemeName = keyof typeof THEMES;

interface AppSettings {
  correctionLevel: 'off' | 'gentle' | 'strict';
  correctionTiming: 'realtime' | 'summary' | 'adaptive';
  speechRate: 'slow' | 'normal' | 'fast';
  modelQuality: 'fast' | 'quality';
  theme: ThemeName;
}
const DEFAULT_SETTINGS: AppSettings = { correctionLevel: 'gentle', correctionTiming: 'adaptive', speechRate: 'normal', modelQuality: 'fast', theme: 'midnight' };
const SETTINGS_KEY = 'me_settings';
const SPEECH_RATES: Record<AppSettings['speechRate'], number> = { slow: 0.75, normal: 0.95, fast: 1.2 };
const GROQ_MODELS: Record<AppSettings['modelQuality'], string> = {
  fast: 'llama-3.1-8b-instant',
  quality: 'llama-3.3-70b-versatile',
};

function ScoreRing({ score }: { score: number }) {
  const r = 30;
  const stroke = 7;
  const nr = r - stroke / 2;
  const circ = 2 * Math.PI * nr;
  const progress = (score / 100) * circ;
  const color = score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : score >= 40 ? '#fb923c' : '#f87171';
  const label = score >= 80 ? 'Excellent 🌟' : score >= 60 ? 'Good job 👍' : score >= 40 ? 'Getting there 📈' : 'Keep going 💪';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-[72px] h-[72px] flex items-center justify-center">
        <svg width="72" height="72" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="36" cy="36" r={nr} fill="none" stroke="#1e293b" strokeWidth={stroke} />
          <circle cx="36" cy="36" r={nr} fill="none" stroke={color} strokeWidth={stroke}
            strokeDasharray={`${progress} ${circ}`} strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 1.2s ease-out' }} />
        </svg>
        <div className="absolute flex flex-col items-center leading-none">
          <span className="text-lg font-extrabold" style={{ color }}>{score}</span>
          <span className="text-[9px] text-slate-500 mt-0.5">/ 100</span>
        </div>
      </div>
      <span className="text-[11px] font-semibold" style={{ color }}>{label}</span>
    </div>
  );
}

function LunaAvatar({ status }: { status: 'idle' | 'listening' | 'analyzing' | 'speaking' }) {
  const speaking = status === 'speaking';
  const listening = status === 'listening';
  const analyzing = status === 'analyzing';
  return (
    <div className="relative flex items-center justify-center">
      {/* Outer animated ring */}
      <div className={`absolute inset-0 rounded-full transition-all duration-500 ${
        speaking  ? 'bg-pink-500/25 blur-xl scale-130 animate-pulse' :
        listening ? 'bg-indigo-500/20 blur-lg scale-115' :
        analyzing ? 'bg-amber-400/10 blur-md scale-105' : 'opacity-0'
      }`} />
      <svg width="96" height="96" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="bgGrad" cx="50%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#4A1D8F"/>
            <stop offset="100%" stopColor="#120A2A"/>
          </radialGradient>
          <radialGradient id="faceGrad" cx="40%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#F7D4AC"/>
            <stop offset="100%" stopColor="#E8A870"/>
          </radialGradient>
        </defs>

        {/* Background circle */}
        <circle cx="48" cy="48" r="48" fill="url(#bgGrad)"/>

        {/* Shirt / collar */}
        <path d="M14 96 Q20 76 37 71 L48 78 L59 71 Q76 76 82 96Z" fill="#6D28D9"/>
        <path d="M37 71 L48 61 L59 71 L48 78Z" fill="#5B21B6"/>

        {/* Neck */}
        <rect x="40" y="67" width="16" height="12" rx="5" fill="url(#faceGrad)"/>

        {/* Hair – back layer */}
        <ellipse cx="48" cy="40" rx="30" ry="24" fill="#1C1030"/>

        {/* Face */}
        <ellipse cx="48" cy="52" rx="24" ry="26" fill="url(#faceGrad)"/>

        {/* Hair – side curtains */}
        <ellipse cx="22" cy="52" rx="7" ry="16" fill="#1C1030"/>
        <ellipse cx="74" cy="52" rx="7" ry="16" fill="#1C1030"/>

        {/* Hair – top sweep */}
        <path d="M18 44 Q22 18 48 17 Q74 18 78 44 Q62 32 48 33 Q34 32 18 44Z" fill="#1C1030"/>

        {/* Ears */}
        <ellipse cx="24" cy="54" rx="4.5" ry="6.5" fill="url(#faceGrad)"/>
        <ellipse cx="72" cy="54" rx="4.5" ry="6.5" fill="url(#faceGrad)"/>

        {/* Earrings */}
        <circle cx="24" cy="60" r="2.5" fill="#E879F9"/>
        <circle cx="72" cy="60" r="2.5" fill="#E879F9"/>

        {/* Eyebrows */}
        <path d="M32 46 Q38 42 44 45" stroke="#1C1030" strokeWidth="2" strokeLinecap="round" fill="none"/>
        <path d="M52 45 Q58 42 64 46" stroke="#1C1030" strokeWidth="2" strokeLinecap="round" fill="none"/>

        {/* Eye whites */}
        <ellipse cx="38" cy="52" rx="5.5" ry="5.5" fill="white"/>
        <ellipse cx="58" cy="52" rx="5.5" ry="5.5" fill="white"/>

        {/* Iris */}
        <ellipse cx="38" cy="52.5" rx="3.5" ry="3.5" fill="#7C3AED"/>
        <ellipse cx="58" cy="52.5" rx="3.5" ry="3.5" fill="#7C3AED"/>

        {/* Pupils */}
        <ellipse cx="38" cy="52.5" rx="2" ry="2" fill="#0F0820"/>
        <ellipse cx="58" cy="52.5" rx="2" ry="2" fill="#0F0820"/>

        {/* Eye highlights */}
        <circle cx="39.5" cy="51" r="1.1" fill="white"/>
        <circle cx="59.5" cy="51" r="1.1" fill="white"/>

        {/* Blush */}
        <ellipse cx="30" cy="59" rx="7" ry="4" fill="#F472B6" opacity="0.3"/>
        <ellipse cx="66" cy="59" rx="7" ry="4" fill="#F472B6" opacity="0.3"/>

        {/* Mouth — open when speaking, smile otherwise */}
        {speaking ? (
          <>
            <ellipse cx="48" cy="66" rx="7" ry="5" fill="#9D2B5A"/>
            <ellipse cx="48" cy="64" rx="7" ry="2.5" fill="url(#faceGrad)"/>
          </>
        ) : (
          <path d="M 41 65 Q 48 72 55 65" stroke="#C0607A" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
        )}

        {/* Analyzing dots */}
        {analyzing && (
          <>
            <circle cx="40" cy="80" r="2.5" fill="#FBBF24" opacity="0.9"/>
            <circle cx="48" cy="80" r="2.5" fill="#FBBF24" opacity="0.6"/>
            <circle cx="56" cy="80" r="2.5" fill="#FBBF24" opacity="0.3"/>
          </>
        )}
      </svg>
    </div>
  );
}

interface Correction {
  category: string;
  said: string;
  correct: string;
  explanation: string;
}

interface Positive {
  category: string;
  example: string;
  explanation: string;
}

interface StudyItem {
  category: string;
  examples: Array<{ said: string; correct: string }>;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'luna';
  text: string;
  feedback?: Correction;
  positive?: Positive;
  isReport?: boolean;
  timestamp: string;
}

export default function App() {
  const [isCallActive, setIsCallActive] = useState(false);
  const [status, setStatus] = useState<'idle' | 'listening' | 'analyzing' | 'speaking'>('idle');
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [targetLanguage, setTargetLanguage] = useState<'en-US' | 'es-ES' | 'fr-FR' | 'de-DE'>('en-US');
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
      if (!(saved.theme in THEMES)) saved.theme = DEFAULT_SETTINGS.theme;
      return saved as AppSettings;
    }
    catch { return DEFAULT_SETTINGS; }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [previousReport, setPreviousReport] = useState('');
  const [showReportInput, setShowReportInput] = useState(false);
  const [copiedReportId, setCopiedReportId] = useState<string | null>(null);

  // Study system
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [studySummary, setStudySummary] = useState<StudyItem[]>([]);
  const [focusTopic, setFocusTopic] = useState<string | null>(null);
  const [focusExamples, setFocusExamples] = useState<Array<{said: string; correct: string}>>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [sessionScore, setSessionScore] = useState<number | null>(null);
  const [isRinging, setIsRinging] = useState(false);

  const recognitionRef = useRef<any>(null);
  const isCallActiveRef = useRef(false);
  const isSpeakingRef = useRef<boolean>(false);
  const silenceTimeoutRef = useRef<any>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const correctionsRef = useRef<Correction[]>([]);
  const adaptiveTurnCountRef = useRef(0);
  const adaptivePermissionAskedRef = useRef(false);
  const focusExamplesRef = useRef<Array<{said: string; correct: string}>>([]);
  const focusGreetingDoneRef = useRef(false);
  const resumeTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const isMutedRef = useRef(false);
  const processUserSpeechRef = useRef<(text: string) => void>(() => {});
  const historyEndRef = useRef<HTMLDivElement>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);

  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => {
    if (showHistory) historyEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, showHistory]);
  useEffect(() => { isCallActiveRef.current = isCallActive; }, [isCallActive]);
  useEffect(() => { correctionsRef.current = corrections; }, [corrections]);
  useEffect(() => { focusExamplesRef.current = focusExamples; }, [focusExamples]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // Score/summary are now built synchronously inside endCall() via refs.
  // This effect only handles the edge case of no history (page load / idle).
  useEffect(() => {
    if (!isCallActive && historyRef.current.length === 0) setSessionScore(null);
  }, [isCallActive]);

  // Preload voices — getVoices() returns [] on the first call until voiceschanged fires
  useEffect(() => {
    const load = () => { voicesRef.current = window.speechSynthesis.getVoices(); };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  // Initialize Web Speech API once on mount
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsSpeechSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    // continuous eliminates restart gaps; interimResults shows words as they're spoken
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    let accumulated = '';
    let submitTimer: ReturnType<typeof setTimeout> | null = null;

    const submitAccumulated = () => {
      const text = accumulated.trim();
      accumulated = '';
      if (text.length > 2 && !isSpeakingRef.current) {
        setCurrentTranscript(text);
        processUserSpeechRef.current(text);
      }
    };

    recognition.onstart = () => setStatus('listening');

    recognition.onresult = (event: any) => {
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        // Pick the alternative with the highest confidence score
        let best = event.results[i][0];
        for (let j = 1; j < event.results[i].length; j++) {
          if ((event.results[i][j].confidence ?? 0) > (best.confidence ?? 0)) best = event.results[i][j];
        }
        if (event.results[i].isFinal) {
          accumulated += (accumulated ? ' ' : '') + best.transcript.trim();
        } else {
          interimText = best.transcript.trim();
        }
      }

      // Show live preview while the user is speaking
      const preview = (accumulated + (interimText ? ' ' + interimText : '')).trim();
      if (preview) setCurrentTranscript(preview);

      // Debounce: submit after 1000 ms of silence
      if (accumulated.length > 2) {
        if (submitTimer) clearTimeout(submitTimer);
        submitTimer = setTimeout(submitAccumulated, 1000);
      }
    };

    recognition.onend = () => {
      if (submitTimer) { clearTimeout(submitTimer); submitTimer = null; }
      // Submit anything pending before the debounce fired
      if (accumulated.trim().length > 2 && !isSpeakingRef.current) submitAccumulated();
      accumulated = '';

      if (isCallActiveRef.current && !isSpeakingRef.current && !isMutedRef.current) {
        try { recognition.start(); } catch (_) {}
      } else if (!isCallActiveRef.current) {
        setStatus('idle');
      }
    };

    recognition.onerror = (e: any) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted' && e.error !== 'network') {
        console.error('Speech recognition error:', e.error);
      }
    };

    recognitionRef.current = recognition;
  }, []);

  useEffect(() => {
    if (recognitionRef.current) recognitionRef.current.lang = targetLanguage;
  }, [targetLanguage]);

  // Keep the ref pointing to the latest closure (runs after every render)
  useEffect(() => {
    processUserSpeechRef.current = processUserSpeech;
  });

  const playBeep = (type: 'start' | 'stop') => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      oscillator.frequency.setValueAtTime(type === 'start' ? 600 : 350, audioCtx.currentTime);
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.12);
    } catch (_) {}
  };

  const resetSilenceTimeout = () => {
    clearTimeout(silenceTimeoutRef.current);
    silenceTimeoutRef.current = setTimeout(() => {
      endCall();
    }, 60000);
  };

  const parseLunaResponse = (fullText: string) => {
    const fullRegex = /\[CORRECTION\s+category="([^"]+)"\s+said="([^"]+)"\s+correct="([^"]+)"\]([\s\S]*?)\[\/CORRECTION\]/i;
    const openRegex = /\[CORRECTION\s+category="([^"]+)"\s+said="([^"]+)"\s+correct="([^"]+)"\]([\s\S]{0,150}?[.!?])/i;
    const match = fullText.match(fullRegex) ?? fullText.match(openRegex);

    let cleanText = fullText;
    let feedback: Correction | undefined;
    let positive: Positive | undefined;

    if (match) {
      const [fullTag, category, said, correct, explanation] = match;
      cleanText = fullText.replace(fullTag, '').trim();
      // When open tag format consumed all text, recover display text from explanation
      if (!cleanText && explanation.trim()) cleanText = explanation.trim();
      feedback = { category, said, correct, explanation: explanation.trim() };
    }

    const posFull = /\[POSITIVE\s+category="([^"]+)"\s+example="([^"]+)"\]([\s\S]*?)\[\/POSITIVE\]/i;
    const posOpen = /\[POSITIVE\s+category="([^"]+)"\s+example="([^"]+)"\]([\s\S]{0,150}?[.!?])/i;
    const posMatch = cleanText.match(posFull) ?? cleanText.match(posOpen);
    if (posMatch) {
      const [posTag, category, example, explanation] = posMatch;
      cleanText = cleanText.replace(posTag, '').trim();
      if (!cleanText && explanation.trim()) cleanText = explanation.trim();
      positive = { category, example, explanation: explanation.trim() };
    }

    // Detect hidden permission-request marker and strip it
    const permissionAsked = /\[PERMISSION_ASKED\]/i.test(cleanText);

    cleanText = cleanText
      .replace(/\[PERMISSION_ASKED\]/gi, '')
      .replace(/\[CORRECTION[^\]]*\]/gi, '')
      .replace(/\[\/CORRECTION\]/gi, '')
      .replace(/\[POSITIVE[^\]]*\]/gi, '')
      .replace(/\[\/POSITIVE\]/gi, '')
      .trim();

    return { cleanText, feedback, positive, permissionAsked };
  };

  const processUserSpeech = async (text: string) => {
    if (!text.trim() || isSpeakingRef.current) return;

    resetSilenceTimeout();

    if (!GROQ_KEY && !OPENROUTER_KEY && !GEMINI_KEY) {
      setHistory(prev => [...prev, {
        id: crypto.randomUUID(),
        sender: 'luna',
        text: "API Key missing. Please add VITE_GROQ_API_KEY, VITE_OPENROUTER_API_KEY, or VITE_GEMINI_API_KEY to your .env file.",
        timestamp: new Date().toLocaleTimeString()
      }]);
      return;
    }

    // Detect end-session triggers
    if (/^\s*(end|finish|stop|end session|bye|goodbye)\s*$/i.test(text)) {
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setHistory(prev => [...prev, { id: crypto.randomUUID(), sender: 'user', text, timestamp }]);
      await generateSessionReport();
      return;
    }

    setStatus('analyzing');

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMessage: ChatMessage = { id: crypto.randomUUID(), sender: 'user', text, timestamp };
    const updatedHistory = [...historyRef.current, userMessage];
    setHistory(updatedHistory);

    try {
      const languageNames: Record<string, string> = { 'en-US': 'English', 'es-ES': 'Spanish', 'fr-FR': 'French', 'de-DE': 'German' };

      const focusLine = focusTopic
        ? `\n# Current Focus\nThe student needs extra practice with: ${focusTopic}. Gently steer the conversation to practice this.`
        : '';

      const slugs = 'past_simple · present_simple · present_continuous · present_perfect · future · conditionals · modals · articles · prepositions · pronunciation · vocabulary · word_order · plurals · phrasal_verbs · questions · negations';

      const isSummaryMode = settings.correctionTiming === 'summary';
      const isAdaptiveMode = settings.correctionTiming === 'adaptive';
      const isSilentMode = isSummaryMode || isAdaptiveMode;

      // Adaptive: three phases — observing → asking permission → responding to answer
      const ADAPTIVE_INTERVAL = 15; // proactive feedback offer after ~15 student messages
      let isAdaptiveReviewTurn = false;
      let isAdaptivePermissionTurn = false;
      if (isAdaptiveMode) {
        if (adaptivePermissionAskedRef.current) {
          isAdaptivePermissionTurn = true;
          adaptivePermissionAskedRef.current = false;
        } else {
          adaptiveTurnCountRef.current += 1;
          if (adaptiveTurnCountRef.current >= ADAPTIVE_INTERVAL) {
            isAdaptiveReviewTurn = true;
            adaptiveTurnCountRef.current = 0;
          }
        }
      }

      const correctionBlock = settings.correctionLevel === 'off'
        ? `# Corrections: OFF\nDo NOT correct mistakes. Focus entirely on natural conversation.`
        : isAdaptiveMode
          ? isAdaptivePermissionTurn
            ? `# Responding to Feedback Request
The student replied YES to your offer. Deliver a warm mini-review focused on BOTH strengths and one improvement.

✅ WHAT WENT WELL (at least 2, using real examples from the chat):
• [specific strength + example]
• [another strength + example]

📌 ONE THING TO PRACTICE (most impactful only):
• [pattern observed] — keep it brief and encouraging
Optional: [CORRECTION category="slug" said="words" correct="form"]brief.[/CORRECTION]
Valid slugs: ${slugs}

Close with genuine encouragement. Ask ONE question to continue.

If NO (or "later", "not now", "keep going"):
Reply: "No problem! We'll keep it natural. I'll have a full report ready when you finish." Ask ONE question.`
            : isAdaptiveReviewTurn
              ? `# Micro Feedback Moment (after ~15 messages)
Naturally share a brief, positive observation about the student's progress — 1 to 2 sentences maximum.
Focus on what's going WELL: vocabulary, fluency, sentence structure, confidence, engagement.
Example: "By the way, your vocabulary has been really natural — great job keeping the conversation going!"
Then ask ONE question to continue. Do NOT mention errors. Do NOT ask for permission.`
              : `# Natural Conversation Coach
IDENTITY: You are a conversation partner first, teacher second.
Your job: keep the conversation flowing like a real native English speaker.

RESPONSE RULES:
• Maximum 2–4 sentences per turn
• Ask only ONE question per turn — never two
• No long paragraphs, no academic explanations
• Sound human and friendly, not like a textbook

GOOD: "That's interesting! How did you get started with that?"
GOOD: "Nice choice. What do you enjoy most about it?"
BAD: "That's very interesting. Many people enjoy this because it offers several benefits..."

CONVERSATION BALANCE: 90% natural conversation · 10% gentle teaching
Never turn an exchange into a lesson.

SILENT OBSERVATION (track internally, never display):
• Vocabulary usage · Grammar accuracy · Sentence complexity
• Fluency · Communication effectiveness · Confidence · Engagement

ERROR HANDLING:
LOW — NEVER interrupt: articles, prepositions, plurals, minor vocabulary
MEDIUM — note for later: wrong tenses, awkward structures
HIGH — interrupt ONLY when: message is incomprehensible, same error 5+ times, student explicitly asked

ANTI-TEACHER CHECK before any correction:
"Will correcting this NOW improve communication?"
If NO → continue, log it. If YES → ask permission first.
Include [PERMISSION_ASKED] when asking for correction permission.

Situation — Student explicitly asked ("correct me", "fix my mistakes"):
Correct immediately: [CORRECTION category="slug" said="exact words" correct="form"]brief note.[/CORRECTION]
Valid slugs: ${slugs}`
          : isSummaryMode
            ? `# Correction (SILENT LOG)
For EVERY mistake: insert the tag silently, then reply naturally — never mention the error aloud.
IMPORTANT: correct="..." must be the SHORT correct word/phrase only (max 4 words), NOT an explanation.
[CORRECTION category="slug" said="their words" correct="correct word"]Brief note.[/CORRECTION] Natural reply.
Example: [CORRECTION category="vocabulary" said="hob" correct="hobby"]hobby, not hob[/CORRECTION] Motorcycling is cool!
Slugs: ${slugs}`
            : settings.correctionLevel === 'gentle'
              ? `# Correction (GENTLE)
When the student makes a clear mistake, correct it briefly.
IMPORTANT: correct="..." must be the SHORT correct word/phrase only (max 4 words), NOT an explanation.
[CORRECTION category="<slug>" said="<their words>" correct="<correct word/phrase>"]2–4 words.[/CORRECTION] Reply here.
Valid slugs: ${slugs}`
              : `# Correction (STRICT)
Correct EVERY grammar, vocabulary, or word-order mistake.
IMPORTANT: correct="..." must be the SHORT correct word/phrase only (max 4 words), NOT an explanation.
[CORRECTION category="<slug>" said="<exact words>" correct="<correct word/phrase>"]One sentence rule.[/CORRECTION] Reply here.
Valid slugs: ${slugs}`;

      const positiveBlock = settings.correctionLevel !== 'off'
        ? `# Positive Reinforcement (always active)
Continuously track and acknowledge strengths. Use [POSITIVE category="<slug>" example="<their words>"]Short praise.[/POSITIVE] when noteworthy.
Even when no mistakes exist, find something positive to observe.
Never combine CORRECTION + POSITIVE in the same turn.`
        : '';

      const previousReportBlock = previousReport.trim()
        ? `
# Previous Session Report (Silent Coaching Mode)
You have analyzed the student's previous session report. Your entire coaching strategy is based on this analysis — but the student must never know this. The conversation should feel completely natural.

PREVIOUS REPORT:
${previousReport.trim()}

INVISIBLE TUTORING RULES — follow strictly:
• NEVER mention the report, scores, or any analysis
• NEVER say "I noticed you struggle with..." or "Today we'll practice..." or "Based on your report..."
• NEVER announce grammar topics, vocabulary goals, or learning objectives
• The student should feel they are having a real conversation, not attending a lesson

SILENT COACHING STRATEGY:
• Grammar/Verb Tense below 8 → naturally ask questions requiring those structures
  - Past Simple weak? Ask about past events, trips, weekend activities, childhood memories
  - Present Perfect weak? Ask "Have you ever..." or "What have you done recently?"
  - Future weak? Ask about plans, goals, upcoming events
• Vocabulary below 8 → weave richer alternatives naturally into your responses
  - Student says "The movie was good" → respond "Would you say it was exciting, inspiring, or thought-provoking?"
• Communication/Confidence ≥ 8 → encourage longer, more detailed elaboration
• Follow the recommended study topic as the natural conversation theme

BRIEF POSITIVE REINFORCEMENT (only when target structure is used successfully):
"Nice use of past tense there." / "That was a very natural way to express that idea."
Keep it short — one phrase max. Never interrupt the conversational flow.`
        : '';

      const systemPrompt = `
# Identity
You are Luna, a warm ${languageNames[targetLanguage]} conversation partner for Brazilian students. You feel like a real person to talk to — friendly, encouraging, genuinely interested.
${focusLine}
${previousReportBlock}

# Core rules
- Always speak in ${languageNames[targetLanguage]}. Switch to Portuguese ONLY if the student explicitly asks.
- Adapt your level to the student automatically through conversation — never ask "what level are you?".
- FLUENCY first. Confidence builds when students feel heard, not corrected.
- Keep every response to 2–4 sentences max + ONE question. No exceptions.

# Goal
Help the student develop fluency and confidence through natural, enjoyable conversation.

${correctionBlock}

${positiveBlock}

# Guardrails
- Topics appropriate for all ages.
- Never mock errors or accent.
      `.trim();

      const messages: LLMMessage[] = updatedHistory.map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text,
      }));

      const groqModel = GROQ_MODELS[settings.modelQuality];
      const responseText = await callLLM(systemPrompt, messages, groqModel);

      const { cleanText, feedback, positive, permissionAsked } = parseLunaResponse(responseText);

      // If Luna asked permission on this review turn, arm the flag for the next user turn
      if (isAdaptiveReviewTurn && permissionAsked) {
        adaptivePermissionAskedRef.current = true;
      }

      if (feedback) {
        setCorrections(prev => [...prev, feedback]);
      }

      // In realtime mode: show feedback/positive inside the user bubble
      // In silent modes (summary/adaptive): collect silently, don't show in chat
      if (!isSilentMode && (feedback || positive)) {
        setHistory(prev => {
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].sender === 'user') {
              return prev.map((m, j) => j === i
                ? { ...m, ...(feedback ? { feedback } : {}), ...(positive ? { positive } : {}) }
                : m
              );
            }
          }
          return prev;
        });
      }

      setHistory(prev => [...prev, {
        id: crypto.randomUUID(),
        sender: 'luna',
        text: cleanText || responseText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);

      setCurrentTranscript('');

      let spokenText = cleanText || responseText;
      // In realtime mode, speak the correction aloud; in silent modes stay quiet
      if (!isSilentMode && feedback) {
        spokenText += ` — Quick correction: instead of "${feedback.said}", you should say "${feedback.correct}". ${feedback.explanation}`;
      }
      speak(spokenText);

    } catch (error: any) {
      console.error("LLM Error:", error);
      setHistory(prev => [...prev, {
        id: crypto.randomUUID(),
        sender: 'luna',
        text: `Erro na API: ${error.message || 'Não foi possível obter resposta.'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
      setStatus('idle');
    }
  };

  // Prefer female voices by checking common names across Windows, macOS, and Chrome
  const pickVoice = (voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | undefined => {
    const langPrefix = lang.split('-')[0];
    const femaleKeywords = ['zira', 'samantha', 'victoria', 'allison', 'susan', 'aria', 'luna',
                            'jenny', 'michelle', 'female', 'woman', 'fiona', 'moira'];
    return (
      voices.find(v => v.lang === lang && femaleKeywords.some(k => v.name.toLowerCase().includes(k))) ||
      voices.find(v => v.lang.startsWith(langPrefix) && femaleKeywords.some(k => v.name.toLowerCase().includes(k))) ||
      voices.find(v => v.lang === lang) ||
      voices.find(v => v.lang.startsWith(langPrefix))
    );
  };

  const replaySpeak = (text: string) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = targetLanguage;
    const voices = voicesRef.current.length ? voicesRef.current : window.speechSynthesis.getVoices();
    const voice = pickVoice(voices, targetLanguage);
    if (voice) utterance.voice = voice;
    utterance.rate = SPEECH_RATES[settings.speechRate];
    utterance.pitch = 1.1;
    window.speechSynthesis.speak(utterance);
  };

  const speak = (textToSpeak: string) => {
    if (!('speechSynthesis' in window)) { resumeListening(); return; }

    window.speechSynthesis.cancel();

    const clearAudioText = textToSpeak.replace(/\[.*?\]/g, '').trim();
    if (!clearAudioText) { resumeListening(); return; }

    const utterance = new SpeechSynthesisUtterance(clearAudioText);
    utterance.lang = targetLanguage;

    const voices = voicesRef.current.length ? voicesRef.current : window.speechSynthesis.getVoices();
    const voice = pickVoice(voices, targetLanguage);
    if (voice) utterance.voice = voice;

    utterance.rate = SPEECH_RATES[settings.speechRate];
    utterance.pitch = 1.1;

    utterance.onstart = () => {
      isSpeakingRef.current = true;
      setStatus('speaking');
      if (recognitionRef.current) try { recognitionRef.current.stop(); } catch (_) {}
      // Chrome bug: speechSynthesis pauses silently after ~15 s
      resumeTimerRef.current = setInterval(() => {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      }, 10000);
    };

    const cleanup = () => {
      clearInterval(resumeTimerRef.current);
      isSpeakingRef.current = false;
      if (!isMutedRef.current) resumeListening();
      else setStatus('idle');
    };

    utterance.onend = cleanup;
    utterance.onerror = (e) => { console.error("TTS error:", e); cleanup(); };

    window.speechSynthesis.speak(utterance);
  };

  const resumeListening = () => {
    if (isCallActiveRef.current && recognitionRef.current && !isSpeakingRef.current && !isMutedRef.current) {
      setStatus('listening');
      try { recognitionRef.current.start(); } catch (_) {}
    }
  };

  const interruptLuna = () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    clearInterval(resumeTimerRef.current);
    isSpeakingRef.current = false;
    if (!isMutedRef.current) resumeListening();
    else setStatus('idle');
  };

  const toggleMute = () => {
    const willMute = !isMutedRef.current;
    isMutedRef.current = willMute;
    setIsMuted(willMute);
    if (willMute) {
      try { recognitionRef.current?.stop(); } catch (_) {}
      if (!isSpeakingRef.current) setStatus('idle');
    } else {
      if (!isSpeakingRef.current) resumeListening();
    }
  };

  // Called once when a regular (non-focus) call starts — Aria introduces herself
  const generateOpeningGreeting = async () => {
    if (!GROQ_KEY && !OPENROUTER_KEY && !GEMINI_KEY) { resumeListening(); return; }
    setStatus('analyzing');
    const languageNames: Record<string, string> = { 'en-US': 'English', 'es-ES': 'Spanish', 'fr-FR': 'French', 'de-DE': 'German' };
    const systemPrompt = `You are Luna, a ${languageNames[targetLanguage]} tutor. Say a single short greeting (max 12 words), then ask one simple question. No sub-clauses, no "I'm excited to...", no lists. Example: "Hey! I'm Luna — what's on your mind today?"`;

    try {
      const responseText = await callLLM(systemPrompt, []);
      if (!responseText) { resumeListening(); return; }
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setHistory([{ id: crypto.randomUUID(), sender: 'luna', text: responseText, timestamp }]);
      speak(responseText);
    } catch (err: any) {
      console.error('Opening greeting error:', err);
      setStatus('idle');
      resumeListening();
    }
  };

  // Called once when a focused call starts — Aria opens with targeted exercises
  const generateFocusGreeting = async (topic: string) => {
    if (!GROQ_KEY && !OPENROUTER_KEY && !GEMINI_KEY) { resumeListening(); return; }
    setStatus('analyzing');

    const languageNames: Record<string, string> = { 'en-US': 'English', 'es-ES': 'Spanish', 'fr-FR': 'French', 'de-DE': 'German' };

    const examples = focusExamplesRef.current;
    const examplesBlock = examples.length > 0
      ? `\nIn the previous session the student made these specific mistakes:\n${examples.map(e => `- Said "${e.said}" → correct form: "${e.correct}"`).join('\n')}`
      : '';

    const systemPrompt = `You are Luna, a warm and encouraging ${languageNames[targetLanguage]} language tutor.
The student has chosen to do a focused practice session on: ${topic}.${examplesBlock}

Open the session by:
1. Welcoming them warmly to the ${topic} practice (1 sentence).
2. Presenting ONE specific exercise or question that directly targets the mistakes above, or a strong ${topic} exercise if no examples are given.
Be encouraging and concrete. Maximum 3 sentences total. Do NOT wait for the student to speak first.`;

    try {
      const responseText = await callLLM(systemPrompt, []);
      if (!responseText) { setStatus('idle'); return; }
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setHistory([{ id: crypto.randomUUID(), sender: 'luna', text: responseText, timestamp }]);
      speak(responseText);
    } catch (err: any) {
      console.error('Focus greeting error:', err);
      setStatus('idle');
    }
  };

  // Called when a previous report is loaded — silently analyzes it and opens with a natural question
  const generateSilentReportGreeting = async () => {
    if (!GROQ_KEY && !OPENROUTER_KEY && !GEMINI_KEY) { resumeListening(); return; }
    setStatus('analyzing');
    const languageNames: Record<string, string> = { 'en-US': 'English', 'es-ES': 'Spanish', 'fr-FR': 'French', 'de-DE': 'German' };

    const greetingPrompt = `You are Luna, a warm ${languageNames[targetLanguage]} conversation partner.
You have silently read and analyzed a student's previous session report. Use it ONLY to choose a natural opening question that will subtly create opportunities to practice their weakest skill.

PREVIOUS SESSION REPORT (analyze silently — NEVER mention it):
${previousReport.trim()}

Your task: write ONE warm, friendly greeting (max 2 short sentences).
Rules:
- Do NOT mention the report, scores, or any analysis
- Do NOT say "I reviewed your report" or "Based on your previous session"
- Do NOT announce grammar topics or learning goals
- Start with a warm welcome, then ask ONE natural question that relates to the recommended topic or weakest skill
- Sound like a real person, not a teacher

Good examples:
"Welcome back! What interesting things have you done this week?"
"Hey, great to see you again! Have you watched any good movies lately?"
"Welcome back! What did you get up to over the weekend?"`;

    try {
      const responseText = await callLLM(greetingPrompt, []);
      if (!responseText) { resumeListening(); return; }
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setHistory([{ id: crypto.randomUUID(), sender: 'luna', text: responseText, timestamp }]);
      speak(responseText);
    } catch (err: any) {
      console.error('Silent report greeting error:', err);
      generateOpeningGreeting();
    }
  };

  // Trigger the greeting once whenever a call begins
  useEffect(() => {
    if (isCallActive && !focusGreetingDoneRef.current) {
      focusGreetingDoneRef.current = true;
      if (focusTopic) {
        generateFocusGreeting(focusTopic);
      } else if (previousReport.trim()) {
        generateSilentReportGreeting();
      } else {
        generateOpeningGreeting();
      }
    } else if (!isCallActive) {
      focusGreetingDoneRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCallActive, focusTopic]);

  const playRingTone = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const burst = (t: number) => {
        [440, 480].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = freq;
          const s = t + i * 0.45;
          gain.gain.setValueAtTime(0, s);
          gain.gain.linearRampToValueAtTime(0.1, s + 0.05);
          gain.gain.setValueAtTime(0.1, s + 0.32);
          gain.gain.linearRampToValueAtTime(0, s + 0.4);
          osc.start(s); osc.stop(s + 0.42);
        });
      };
      burst(ctx.currentTime);
      burst(ctx.currentTime + 2);
    } catch (_) {}
  };

  const actuallyStartCall = () => {
    playBeep('start');
    setIsCallActive(true);
    isCallActiveRef.current = true;
    setHistory([]);
    setCorrections([]);
    setStudySummary([]);
    setSessionScore(null);
    resetSilenceTimeout();
  };

  const cancelCall = () => {
    if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
    setIsRinging(false);
  };

  const startCall = () => {
    if (!GROQ_KEY && !OPENROUTER_KEY && !GEMINI_KEY) { alert("Please add VITE_GROQ_API_KEY, VITE_OPENROUTER_API_KEY, or VITE_GEMINI_API_KEY to your .env file."); return; }
    if (!recognitionRef.current) { alert("Speech recognition requires Chrome or Edge."); return; }
    setIsRinging(true);
    playRingTone();
    ringTimeoutRef.current = setTimeout(() => {
      setIsRinging(false);
      actuallyStartCall();
    }, 4000);
  };

  const endCall = () => {
    // Build summary synchronously from refs before any state is cleared
    const snap = correctionsRef.current;
    const hist = historyRef.current;
    if (hist.length > 0) {
      const userMsgs = hist.filter(m => m.sender === 'user').length;
      const errCount = snap.length;
      if (errCount > 0) {
        const grouped = snap.reduce<Record<string, StudyItem>>((acc, c) => {
          if (!acc[c.category]) acc[c.category] = { category: c.category, examples: [] };
          acc[c.category].examples.push({ said: c.said, correct: c.correct });
          return acc;
        }, {});
        setStudySummary(Object.values(grouped));
      }
      const score = Math.max(0, Math.round((1 - Math.min(1, errCount / Math.max(1, userMsgs))) * 100));
      setSessionScore(score);
    }

    adaptiveTurnCountRef.current = 0;
    adaptivePermissionAskedRef.current = false;
    playBeep('stop');
    setIsCallActive(false);
    isCallActiveRef.current = false;
    isSpeakingRef.current = false;
    isMutedRef.current = false;
    setIsMuted(false);
    setStatus('idle');
    setCurrentTranscript('');
    clearTimeout(silenceTimeoutRef.current);
    clearInterval(resumeTimerRef.current);
    if (recognitionRef.current) try { recognitionRef.current.stop(); } catch (_) {}
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  };

  const generateSessionReport = async () => {
    setStatus('analyzing');
    if (recognitionRef.current) try { recognitionRef.current.stop(); } catch (_) {}

    const hist = historyRef.current;
    const userMsgs = hist.filter(m => m.sender === 'user').length;

    const reportSystemPrompt = `You are an expert English conversation coach for Brazilian students. Generate a professional, visual, and actionable session performance dashboard. Use ONLY real examples from this conversation. Be specific — never generic. Keep every section concise.

Write the entire report in English. Use this EXACT structure:

---
# 📊 Session Performance Dashboard

## Overall Performance
Overall Score: XX/100
[Calculate: average of 7 skill scores × 10, rounded]

Performance Level:
🟢 Excellent (90-100) | 🔵 Very Good (80-89) | 🟡 Good (70-79) | 🟠 Developing (60-69) | 🔴 Needs More Practice (<60)

Level: [emoji + level name]

---
## Skill Breakdown
Communication ........ X/10
Vocabulary ........... X/10
Grammar .............. X/10
Verb Tenses .......... X/10
Fluency .............. X/10
Confidence ........... X/10
Pronunciation ........ X/10

---
## 🚨 Priority Attention Areas
Identify the 3 highest-priority skills to reinforce, ordered by urgency. For each:

🚨 Priority #1 — [Skill Name]
Reason: [one specific observation from this conversation]
Impact: [one sentence on how improving this raises their level]

⚠️ Priority #2 — [Skill Name]
Reason: [specific observation]
Impact: [one sentence]

📌 Priority #3 — [Skill Name]
Reason: [specific observation]
Impact: [one sentence]

---
## ✅ Biggest Wins
List 3–5 genuine achievements observed in this session. Always include at least 3.
✅ [specific win — cite real example or behavior]
✅ [specific win]
✅ [specific win]

---
## 🔧 Key Corrections
Maximum 5. Only corrections that significantly impact communication.

Student Said: "[original]"
Better Version: "[corrected]"
Why: [one-sentence rule]
Priority: High / Medium / Low

[Repeat for each correction, blank line between each]

---
## 💡 Learning Insights
4–6 short pattern observations from this conversation.
✓ [insight — e.g. "Communication is stronger than grammar"]
✓ [insight]
✓ [insight]
✓ [insight]

---
## 🎯 Next Session Focus
Next Focus: [ONE topic only]
Why: [one sentence — based on what you observed]
Suggested Themes to Practice It:
1. [conversation topic that naturally reinforces the skill]
2. [conversation topic]
3. [conversation topic]

---
${previousReport.trim() ? `## 📈 Progress Tracker
Compare this session against the previous report provided. Use only evidence from this conversation.
⬆ Improved: [areas with clear improvement — cite examples]
➡ Stable: [areas performing similarly]
⬇ Still Needs Attention: [areas still requiring practice, with examples]

---
` : ''}## 🌟 Coach's Summary
4 sentences maximum:
1. Main achievement from this session.
2. Main learning opportunity identified.
3. Encouragement — something genuine and specific.
4. One clear next step.

Stats: ${userMsgs} student messages · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    const messages: LLMMessage[] = [
      ...hist.map(m => ({ role: m.sender === 'user' ? 'user' as const : 'assistant' as const, content: m.text })),
      { role: 'user', content: 'END SESSION — please generate my full report now.' }
    ];

    try {
      const groqModel = GROQ_MODELS[settings.modelQuality];
      const reportText = await callLLM(reportSystemPrompt, messages, groqModel);

      setHistory(prev => [...prev, {
        id: crypto.randomUUID(),
        sender: 'luna',
        text: reportText,
        isReport: true,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);

      speak("Your session report is ready! Great work today. Keep it up!");
    } catch (e: any) {
      setHistory(prev => [...prev, {
        id: crypto.randomUUID(),
        sender: 'luna',
        text: "Sorry, I couldn't generate the report right now. But you did great today!",
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    } finally {
      setTimeout(() => endCall(), 3500);
    }
  };

  // Called by the End button and any UI-triggered termination.
  // Generates the performance report if the session has history; otherwise ends immediately.
  const handleEndCall = () => {
    if (historyRef.current.length > 0) {
      generateSessionReport();
    } else {
      endCall();
    }
  };

  const startFocusedCall = (topic: string, examples: Array<{said: string; correct: string}>) => {
    setFocusTopic(topic);
    setFocusExamples(examples);
    setTimeout(startCall, 50);
  };

  return (
    <div className="h-screen text-slate-200 flex flex-col overflow-hidden font-sans"
      style={{ '--t-card': THEMES[settings.theme].card, '--t-bubble': THEMES[settings.theme].bubble, '--t-report': THEMES[settings.theme].report, background: THEMES[settings.theme].main } as React.CSSProperties}>

      {/* ── Ringing overlay ── */}
      {isRinging && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-between pb-14 pt-14"
          style={{ background: 'linear-gradient(170deg, #1e0a48 0%, #0c0328 55%, #060118 100%)' }}>

          {/* Caller info */}
          <div className="text-center">
            <p className="text-indigo-300/50 text-[11px] uppercase tracking-[0.3em] mb-3">Voice Call</p>
            <h1 className="text-5xl font-bold text-white tracking-tight">Luna</h1>
            <p className="text-slate-400/70 text-sm mt-2 flex items-center justify-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
              Calling...
            </p>
          </div>

          {/* Luna avatar with float + pulse rings */}
          <div className="relative flex items-center justify-center">
            <div className="absolute w-72 h-72 rounded-full border border-indigo-500/20"
              style={{ animation: 'ringPulse 2s ease-out infinite' }} />
            <div className="absolute w-52 h-52 rounded-full border border-indigo-400/25"
              style={{ animation: 'ringPulse 2s ease-out infinite', animationDelay: '0.6s' }} />
            <div className="absolute w-36 h-36 rounded-full border border-indigo-300/30"
              style={{ animation: 'ringPulse 2s ease-out infinite', animationDelay: '1.2s' }} />
            <div className="absolute w-40 h-40 rounded-full bg-indigo-600/15 blur-2xl animate-pulse" />
            <div style={{ animation: 'lunaFloat 3s ease-in-out infinite' }}>
              <div style={{ transform: 'scale(2.6)', transformOrigin: 'center' }}>
                <LunaAvatar status="idle" />
              </div>
            </div>
          </div>

          {/* Hang up */}
          <div className="flex flex-col items-center gap-3">
            <button onClick={cancelCall}
              className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-95 flex items-center justify-center transition-all shadow-2xl shadow-rose-900/50">
              <PhoneOff className="w-7 h-7 text-white" />
            </button>
            <span className="text-slate-600 text-xs">Cancel</span>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header className="flex-none flex items-center justify-between px-5 md:px-8 py-3.5 border-b border-slate-800/50 backdrop-blur z-10"
        style={{ background: THEMES[settings.theme].panelGlass }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-600/30 to-pink-600/20 border border-indigo-500/30 flex items-center justify-center">
            <Sparkles className="text-pink-400 w-3.5 h-3.5" />
          </div>
          <span className="text-sm font-bold tracking-widest text-slate-300 uppercase">MentorStudy</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700/60">
            <Globe className="w-3.5 h-3.5 text-indigo-400" />
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value as any)}
              disabled={isCallActive}
              className="bg-transparent text-xs text-slate-200 font-semibold focus:outline-none cursor-pointer disabled:opacity-50"
            >
              <option value="en-US">English</option>
              <option value="es-ES">Spanish</option>
              <option value="fr-FR">French</option>
              <option value="de-DE">German</option>
            </select>
          </div>
          <button
            onClick={() => setShowSettings(v => !v)}
            disabled={isCallActive}
            className={`p-2 rounded-xl border transition-all disabled:opacity-40 ${
              showSettings
                ? 'bg-indigo-600/30 border-indigo-500/40 text-indigo-300'
                : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:text-slate-200 hover:bg-slate-700/60'
            }`}
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ── Settings panel ── */}
      {showSettings && !isCallActive && (
        <div className="flex-none border-b border-slate-800/50 backdrop-blur px-5 md:px-8 py-4"
          style={{ background: THEMES[settings.theme].panelGlass }}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">



            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Speed</p>
              <div className="flex gap-1.5">
                {(['slow', 'normal', 'fast'] as const).map(s => (
                  <button key={s} onClick={() => setSettings(prev => ({ ...prev, speechRate: s }))}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      settings.speechRate === s ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}>
                    {s === 'slow' ? 'Slow' : s === 'normal' ? 'Normal' : 'Fast'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">AI quality</p>
              <div className="flex gap-1.5">
                {(['fast', 'quality'] as const).map(q => (
                  <button key={q} onClick={() => setSettings(s => ({ ...s, modelQuality: q }))}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      settings.modelQuality === q ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}>
                    {q === 'fast' ? 'Fast' : 'Better'}
                  </button>
                ))}
              </div>
            </div>

            <div className="col-span-2 md:col-span-4">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Theme</p>
              <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                {(Object.keys(THEMES) as ThemeName[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setSettings(s => ({ ...s, theme: t }))}
                    className={`flex flex-col items-center gap-1.5 py-2 rounded-xl border transition-all ${
                      settings.theme === t
                        ? 'border-white/40 bg-white/8'
                        : 'border-slate-700/50 hover:border-slate-500 hover:bg-slate-800/40'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-full border-2 transition-all ${settings.theme === t ? 'border-white scale-110 shadow-lg' : 'border-transparent'}`}
                      style={{ background: THEMES[t].swatch }}
                    />
                    <span className={`text-[9px] font-semibold transition-colors ${settings.theme === t ? 'text-white' : 'text-slate-500'}`}>
                      {THEMES[t].name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

          </div>
          <div className="max-w-4xl mx-auto mt-3 pt-3 border-t border-slate-700/30 flex justify-end">
            <span className="text-[10px] text-slate-600 font-mono">v1.0.8</span>
          </div>
        </div>
      )}

      {/* ── Two-panel body ── */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">

        {/* ── Left panel: Luna + controls + score ── */}
        <aside className="flex-none w-full md:w-72 lg:w-80 flex flex-col gap-3 p-4 md:p-5 border-b md:border-b-0 md:border-r border-slate-800/40 overflow-y-auto">

          {/* ── Luna call screen (idle) or compact call bar (active) ── */}
          {isCallActive ? (
            /* Compact bar during call */
            <div className="shrink-0 border border-slate-800/60 rounded-2xl p-3 shadow-lg" style={{ background: 'var(--t-card)' }}>
              {/* Row 1: avatar + name/status + end button */}
              <div className="flex items-center gap-2.5">
                <div className="shrink-0 w-10 h-10 overflow-hidden" style={{ clipPath: 'circle(50%)' }}>
                  <div style={{ transform: 'scale(0.42)', transformOrigin: 'top left', width: '96px', height: '96px' }}>
                    <LunaAvatar status={status} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-bold text-white leading-none">Luna</span>
                    <Heart className="w-3 h-3 text-pink-500 fill-pink-500 shrink-0" />
                  </div>
                  <span className="text-[10px] text-indigo-400 font-mono capitalize">{status}</span>
                </div>
                <button onClick={handleEndCall}
                  className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1 transition-all">
                  <PhoneOff className="w-3 h-3" />
                  End
                </button>
              </div>

              {/* Row 2: badge + mute/interrupt controls */}
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700/30">
                <div className="flex-1 min-w-0">
                  {settings.correctionTiming === 'summary' && settings.correctionLevel !== 'off' && (
                    <span className="text-[9px] font-bold bg-violet-800/60 text-violet-300 px-2 py-0.5 rounded-full border border-violet-700/40">
                      {corrections.length > 0 ? `${corrections.length} logged` : 'logging'}
                    </span>
                  )}
                  {settings.correctionTiming === 'adaptive' && settings.correctionLevel !== 'off' && (
                    <span className="text-[9px] font-bold bg-amber-900/60 text-amber-300 px-2 py-0.5 rounded-full border border-amber-700/40">
                      {corrections.length > 0 ? `${corrections.length} noted` : 'analyzing'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={interruptLuna} disabled={status !== 'speaking'} title="Interrupt Luna"
                    className="p-1.5 rounded-lg bg-amber-600/70 hover:bg-amber-600 disabled:opacity-25 disabled:cursor-not-allowed text-white transition-all">
                    <PhoneOff className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute mic'}
                    className={`p-1.5 rounded-lg transition-all text-white ${isMuted ? 'bg-rose-700 hover:bg-rose-600' : 'bg-slate-700 hover:bg-slate-600'}`}>
                    {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* ── Call screen style card ── */
            <div className="flex-1 min-h-0 rounded-2xl border border-slate-700/40 flex flex-col overflow-hidden" style={{ background: 'var(--t-card)' }}>
              {/* Top label */}
              <p className="shrink-0 text-center text-[10px] text-slate-600 uppercase tracking-[0.22em] pt-5 pb-1">
                {focusTopic ? 'Focus Session' : 'Voice Session'}
              </p>

              {/* Avatar — fills vertical space */}
              <div className="flex-1 flex items-center justify-center min-h-0 py-2">
                <div className="relative">
                  <div className="absolute -inset-6 rounded-full bg-indigo-500/10 animate-pulse" />
                  <LunaAvatar status={status} />
                  <div className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2"
                    style={{ borderColor: THEMES[settings.theme].card }} />
                </div>
              </div>

              {/* Name + status */}
              <div className="shrink-0 text-center py-3">
                <h2 className="text-2xl font-bold text-white flex items-center justify-center gap-1.5 mb-0.5">
                  Luna <Heart className="w-4 h-4 text-pink-500 fill-pink-500" />
                </h2>
                <span className="text-sm text-indigo-400 font-mono capitalize">{status}</span>
              </div>

              {/* Focus badge (inside card) */}
              {focusTopic && (
                <div className="shrink-0 mx-4 mb-3 flex items-center gap-2 bg-indigo-950/60 border border-indigo-700/40 px-3 py-2 rounded-xl">
                  <BookOpen className="w-3 h-3 text-indigo-400 shrink-0" />
                  <span className="text-xs text-indigo-300 flex-1 truncate capitalize">{focusTopic}</span>
                  <button onClick={() => setFocusTopic(null)} className="text-slate-500 hover:text-slate-300 transition-colors shrink-0">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {!isSpeechSupported && (
                <p className="shrink-0 text-xs text-rose-400 px-5 mb-2 text-center">Requires Chrome or Edge.</p>
              )}

              {/* Call button */}
              <div className="shrink-0 px-4 pb-5">
                <button onClick={startCall} disabled={!isSpeechSupported || isRinging}
                  className="w-full py-3.5 rounded-full font-semibold text-sm bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-900/30">
                  <Phone className="w-4 h-4" />
                  {focusTopic ? `Practice · ${focusTopic}` : 'Start Session'}
                </button>
              </div>
            </div>
          )}

          {/* ── Previous Report import (idle only) ── */}
          {!isCallActive && (
            <div className="shrink-0 border border-slate-700/50 rounded-2xl overflow-hidden" style={{ background: 'var(--t-card)' }}>
              <button
                onClick={() => setShowReportInput(v => !v)}
                className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-white/5 transition-colors"
              >
                <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span className="flex-1 text-left text-xs font-semibold text-slate-400">
                  Previous Report
                </span>
                {previousReport.trim()
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  : <span className="text-[10px] text-slate-600">optional</span>
                }
                <ChevronUp className={`w-3.5 h-3.5 text-slate-600 shrink-0 transition-transform ${showReportInput ? '' : 'rotate-180'}`} />
              </button>

              {showReportInput && (
                <div className="px-4 pb-4 space-y-2">
                  <textarea
                    value={previousReport}
                    onChange={e => setPreviousReport(e.target.value)}
                    placeholder="Paste your previous session report here. Luna will adapt the conversation to your results."
                    rows={6}
                    className="w-full text-[11px] text-slate-300 placeholder-slate-600 bg-slate-900/60 border border-slate-700/40 rounded-xl p-3 resize-none focus:outline-none focus:border-indigo-500/50 leading-relaxed"
                  />
                  {previousReport.trim() && (
                    <button
                      onClick={() => setPreviousReport('')}
                      className="text-[10px] text-rose-400/70 hover:text-rose-400 transition-colors"
                    >
                      Clear report
                    </button>
                  )}
                  {previousReport.trim() && (
                    <p className="text-[10px] text-emerald-400/70 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Report loaded — Luna will personalize this session
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Transcript preview */}
          {currentTranscript && (
            <div className="shrink-0 bg-indigo-950/30 border border-indigo-900/40 px-4 py-3 rounded-xl">
              <p className="text-sm text-indigo-300 italic">"{currentTranscript}"</p>
            </div>
          )}

          {/* Session score + study panel */}
          {sessionScore !== null && !isCallActive && (
            <div className="shrink-0 border border-slate-700/50 rounded-2xl p-4 space-y-4" style={{ background: 'var(--t-card)' }}>
              <div className="flex items-center gap-4">
                <ScoreRing score={sessionScore} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white">Session Complete</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {corrections.length === 0
                      ? 'No corrections — flawless!'
                      : `${corrections.length} correction${corrections.length > 1 ? 's' : ''} · ${history.filter(m => m.sender === 'user').length} messages`}
                  </p>
                </div>
              </div>

              {sessionScore === 100 && (
                <div className="bg-emerald-950/40 border border-emerald-700/30 rounded-xl px-4 py-3 text-center">
                  <p className="text-sm font-semibold text-emerald-300">Flawless session! Keep it up!</p>
                </div>
              )}

              {studySummary.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Areas to Improve</span>
                    <span className="ml-auto text-[10px] text-slate-600">
                      {studySummary.reduce((s, i) => s + i.examples.length, 0)} · {studySummary.length} areas
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {studySummary.map((item) => (
                      <button key={item.category} onClick={() => startFocusedCall(item.category, item.examples)}
                        className="bg-slate-800/50 hover:bg-slate-700/60 border border-transparent hover:border-indigo-700/30 rounded-xl p-3 text-left transition-all group">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold text-amber-300 capitalize leading-tight">
                            {item.category.replace(/_/g, ' ')}
                          </span>
                          <span className="shrink-0 text-[9px] font-bold bg-amber-900/30 text-amber-500 px-1.5 py-0.5 rounded-full ml-1">
                            {item.examples.length}×
                          </span>
                        </div>
                        <div className="space-y-0.5 mb-2">
                          {item.examples.slice(0, 2).map((ex, i) => (
                            <p key={i} className="text-[10px] text-slate-500 truncate">
                              <span className="text-rose-400/80 line-through">"{ex.said}"</span>
                              <span className="text-slate-600 mx-0.5">→</span>
                              <span className="text-emerald-400/80">"{ex.correct}"</span>
                            </p>
                          ))}
                          {item.examples.length > 2 && (
                            <p className="text-[9px] text-slate-600">+{item.examples.length - 2} more</p>
                          )}
                        </div>
                        <p className="text-[9px] font-semibold text-indigo-500 group-hover:text-indigo-400 transition-colors">Practice →</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Quick theme switcher ── */}
          <div className="shrink-0 mt-auto pt-3 border-t border-slate-800/30">
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Theme</p>
            <div className="grid grid-cols-4 gap-1.5">
              {(Object.keys(THEMES) as ThemeName[]).map(t => (
                <button key={t} onClick={() => setSettings(s => ({ ...s, theme: t }))} title={THEMES[t].name}
                  className={`flex flex-col items-center gap-1 py-1.5 px-1 rounded-xl border transition-all ${
                    settings.theme === t ? 'border-white/40 bg-white/8 shadow-md' : 'border-transparent hover:border-slate-600/50 hover:bg-white/4'
                  }`}>
                  <div className={`w-6 h-6 rounded-full border-2 transition-all ${settings.theme === t ? 'border-white scale-110' : 'border-transparent'}`}
                    style={{ background: THEMES[t].swatch }} />
                  <span className={`text-[9px] font-semibold leading-none transition-colors ${settings.theme === t ? 'text-white' : 'text-slate-600'}`}>
                    {THEMES[t].name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* ── Right panel: Dialogue ── */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">

          {/* Dialogue header */}
          <div className="flex-none flex items-center justify-between px-4 md:px-6 py-3.5 border-b border-slate-800/40">
            <div className="flex items-center gap-2 text-slate-400">
              <MessageSquare className="w-3.5 h-3.5" />
              <span className="text-xs font-bold uppercase tracking-wider">Dialogue</span>
              {history.length > 0 && (
                <span className="text-[10px] bg-slate-700/80 text-slate-400 px-1.5 py-0.5 rounded-full">{history.length}</span>
              )}
            </div>
            {history.length > 0 && (
              <button
                onClick={() => setShowHistory(v => !v)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                {showHistory ? 'Hide' : 'Show'}
                <ChevronUp className={`w-3.5 h-3.5 transition-transform duration-200 ${showHistory ? '' : 'rotate-180'}`} />
              </button>
            )}
          </div>

          {/* Messages area */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-4">
            {!showHistory ? null : history.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-800/60 border border-slate-700/40 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-slate-600" />
                </div>
                <p className="text-sm text-slate-600 max-w-[180px] leading-relaxed">Start a session to begin the conversation</p>
              </div>
            ) : (
              <div className="space-y-4 pb-2">
                {history.map((msg) => (
                  <div key={msg.id} className={`flex items-start gap-2.5 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}>

                    {/* Avatar */}
                    <div className="shrink-0 w-8 h-8 mt-0.5 rounded-full overflow-hidden border border-slate-700/50" style={{ clipPath: 'circle(50%)' }}>
                      {msg.sender === 'luna' ? (
                        <div style={{ transform: 'scale(0.333)', transformOrigin: 'top left', width: '96px', height: '96px' }}>
                          <LunaAvatar status="idle" />
                        </div>
                      ) : (
                        <div className="w-full h-full bg-indigo-700 flex items-center justify-center">
                          <User className="w-4 h-4 text-white" />
                        </div>
                      )}
                    </div>

                    {/* Bubble */}
                    <div
                      className={`min-w-0 rounded-2xl overflow-hidden ${
                        msg.isReport
                          ? 'max-w-[92%] border border-indigo-700/40 rounded-tl-sm'
                          : msg.sender === 'user'
                            ? msg.feedback
                              ? 'max-w-[75%] border border-amber-600/30 rounded-tr-sm'
                              : msg.positive
                                ? 'max-w-[75%] border border-emerald-600/30 rounded-tr-sm'
                                : 'max-w-[75%] bg-indigo-600/25 border border-indigo-500/25 rounded-tr-sm'
                            : 'max-w-[75%] border border-slate-700/60 rounded-tl-sm'
                      }`}
                      style={msg.isReport ? { background: 'var(--t-report)' } : msg.sender === 'luna' ? { background: 'var(--t-bubble)' } : undefined}
                    >

                      {msg.isReport ? (
                        <div className="px-4 pt-3 pb-4">
                          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-indigo-700/30">
                            <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Session Report</span>
                            <span className="text-[9px] text-slate-500">{msg.timestamp}</span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(msg.text).catch(() => {});
                                setCopiedReportId(msg.id);
                                setTimeout(() => setCopiedReportId(null), 2000);
                              }}
                              className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all hover:bg-indigo-800/40"
                              title="Copy report to clipboard"
                            >
                              {copiedReportId === msg.id ? (
                                <>
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400">Copied!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-slate-400" />
                                  <span className="text-slate-400">Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                          <div className="space-y-1">
                            {msg.text.split('\n').map((line, i) => {
                              if (!line.trim()) return <div key={i} className="h-1.5" />;
                              // Horizontal rule
                              if (/^---+$/.test(line.trim())) return (
                                <hr key={i} className="border-indigo-800/40 my-2" />
                              );
                              // H1 section headers (# prefix or emoji-led headings)
                              if (/^#\s/.test(line)) return (
                                <p key={i} className="text-sm font-bold text-indigo-300 mt-4 mb-1">{line.replace(/^#+\s*/, '')}</p>
                              );
                              // H2 sub-headers
                              if (/^##\s/.test(line)) return (
                                <p key={i} className="text-xs font-bold text-slate-300 uppercase tracking-wider mt-3 mb-1">{line.replace(/^#+\s*/, '')}</p>
                              );
                              // Priority badges 🚨 ⚠️ 📌
                              if (/^[🚨⚠️📌]/.test(line)) return (
                                <p key={i} className="text-sm font-bold text-amber-300 mt-3 mb-0.5">{line}</p>
                              );
                              // Emoji section headers
                              if (/^[📊🔧💡🎯📈🌟✅💬🏆]/.test(line)) return (
                                <p key={i} className="text-sm font-bold text-indigo-300 mt-4 mb-1">{line}</p>
                              );
                              // Wins ✅
                              if (/^✅/.test(line)) return (
                                <p key={i} className="text-xs text-emerald-300 leading-relaxed pl-1">{line}</p>
                              );
                              // Insights ✓
                              if (/^✓/.test(line)) return (
                                <p key={i} className="text-xs text-cyan-300/80 leading-relaxed pl-1">{line}</p>
                              );
                              // Progress ⬆ ➡ ⬇
                              if (/^[⬆➡⬇]/.test(line)) return (
                                <p key={i} className="text-xs text-slate-300 leading-relaxed pl-1 font-medium">{line}</p>
                              );
                              // Dotted skill scores (e.g. "Communication ........ X/10")
                              if (/\.{4,}/.test(line)) return (
                                <p key={i} className="text-xs font-mono text-slate-300 leading-relaxed">{line}</p>
                              );
                              // Bullet points
                              if (/^[•·]/.test(line)) return (
                                <p key={i} className="text-xs text-slate-300 leading-relaxed pl-3">{line}</p>
                              );
                              // Numbered list
                              if (/^\d+\./.test(line)) return (
                                <p key={i} className="text-xs text-slate-300 leading-relaxed pl-3">{line}</p>
                              );
                              // Label: value pairs
                              if (/^(Student Said|Better Version|Why|Priority|Next Focus|Reason|Impact|Level|Stats):/.test(line)) {
                                const colon = line.indexOf(':');
                                return (
                                  <p key={i} className="text-xs text-slate-400 leading-relaxed">
                                    <span className="text-slate-400 font-semibold">{line.slice(0, colon)}:</span>
                                    <span className="text-slate-300">{line.slice(colon + 1)}</span>
                                  </p>
                                );
                              }
                              // Overall Score line
                              if (/^Overall Score:/.test(line)) return (
                                <p key={i} className="text-base font-bold text-white mt-1">{line}</p>
                              );
                              // Performance Level emoji line
                              if (/^[🟢🔵🟡🟠🔴]/.test(line)) return (
                                <p key={i} className="text-sm font-semibold text-slate-200">{line}</p>
                              );
                              return <p key={i} className="text-xs text-slate-400 leading-relaxed">{line}</p>;
                            })}
                          </div>
                        </div>
                      ) : (
                      <>
                      <div className={`px-3.5 pt-2.5 pb-2 ${
                        msg.sender === 'user' && (msg.feedback || msg.positive) ? 'bg-indigo-600/20' : ''
                      }`}>
                        <div className={`flex items-start gap-2 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}>
                          <button
                            onClick={() => replaySpeak(msg.text)}
                            className={`shrink-0 mt-0.5 p-1 rounded-lg transition-all ${
                              msg.sender === 'luna'
                                ? 'text-indigo-400/60 hover:text-indigo-300 hover:bg-indigo-900/40'
                                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/40'
                            }`}
                            title="Listen again"
                          >
                            <Volume2 className="w-3.5 h-3.5" />
                          </button>
                          <p className="text-sm text-slate-100 leading-relaxed flex-1 min-w-0">{msg.text}</p>
                        </div>
                        <div className={`text-[9px] text-slate-600 mt-1 ${msg.sender === 'user' ? 'text-right' : ''}`}>
                          {msg.timestamp}
                        </div>
                      </div>

                      {msg.positive && (
                        <div className="border-t border-emerald-800/40 px-3.5 py-2.5 bg-emerald-950/25">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-emerald-400 font-bold text-sm">✓</span>
                            <span className="text-xs font-bold text-emerald-400">Great</span>
                            <span className="ml-auto text-[10px] text-emerald-600 capitalize">{msg.positive.category.replace(/_/g, ' ')}</span>
                          </div>
                          {msg.positive.explanation && (
                            <p className="text-[11px] text-emerald-300/75 leading-relaxed">{msg.positive.explanation}</p>
                          )}
                        </div>
                      )}

                      {msg.feedback && (
                        <div className="border-t border-amber-800/40 px-3.5 py-2.5 bg-amber-950/25">
                          <div className="flex items-center gap-1.5 mb-2">
                            <span className="text-amber-400 font-bold text-sm">✗</span>
                            <span className="text-xs font-bold text-amber-400">Correction</span>
                            <span className="ml-auto text-[10px] text-amber-600 capitalize">{msg.feedback.category.replace(/_/g, ' ')}</span>
                          </div>
                          <div className="space-y-1 mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-slate-500 w-7 shrink-0">Said</span>
                              <span className="text-xs text-rose-400 line-through">"{msg.feedback.said}"</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-slate-500 w-7 shrink-0">Use</span>
                              <span className="text-xs text-emerald-400 font-semibold">"{msg.feedback.correct}"</span>
                            </div>
                          </div>
                          <p className="text-[10px] text-slate-400 italic leading-relaxed">{msg.feedback.explanation}</p>
                        </div>
                      )}
                      </>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={historyEndRef} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
