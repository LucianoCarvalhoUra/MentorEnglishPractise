import { useState, useEffect, useRef } from 'react';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Phone, PhoneOff, Sparkles, MessageSquare, Heart, Globe, BookOpen, X, Mic, MicOff, ChevronUp, Volume2, User, Settings } from 'lucide-react';

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

interface AppSettings {
  correctionLevel: 'off' | 'gentle' | 'strict';
  correctionTiming: 'realtime' | 'summary';
  speechRate: 'slow' | 'normal' | 'fast';
  modelQuality: 'fast' | 'quality';
}
const DEFAULT_SETTINGS: AppSettings = { correctionLevel: 'strict', correctionTiming: 'realtime', speechRate: 'normal', modelQuality: 'fast' };
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
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }; }
    catch { return DEFAULT_SETTINGS; }
  });
  const [showSettings, setShowSettings] = useState(false);

  // Study system
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [studySummary, setStudySummary] = useState<StudyItem[]>([]);
  const [focusTopic, setFocusTopic] = useState<string | null>(null);
  const [focusExamples, setFocusExamples] = useState<Array<{said: string; correct: string}>>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const [sessionScore, setSessionScore] = useState<number | null>(null);

  const recognitionRef = useRef<any>(null);
  const isCallActiveRef = useRef(false);
  const isSpeakingRef = useRef<boolean>(false);
  const silenceTimeoutRef = useRef<any>(null);
  const historyRef = useRef<ChatMessage[]>([]);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const correctionsRef = useRef<Correction[]>([]);
  const focusExamplesRef = useRef<Array<{said: string; correct: string}>>([]);
  const focusGreetingDoneRef = useRef(false);
  const resumeTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const isMutedRef = useRef(false);
  const processUserSpeechRef = useRef<(text: string) => void>(() => {});
  const historyEndRef = useRef<HTMLDivElement>(null);

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
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setStatus('listening');

    recognition.onresult = (event: any) => {
      const text = (event.results[0][0].transcript as string).trim();
      if (text.length > 2) {
        setCurrentTranscript(text);
        processUserSpeechRef.current(text);
      }
    };

    recognition.onend = () => {
      if (isCallActiveRef.current && !isSpeakingRef.current && !isMutedRef.current) {
        try { recognition.start(); } catch (_) {}
      } else if (!isCallActiveRef.current) {
        setStatus('idle');
      }
    };

    recognition.onerror = (e: any) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
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
      alert("Call disconnected due to silence.");
    }, 60000);
  };

  const parseLunaResponse = (fullText: string) => {
    const fullRegex = /\[CORRECTION\s+category="([^"]+)"\s+said="([^"]+)"\s+correct="([^"]+)"\]([\s\S]*?)\[\/CORRECTION\]/i;
    // Fallback when AI forgets to close the tag — capture only the first sentence as explanation
    const openRegex = /\[CORRECTION\s+category="([^"]+)"\s+said="([^"]+)"\s+correct="([^"]+)"\]([\s\S]{0,150}?[.!?])/i;
    const match = fullText.match(fullRegex) ?? fullText.match(openRegex);

    let cleanText = fullText;
    let feedback: Correction | undefined;
    let positive: Positive | undefined;

    if (match) {
      const [fullTag, category, said, correct, explanation] = match;
      cleanText = fullText.replace(fullTag, '').trim();
      feedback = { category, said, correct, explanation: explanation.trim() };
    }

    const posFull = /\[POSITIVE\s+category="([^"]+)"\s+example="([^"]+)"\]([\s\S]*?)\[\/POSITIVE\]/i;
    const posOpen = /\[POSITIVE\s+category="([^"]+)"\s+example="([^"]+)"\]([\s\S]{0,150}?[.!?])/i;
    const posMatch = cleanText.match(posFull) ?? cleanText.match(posOpen);
    if (posMatch) {
      const [posTag, category, example, explanation] = posMatch;
      cleanText = cleanText.replace(posTag, '').trim();
      positive = { category, example, explanation: explanation.trim() };
    }

    cleanText = cleanText
      .replace(/\[CORRECTION[^\]]*\]/gi, '')
      .replace(/\[\/CORRECTION\]/gi, '')
      .replace(/\[POSITIVE[^\]]*\]/gi, '')
      .replace(/\[\/POSITIVE\]/gi, '')
      .trim();

    return { cleanText, feedback, positive };
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

      const correctionBlock = settings.correctionLevel === 'off'
        ? `# Corrections: OFF\nDo NOT correct mistakes. Have a natural conversation.`
        : isSummaryMode
          ? `# Correction (SILENT LOG)
For EVERY mistake: insert the tag silently, then reply naturally — never mention the error aloud.
[CORRECTION category="slug" said="their words" correct="fix"]Note.[/CORRECTION] Natural reply.
Example: [CORRECTION category="vocabulary" said="hob" correct="hobby"]→hobby[/CORRECTION] Motorcycling is cool! Do you ride often?
Slugs: ${slugs}`
          : settings.correctionLevel === 'gentle'
            ? `# Correction (GENTLE)
When the student makes a clear mistake, correct it briefly.
ALWAYS close the tag with [/CORRECTION] before continuing your reply.
Format: [CORRECTION category="<slug>" said="<their words>" correct="<fix>"]2–4 words.[/CORRECTION] Your reply continues here.
Example: [CORRECTION category="vocabulary" said="hob" correct="hobby"]Say "hobby".[/CORRECTION] That sounds like a fun hobby!
Valid slugs: ${slugs}`
            : `# Correction (STRICT)
Correct EVERY grammar, vocabulary, or word-order mistake.
ALWAYS close the tag with [/CORRECTION] before continuing your reply.
Format: [CORRECTION category="<slug>" said="<their exact words>" correct="<correct form>"]One sentence explaining the rule.[/CORRECTION] Your reply continues here.
Example: [CORRECTION category="vocabulary" said="hob" correct="hobby"]"Hob" isn't a word — the correct word is "hobby".[/CORRECTION] Motorcycling sounds exciting! Do you ride often?
Valid slugs: ${slugs}`;

      const positiveBlock = settings.correctionLevel !== 'off'
        ? `# Positive reinforcement (OPTIONAL)
When the student uses something correctly that they struggled with before:
Format: [POSITIVE category="<slug>" example="<their words>"]One short praise phrase.[/POSITIVE] Your reply continues here.
Example: [POSITIVE category="present_perfect" example="I have been practicing"]Great use of present perfect![/POSITIVE] That's real progress!
Only when genuinely noteworthy. Never combine with CORRECTION in the same turn.`
        : '';

      const systemPrompt = `
# Personality
You are Luna, a warm and encouraging ${languageNames[targetLanguage]} language tutor. You celebrate small wins and adapt to the student's level in real time.
${focusLine}

# Adaptive level
Never ask "what level are you?" — assess through conversation. Beginners: simple words, slow pace. Advanced: idioms, complex grammar.

# Goal
Help the student practice conversational ${languageNames[targetLanguage]}. Introduce 1–2 new words per session in context.

${correctionBlock}

# Turn-taking
- 1–2 short sentences, then stop and wait.
- Ask ONE question per turn.

${positiveBlock}

# Guardrails
- Keep all topics appropriate for all ages.
- Never mock errors or accent.
      `.trim();

      const messages: LLMMessage[] = updatedHistory.map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text,
      }));

      const groqModel = GROQ_MODELS[settings.modelQuality];
      const responseText = await callLLM(systemPrompt, messages, groqModel);

      const { cleanText, feedback, positive } = parseLunaResponse(responseText);

      if (feedback) {
        setCorrections(prev => [...prev, feedback]);
      }

      // In realtime mode: show feedback/positive inside the user bubble
      // In summary mode: collect silently, don't show in chat
      if (!isSummaryMode && (feedback || positive)) {
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
      // In realtime mode, speak the correction aloud; in summary mode stay silent
      if (!isSummaryMode && feedback) {
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

  // Trigger the greeting once whenever a call begins
  useEffect(() => {
    if (isCallActive && !focusGreetingDoneRef.current) {
      focusGreetingDoneRef.current = true;
      if (focusTopic) {
        generateFocusGreeting(focusTopic);
      } else {
        generateOpeningGreeting();
      }
    } else if (!isCallActive) {
      focusGreetingDoneRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCallActive, focusTopic]);

  const startCall = () => {
    if (!GROQ_KEY && !OPENROUTER_KEY && !GEMINI_KEY) { alert("Please add VITE_GROQ_API_KEY, VITE_OPENROUTER_API_KEY, or VITE_GEMINI_API_KEY to your .env file."); return; }
    if (!recognitionRef.current) { alert("Speech recognition requires Chrome or Edge."); return; }
    playBeep('start');
    setIsCallActive(true);
    isCallActiveRef.current = true;
    setHistory([]);
    setCorrections([]);
    setStudySummary([]);
    setSessionScore(null);
    resetSilenceTimeout();
    // Recognition starts automatically after Aria's opening greeting (speak → resumeListening)
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

  const startFocusedCall = (topic: string, examples: Array<{said: string; correct: string}>) => {
    setFocusTopic(topic);
    setFocusExamples(examples);
    setTimeout(startCall, 50);
  };

  return (
    <div className="h-screen bg-[#0b0f19] text-slate-200 flex flex-col overflow-hidden font-sans">

      {/* ── Top bar ─────────────────────────────────── */}
      <header className="flex-none flex items-center justify-between px-4 md:px-6 py-3 border-b border-slate-800/50 bg-[#0d1220]/95 backdrop-blur">
        <div className="flex items-center gap-2">
          <Sparkles className="text-pink-400 w-4 h-4" />
          <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">MentorStudy</span>
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
              <option value="en-US" className="bg-[#131926]">English</option>
              <option value="es-ES" className="bg-[#131926]">Spanish</option>
              <option value="fr-FR" className="bg-[#131926]">French</option>
              <option value="de-DE" className="bg-[#131926]">German</option>
            </select>
          </div>
          <button
            onClick={() => setShowSettings(v => !v)}
            disabled={isCallActive}
            className={`p-1.5 rounded-xl border transition-all disabled:opacity-40 ${
              showSettings
                ? 'bg-indigo-600/30 border-indigo-500/40 text-indigo-300'
                : 'bg-slate-800/80 border-slate-700/60 text-slate-400 hover:text-slate-200'
            }`}
            title="Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* ── Settings panel ──────────────────────────── */}
      {showSettings && !isCallActive && (
        <div className="flex-none border-b border-slate-800/50 bg-[#0d1220]/95 backdrop-blur px-4 md:px-6 py-4">
          <div className="max-w-xl mx-auto grid grid-cols-1 gap-3">

            {/* Correction level */}
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Correction level</p>
              <div className="flex gap-2">
                {(['off', 'gentle', 'strict'] as const).map(l => (
                  <button key={l} onClick={() => setSettings(s => ({ ...s, correctionLevel: l }))}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize ${
                      settings.correctionLevel === l ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}>
                    {l === 'off' ? 'Off' : l === 'gentle' ? 'Gentle' : 'Strict'}
                  </button>
                ))}
              </div>
            </div>

            {/* Correction timing */}
            {settings.correctionLevel !== 'off' && (
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Correction timing</p>
                <div className="flex gap-2">
                  {(['realtime', 'summary'] as const).map(t => (
                    <button key={t} onClick={() => setSettings(s => ({ ...s, correctionTiming: t }))}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        settings.correctionTiming === t ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}>
                      {t === 'realtime' ? 'Real-time' : 'End summary'}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-600 mt-1">
                  {settings.correctionTiming === 'realtime'
                    ? 'Corrections appear inside each message bubble as you speak.'
                    : 'Luna converses naturally — corrections shown only in the session summary.'}
                </p>
              </div>
            )}

            {/* Speech speed */}
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Speech speed</p>
              <div className="flex gap-2">
                {(['slow', 'normal', 'fast'] as const).map(s => (
                  <button key={s} onClick={() => setSettings(prev => ({ ...prev, speechRate: s }))}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all capitalize ${
                      settings.speechRate === s ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}>
                    {s === 'slow' ? 'Slow' : s === 'normal' ? 'Normal' : 'Fast'}
                  </button>
                ))}
              </div>
            </div>

            {/* AI quality */}
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">AI quality</p>
              <div className="flex gap-2">
                {(['fast', 'quality'] as const).map(q => (
                  <button key={q} onClick={() => setSettings(s => ({ ...s, modelQuality: q }))}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      settings.modelQuality === q ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}>
                    {q === 'fast' ? 'Fast (8B)' : 'Better (70B)'}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-600 mt-1">Better follows correction rules more reliably; Fast responds quicker.</p>
            </div>

          </div>
        </div>
      )}

      {/* ── Scrollable body ──────────────────────────── */}
      <div className={`flex-1 min-h-0 flex flex-col w-full max-w-xl mx-auto px-4 py-4 gap-3 ${
        isCallActive ? 'overflow-hidden' : 'overflow-y-auto'
      }`}>

        {/* Focus mode badge */}
        {focusTopic && !isCallActive && (
          <div className="flex-none flex items-center gap-2 bg-indigo-950/60 border border-indigo-700/40 px-4 py-2 rounded-xl">
            <BookOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="text-xs text-indigo-300 flex-1">
              Focus: <span className="font-semibold capitalize">{focusTopic}</span>
            </span>
            <button onClick={() => setFocusTopic(null)} className="text-slate-500 hover:text-slate-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ── Aria panel ───────────────────────────── */}
        {isCallActive ? (
          /* Compact bar during call */
          <div className="flex-none flex items-center gap-3 bg-[#131926] border border-slate-800/60 rounded-2xl px-4 py-2.5 shadow-lg">
            <div className="shrink-0 w-11 h-11 overflow-hidden" style={{ clipPath: 'circle(50%)' }}>
              <div style={{ transform: 'scale(0.46)', transformOrigin: 'top left', width: '96px', height: '96px' }}>
                <LunaAvatar status={status} />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-white">Luna</span>
                <Heart className="w-3 h-3 text-pink-500 fill-pink-500" />
                {settings.correctionTiming === 'summary' && settings.correctionLevel !== 'off' && (
                  <span className="text-[9px] font-bold bg-violet-800/60 text-violet-300 px-1.5 py-0.5 rounded-full border border-violet-700/40">
                    {corrections.length > 0 ? `${corrections.length} logged` : 'logging'}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-indigo-400 font-mono capitalize">{status}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={interruptLuna}
                disabled={status !== 'speaking'}
                title="Interrupt"
                className="p-2 rounded-xl bg-amber-600/70 hover:bg-amber-600 disabled:opacity-25 disabled:cursor-not-allowed text-white transition-all"
              >
                <PhoneOff className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={toggleMute}
                title={isMuted ? 'Unmute' : 'Mute'}
                className={`p-2 rounded-xl transition-all text-white ${isMuted ? 'bg-rose-700 hover:bg-rose-600' : 'bg-slate-700 hover:bg-slate-600'}`}
              >
                {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={endCall}
                className="px-3 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1.5 transition-all"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                End
              </button>
            </div>
          </div>
        ) : (
          /* Full card when idle */
          <div className="flex-none bg-[#131926] rounded-3xl border border-slate-800/80 p-6 shadow-2xl flex flex-col items-center relative">
            <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-32 h-32 bg-pink-600/10 blur-3xl rounded-full pointer-events-none" />
            <div className="relative mb-3">
              <LunaAvatar status={status} />
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-1.5">
              Luna <Heart className="w-3.5 h-3.5 text-pink-500 fill-pink-500" />
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 mb-5 capitalize">
              <span className="text-indigo-400 font-mono">{status}</span>
            </p>
            {!isSpeechSupported && (
              <p className="text-xs text-rose-400 mb-4 text-center">Speech recognition requires Chrome or Edge.</p>
            )}
            <button
              onClick={startCall}
              disabled={!isSpeechSupported}
              className="w-full py-3 px-6 rounded-xl font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white flex items-center justify-center gap-2 transition-all shadow-lg"
            >
              <Phone className="w-4 h-4" />
              Start Session{focusTopic ? ` · ${focusTopic}` : ''}
            </button>
          </div>
        )}

        {/* Transcript preview */}
        {currentTranscript && (
          <div className="flex-none bg-indigo-950/30 border border-indigo-900/40 px-4 py-2.5 rounded-xl">
            <p className="text-sm text-indigo-300 italic">"{currentTranscript}"</p>
          </div>
        )}

        {/* Session Score + Study Panel */}
        {sessionScore !== null && !isCallActive && (
          <div className="flex-none bg-[#131926] border border-slate-700/50 rounded-2xl p-4 space-y-4">
            {/* Score header */}
            <div className="flex items-center gap-4">
              <ScoreRing score={sessionScore} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">Session Complete</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {corrections.length === 0
                    ? 'No corrections — flawless!'
                    : `${corrections.length} correction${corrections.length > 1 ? 's' : ''} across ${history.filter(m => m.sender === 'user').length} messages`}
                </p>
              </div>
            </div>

            {/* Perfect score */}
            {sessionScore === 100 && (
              <div className="bg-emerald-950/40 border border-emerald-700/30 rounded-xl px-4 py-3 text-center">
                <p className="text-sm font-semibold text-emerald-300">Flawless session! Keep it up!</p>
              </div>
            )}

            {/* Areas to improve */}
            {studySummary.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Areas to Improve</span>
                </div>
                {studySummary.map((item) => (
                  <div key={item.category} className="bg-slate-800/50 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-amber-300 capitalize">{item.category.replace(/_/g, ' ')}</span>
                      <span className="text-[10px] text-slate-500">{item.examples.length} correction{item.examples.length > 1 ? 's' : ''}</span>
                    </div>
                    <div className="space-y-0.5 mb-2.5">
                      {item.examples.map((ex, i) => (
                        <p key={i} className="text-[11px] text-slate-400">
                          <span className="text-rose-400 line-through mr-1">"{ex.said}"</span>
                          <span className="text-slate-600 mr-1">→</span>
                          <span className="text-emerald-400">"{ex.correct}"</span>
                        </p>
                      ))}
                    </div>
                    <button
                      onClick={() => startFocusedCall(item.category, item.examples)}
                      className="w-full py-1.5 px-3 rounded-lg text-xs font-semibold bg-indigo-600/80 hover:bg-indigo-600 text-white transition-all"
                    >
                      Practice {item.category.replace(/_/g, ' ')} with Luna
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Dialogue ── */}
        <div className={`flex flex-col ${isCallActive ? 'flex-1 min-h-0' : ''}`}>
          <div className="flex-none flex items-center justify-between pb-2">
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

          {showHistory && (
            <div className={`space-y-4 pr-1 pb-2 overflow-y-auto ${isCallActive ? 'flex-1 min-h-0' : 'max-h-[45vh]'}`}>
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
                  <div className={`min-w-0 max-w-[75%] rounded-2xl overflow-hidden ${
                    msg.sender === 'user'
                      ? msg.feedback
                        ? 'border border-amber-600/30 rounded-tr-sm'
                        : msg.positive
                          ? 'border border-emerald-600/30 rounded-tr-sm'
                          : 'bg-indigo-600/25 border border-indigo-500/25 rounded-tr-sm'
                      : 'bg-[#141d2f] border border-slate-700/60 rounded-tl-sm'
                  }`}>

                    {/* Main text */}
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

                    {/* Positive sub-section */}
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

                    {/* Correction sub-section */}
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
                  </div>
                </div>
              ))}
              <div ref={historyEndRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
