import React, { useState, useEffect, useRef, useCallback } from 'react';
import { countWords, detectSpeaker, SourceMode, SuggestionItem, DiscussionPreset } from './utils/copilot';

interface TranscriptItem {
  id: string;
  speaker: 'THEM' | 'YOU';
  text: string;
  timestamp: string;
  isSimulated?: boolean;
}

function renderFormattedSentence(text: string, highlightClass = 'text-emerald-300') {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          const inner = part.slice(2, -2);
          return (
            <strong key={i} className={`${highlightClass} font-black underline decoration-1 underline-offset-2`}>
              {inner}
            </strong>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

const INITIAL_NOTES = `ORGANIZATIONAL_MANDATE & CONTEXT:
Operating review for Boston Medical Center (BMC) health system integration. The five teams run one planning and performance cycle in which the explanation, the forecast, and the operating commitment use the same governed numbers.

REGULATORY & REPORTING COMPLIANCE:
All campus reporting must strictly satisfy Massachusetts CHIA (Center for Health Information and Analysis) statutory filing standards. Pre-support operating results are reported transparently, isolating historical liabilities from acquired facilities.

CONTROLLABLE_LEVERS:
Isolate boarding hours, sitter hours, and traveler differentials against the flexible budget. The variance action log tracks controllable residuals with committed owners.

SAMPLE_QA:
Q: What specific CMS changes are going to impact us in 2027?
A: Our baseline forecast accounts for CMS regulatory changes by locking a governed baseline bridge that separates statutory payment reductions from controllable operating margin.

Q: What happens if our stakeholders request additional custom reports?
A: We maintain a clear scope boundary where net-new reporting requirements are estimated and scheduled into Phase 2 releases.`;

export default function App() {
  // 1. STRATEGIC COORDINATES (Who we are, Who they are, Discussion Scope, Target Gain)
  const [discussionPreset, setDiscussionPreset] = useState<DiscussionPreset>({
    whoWeAre: 'VP of Finance & Hospital Operations Lead (BMC)',
    whoTheyAre: 'Operating Leaders, Clinical Chairs & Regulatory Counterparts',
    discussionScope: 'Governance, hospital financial integration, and regulatory compliance',
    targetGain: 'Lock governed variance packs and verify statutory reporting compliance',
  });
  const [isCoordinatesOpen, setIsCoordinatesOpen] = useState<boolean>(true);
  const discussionPresetRef = useRef(discussionPreset);
  discussionPresetRef.current = discussionPreset;

  // 2. MODULATORS (Temperature & Option B Search Mode)
  const [temperature, setTemperature] = useState<number>(0.35);
  const [radarSearchMode, setRadarSearchMode] = useState<'domain_search' | 'blended'>('domain_search');

  // 3. LEFT COLUMN: Knowledge Bank & Notes + Live Notes
  const [sessionNotes, setSessionNotes] = useState<string>(INITIAL_NOTES);
  const [liveNotesFilter, setLiveNotesFilter] = useState<string>('');
  const [liveNotesList, setLiveNotesList] = useState<string[]>([
    'All campus reporting must strictly satisfy Massachusetts CHIA statutory filing standards',
    'Five finance teams integrate into one governed planning and performance cycle',
    'Controllable labor isolates boarding hours, sitter hours, and traveler differentials',
    'Pre-support operating results isolate historical liabilities from acquired facilities',
  ]);
  const [manualNoteInput, setManualNoteInput] = useState<string>('');
  const [isExtractingNotes, setIsExtractingNotes] = useState<boolean>(false);

  // 4. CENTER COLUMN: Dual-Track Suggestion Box
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([
    {
      id: 'sug-1',
      label: 'Option A: Spoken Anchor (Content)',
      mode: 'PREPARED',
      sayThis: 'As **governed hospital leadership**, we maintain transparent, verified compliance with **CHIA statutory filings** while isolating acquired facilities from historical reporting liabilities.',
      wordCount: 22,
    },
    {
      id: 'sug-2',
      label: 'Option B: Recall Radar (Domain & Search)',
      mode: 'DOMAIN',
      sayThis: 'Steward cited private equity ownership to withhold audited **CHIA financial statements**, triggering **state superior court contempt orders** prior to their Chapter 11 bankruptcy.',
      wordCount: 24,
    },
  ]);
  const [recallHook, setRecallHook] = useState<string>(
    'unsupported: Massachusetts AG and CHIA issued civil subpoenas and fines against Steward for unfiled audited financials'
  );
  const [objectiveStatus, setObjectiveStatus] = useState<string>(
    'CHIA statutory reporting transparency and liability ring-fencing asserted'
  );
  const [isLoadingA, setIsLoadingA] = useState<boolean>(false);
  const [isLoadingB, setIsLoadingB] = useState<boolean>(false);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [activeEngine, setActiveEngine] = useState<string>('context-engine');
  const [isQuotaLimited, setIsQuotaLimited] = useState<boolean>(false);
  const [lastTriggerSource, setLastTriggerSource] = useState<string>('Initial Load');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 5. RIGHT COLUMN: Live Transcript & Speech Engine
  const [isListening, setIsListening] = useState<boolean>(false);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [transcriptHistory, setTranscriptHistory] = useState<TranscriptItem[]>([
    {
      id: 't-1',
      speaker: 'THEM',
      text: 'why did stewart not file CHIA reports',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    },
  ]);
  const [speakerMode, setSpeakerMode] = useState<'AUTO' | 'THEM' | 'YOU'>('AUTO');
  const [simulatedInput, setSimulatedInput] = useState<string>('');
  const [simulatedSpeaker, setSimulatedSpeaker] = useState<'THEM' | 'YOU'>('THEM');
  const [speechSupported, setSpeechSupported] = useState<boolean>(true);
  const [pauseCountdown, setPauseCountdown] = useState<number | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);

  // Audio Context & Analyser Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Speech Recognition & Debounce Refs
  const isListeningRef = useRef<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const pauseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSpeechRef = useRef<string>('');
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);

  // Refs for current values
  const sessionNotesRef = useRef(sessionNotes);
  sessionNotesRef.current = sessionNotes;
  const transcriptHistoryRef = useRef(transcriptHistory);
  transcriptHistoryRef.current = transcriptHistory;
  const speakerModeRef = useRef(speakerMode);
  speakerModeRef.current = speakerMode;

  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcriptHistory, interimTranscript]);

  // Request Suggestions (Option A is instant, Option B runs in parallel)
  const requestSuggestion = useCallback(
    async (params: {
      turnText?: string;
      isAlternate?: boolean;
      triggerLabel: string;
      which?: 'both' | 'a' | 'b';
      speaker?: 'THEM' | 'YOU';
    }) => {
      const { turnText, isAlternate = false, triggerLabel, which = 'both', speaker = 'THEM' } = params;
      setLastTriggerSource(triggerLabel);
      const startTime = performance.now();

      const lastItem = transcriptHistoryRef.current.length > 0
        ? transcriptHistoryRef.current[transcriptHistoryRef.current.length - 1]
        : null;

      const rawText = turnText !== undefined ? turnText : (lastItem ? lastItem.text : 'What should we say right now?');
      const cleanTurn = rawText.replace(/^\[(THEM|YOU)\]:\s*/i, '').trim();
      const effectiveSpeaker = speaker || (lastItem ? lastItem.speaker : 'THEM');
      const formattedLatestTurn = `[${effectiveSpeaker}]: ${cleanTurn}`;

      const recentTranscript = transcriptHistoryRef.current
        .slice(-6)
        .map((t) => `[${t.speaker}]: ${t.text.replace(/^\[(THEM|YOU)\]:\s*/i, '').trim()}`);

      // When refreshing both (e.g. after speech pause or button), serve Option A INSTANTLY
      if (which === 'both') {
        setIsLoadingA(true);
        setIsLoadingB(true);

        // 1. Fetch Option A INSTANTLY (<20ms from intelligent context engine)
        fetch('/api/copilot/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionNotes: sessionNotesRef.current,
            latestTurn: formattedLatestTurn,
            which: 'a',
            discussionPreset: discussionPresetRef.current,
            temperature,
            radarSearchMode,
          }),
        })
          .then((r) => r.json())
          .then((dataA) => {
            const durationA = Math.round(performance.now() - startTime);
            setLastLatencyMs(durationA);
            if (dataA.success && Array.isArray(dataA.suggestions) && dataA.suggestions[0]) {
              setSuggestions((prev) => [dataA.suggestions[0], prev[1] || dataA.suggestions[1]]);
              if (dataA.recallHook) setRecallHook(dataA.recallHook);
              if (dataA.objectiveStatus) setObjectiveStatus(dataA.objectiveStatus);
            }
          })
          .catch((err) => console.warn('Option A error:', err))
          .finally(() => setIsLoadingA(false));

        // 2. Fetch Option B in parallel (Gemini LLM / domain search in background)
        fetch('/api/copilot/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionNotes: sessionNotesRef.current,
            recentTranscript,
            latestTurn: formattedLatestTurn,
            which: 'b',
            discussionPreset: discussionPresetRef.current,
            temperature,
            radarSearchMode,
          }),
        })
          .then((r) => r.json())
          .then((dataB) => {
            if (dataB.sourceEngine) setActiveEngine(dataB.sourceEngine);
            if (dataB.quotaLimited) setIsQuotaLimited(true);
            if (dataB.success && Array.isArray(dataB.suggestions)) {
              const optB = dataB.suggestions[1] || dataB.suggestions[0];
              if (optB) {
                setSuggestions((prev) => [prev[0], optB]);
              }
            }
          })
          .catch((err) => console.warn('Option B error:', err))
          .finally(() => setIsLoadingB(false));

        return;
      }

      // Handle single card click (which === 'a' or which === 'b')
      if (which === 'a') setIsLoadingA(true);
      if (which === 'b') setIsLoadingB(true);

      try {
        const response = await fetch('/api/copilot/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionNotes: sessionNotesRef.current,
            recentTranscript,
            latestTurn: formattedLatestTurn,
            isAlternate,
            which,
            discussionPreset: discussionPresetRef.current,
            temperature,
            radarSearchMode,
          }),
        });

        const data = await response.json();
        const duration = Math.round(performance.now() - startTime);
        setLastLatencyMs(duration);
        if (data.sourceEngine) {
          setActiveEngine(data.sourceEngine);
        }
        if (data.quotaLimited) {
          setIsQuotaLimited(true);
        }

        if (data.success && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
          setSuggestions((prev) => {
            if (which === 'a') {
              return [data.suggestions[0], prev[1] || data.suggestions[1]];
            }
            if (which === 'b') {
              return [prev[0], data.suggestions[1] || data.suggestions[0]];
            }
            return data.suggestions;
          });

          if (data.recallHook) setRecallHook(data.recallHook);
          if (data.objectiveStatus) setObjectiveStatus(data.objectiveStatus);
        }
      } catch (err) {
        console.warn('Suggestion request notice:', err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoadingA(false);
        setIsLoadingB(false);
      }
    },
    [temperature, radarSearchMode]
  );

  // Manual Click-Only Extract Live Notes
  const handleExtractLiveNotes = async () => {
    setIsExtractingNotes(true);
    try {
      const response = await fetch('/api/copilot/extract-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionNotes: sessionNotesRef.current,
          transcriptHistory: transcriptHistoryRef.current.map((t) => t.text),
          filter: liveNotesFilter,
        }),
      });
      const data = await response.json();
      if (data.success && Array.isArray(data.bullets)) {
        setLiveNotesList(data.bullets);
      }
    } catch (e) {
      console.warn('Failed to extract notes:', e);
    } finally {
      setIsExtractingNotes(false);
    }
  };

  const handleAddManualNote = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = manualNoteInput.trim();
    if (!clean) return;
    setLiveNotesList((prev) => [clean, ...prev]);
    setManualNoteInput('');
  };

  const handleDeleteNote = (idx: number) => {
    setLiveNotesList((prev) => prev.filter((_, i) => i !== idx));
  };

  // Handle Spoken Turn Completed
  const handleSpokenTurnCompleted = useCallback(
    (spokenText: string, isSimulated = false, forceSpeaker?: 'THEM' | 'YOU') => {
      const trimmed = spokenText.trim();
      if (!trimmed) return;

      const speaker = forceSpeaker || detectSpeaker(trimmed, speakerModeRef.current);

      const newItem: TranscriptItem = {
        id: 't-' + Date.now(),
        speaker,
        text: trimmed,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        isSimulated,
      };

      setTranscriptHistory((prev) => [...prev, newItem]);
      setInterimTranscript('');
      pendingSpeechRef.current = '';

      requestSuggestion({
        turnText: trimmed,
        isAlternate: false,
        triggerLabel: isSimulated ? 'Simulated Turn' : 'Speech 1.0s Pause',
        speaker,
      });
    },
    [requestSuggestion]
  );

  // Toggle speaker attribution on past transcript bubble
  const handleToggleSpeaker = (turnId: string) => {
    setTranscriptHistory((prev) => {
      const updated = prev.map((item) => {
        if (item.id === turnId) {
          return {
            ...item,
            speaker: item.speaker === 'THEM' ? ('YOU' as const) : ('THEM' as const),
          };
        }
        return item;
      });

      const changedItem = updated.find((t) => t.id === turnId);
      if (changedItem) {
        requestSuggestion({
          turnText: changedItem.text,
          triggerLabel: `Speaker Toggled [${changedItem.speaker}]`,
          speaker: changedItem.speaker,
        });
      }

      return updated;
    });
  };

  // Merge the 4 Alignment fields into top of notes
  const handleMergeToNotes = () => {
    const header = `ALIGNMENT_COORDINATES:
WHO_WE_ARE: ${discussionPreset.whoWeAre}
COUNTERPART: ${discussionPreset.whoTheyAre}
DISCUSSION_SCOPE: ${discussionPreset.discussionScope}
TARGET_GAIN: ${discussionPreset.targetGain}\n\n`;

    setSessionNotes((prev) => {
      if (prev.includes('ALIGNMENT_COORDINATES:')) {
        return prev.replace(/ALIGNMENT_COORDINATES:[\s\S]*?(?=\n\n[A-Z_]+:|$)/, header.trim());
      }
      return header + prev;
    });
    setIsCoordinatesOpen(false);
  };

  const handleInsertSnippet = (snippet: string) => {
    setSessionNotes((prev) => prev.trim() + '\n\n' + snippet);
  };

  // Audio meter
  const startAudioMeter = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateMeter = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const normalized = Math.min(100, Math.round((average / 128) * 100));
        setAudioLevel(normalized);
        animationFrameRef.current = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch (e) {
      console.warn('Audio meter initialization bypassed:', e);
    }
  };

  const stopAudioMeter = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  };

  // Web Speech Recognition
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        isListeningRef.current = true;
        startAudioMeter();
      };

      recognition.onend = () => {
        if (isListeningRef.current) {
          try {
            recognition.start();
          } catch (e) {}
        } else {
          setIsListening(false);
          stopAudioMeter();
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition status:', event.error);
        if (event.error === 'not-allowed') {
          setIsListening(false);
          isListeningRef.current = false;
          stopAudioMeter();
        }
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          const transcriptChunk = item[0].transcript;
          if (item.isFinal) {
            final += transcriptChunk + ' ';
          } else {
            interim += transcriptChunk;
          }
        }

        if (final) {
          pendingSpeechRef.current = (pendingSpeechRef.current + ' ' + final).trim();
        }
        setInterimTranscript(interim);

        if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

        const startTime = Date.now();
        const pauseDurationMs = 1000;
        setPauseCountdown(1.0);

        countdownIntervalRef.current = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const remainingMs = Math.max(0, pauseDurationMs - elapsed);
          if (remainingMs <= 0) {
            if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
            setPauseCountdown(null);
          } else {
            setPauseCountdown(Math.round((remainingMs / 1000) * 10) / 10);
          }
        }, 200);

        pauseTimerRef.current = setTimeout(() => {
          const totalText = (pendingSpeechRef.current + ' ' + interim).trim();
          if (totalText.length > 2) {
            handleSpokenTurnCompleted(totalText, false);
          }
          setPauseCountdown(null);
        }, 1000);
      };

      recognitionRef.current = recognition;
    } catch (e) {
      console.error('Speech recognition error:', e);
      setSpeechSupported(false);
    }

    return () => {
      isListeningRef.current = false;
      stopAudioMeter();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, [handleSpokenTurnCompleted]);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      isListeningRef.current = false;
      recognitionRef.current.stop();
      setIsListening(false);
      stopAudioMeter();
    } else {
      try {
        isListeningRef.current = true;
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.warn('Recognition start exception:', e);
      }
    }
  };

  const handleCopy = (id: string, text: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const cleanText = text.replace(/[*_]/g, '');
    navigator.clipboard.writeText(cleanText);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getModeBadgeClass = (mode: SourceMode) => {
    switch (mode) {
      case 'PREPARED':
        return 'bg-emerald-950 text-emerald-300 border-emerald-500';
      case 'YOUR_PROJECT':
        return 'bg-blue-950 text-blue-300 border-blue-500';
      case 'DOMAIN':
        return 'bg-purple-950 text-purple-300 border-purple-500';
      case 'STRATEGIC':
        return 'bg-amber-950 text-amber-300 border-amber-500';
      case 'LIFELINE':
        return 'bg-rose-950 text-rose-300 border-rose-500';
      default:
        return 'bg-neutral-800 text-neutral-200 border-neutral-600';
    }
  };

  const optA = suggestions[0] || {
    id: 'sug-1',
    label: 'Option A: Spoken Anchor (Content)',
    mode: 'PREPARED',
    sayThis: 'As **governed hospital leadership**, we maintain transparent, verified compliance with **CHIA statutory filings** while isolating acquired facilities from historical reporting liabilities.',
    wordCount: 22,
  };

  const optB = suggestions[1] || {
    id: 'sug-2',
    label: 'Option B: Recall Radar (Domain & Search)',
    mode: 'DOMAIN',
    sayThis: 'Steward cited private equity ownership to withhold audited **CHIA financial statements**, triggering **state superior court contempt orders** prior to their Chapter 11 bankruptcy.',
    wordCount: 24,
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-neutral-950 text-neutral-100 font-mono select-none overflow-hidden text-sm">
      {/* Top Header Banner */}
      <header className="h-10 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-4 shrink-0 text-xs">
        <div className="flex items-center gap-3">
          <span className="font-bold text-neutral-200 tracking-wider uppercase">
            REAL-TIME DISCUSSION COPILOT
          </span>
          <span className="text-neutral-500">|</span>
          <span className="text-neutral-400">Option A: Content Anchor | Option B: Domain Search Radar</span>
        </div>
        <div className="flex items-center gap-4">
          {/* Active Audio Decibel Meter */}
          {isListening && (
            <div className="flex items-center gap-1.5 bg-neutral-950 px-2 py-0.5 border border-neutral-700 rounded">
              <span className="text-[10px] text-neutral-400">MIC:</span>
              <div className="w-16 h-2 bg-neutral-800 rounded-sm overflow-hidden flex">
                <div
                  className={`h-full transition-all duration-75 ${
                    audioLevel > 60 ? 'bg-emerald-400' : audioLevel > 20 ? 'bg-emerald-500' : 'bg-emerald-700'
                  }`}
                  style={{ width: `${Math.max(4, audioLevel)}%` }}
                ></div>
              </div>
            </div>
          )}

          {isListening ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-400 font-bold bg-emerald-950/80 px-2 py-0.5 border border-emerald-600 rounded">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              MIC ACTIVE
            </span>
          ) : (
            <span className="text-neutral-500 font-bold bg-neutral-900 px-2 py-0.5 border border-neutral-700 rounded">
              MIC IDLE
            </span>
          )}

          {lastLatencyMs !== null && (
            <span className="text-neutral-400">Latency: {lastLatencyMs}ms</span>
          )}

          {/* Active Engine & Quota Status */}
          <div className="flex items-center gap-1.5">
            <span
              className={`px-2 py-0.5 border rounded text-[11px] font-medium tracking-wide ${
                activeEngine.startsWith('gemini')
                  ? 'bg-blue-950/80 border-blue-600/70 text-blue-300'
                  : 'bg-emerald-950/80 border-emerald-600/70 text-emerald-300'
              }`}
            >
              {activeEngine.startsWith('gemini') ? 'ENGINE: GEMINI 3.8 FLASH' : 'ENGINE: LOCAL HIGH-SPEED RADAR'}
            </span>
            {isQuotaLimited && (
              <span
                className="px-1.5 py-0.5 border border-amber-600/70 bg-amber-950/70 text-amber-300 rounded text-[10px]"
                title="Free tier key quota reached; serving suggestions via instant deterministic domain engine"
              >
                QUOTA SHIELD ACTIVE
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main 3 Columns */}
      <main className="flex-1 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-neutral-800 overflow-hidden min-h-0">
        {/* ========================================================= */}
        {/* COLUMN 1: LEFT - STRATEGIC COORDINATES + MODULATORS + CONTENT BOX + LIVE NOTES */}
        {/* ========================================================= */}
        <section className="flex flex-col h-full p-2.5 overflow-hidden bg-neutral-950 gap-2">
          {/* 1. STRATEGIC COORDINATES (Persistent Open Fields: Who/They/Scope/Target) */}
          <div className="bg-neutral-900/90 border border-neutral-800 rounded p-2 shrink-0 space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px] text-neutral-300">
                <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                <span>STRATEGIC COORDINATES:</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleMergeToNotes}
                  title="Merge coordinates into top of notes box"
                  className="text-[10px] px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 border border-neutral-700 rounded cursor-pointer"
                >
                  Merge to Notes ⤓
                </button>
                <button
                  type="button"
                  onClick={() => setIsCoordinatesOpen((prev) => !prev)}
                  className="text-[10px] px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 rounded cursor-pointer font-bold"
                >
                  {isCoordinatesOpen ? '▲ Collapse' : '▼ Expand'}
                </button>
              </div>
            </div>

            {/* Collapsed summary row */}
            {!isCoordinatesOpen && (
              <div className="flex items-center justify-between text-[10px] text-neutral-400 truncate">
                <div className="truncate mr-2">
                  <span className="text-neutral-500">Me:</span> {discussionPreset.whoWeAre || 'Me'} ⇄{' '}
                  <span className="text-neutral-500">Them:</span> {discussionPreset.whoTheyAre || 'Them'}
                </div>
                <div className="text-neutral-500 shrink-0 font-mono">
                  Target: <span className="text-indigo-300 truncate">{(discussionPreset.targetGain || 'Active').slice(0, 36)}...</span>
                </div>
              </div>
            )}

            {/* Expanded 4-field inputs */}
            {isCoordinatesOpen && (
              <div className="space-y-1.5 pt-1 border-t border-neutral-800/80">
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  <div>
                    <label className="block text-[10px] text-neutral-400 font-semibold mb-0.5">
                      WHO WE ARE (ME)
                    </label>
                    <input
                      type="text"
                      value={discussionPreset.whoWeAre}
                      onChange={(e) =>
                        setDiscussionPreset((prev) => ({ ...prev, whoWeAre: e.target.value }))
                      }
                      placeholder="e.g. VP Finance / Lead Consultant / Partner"
                      className="w-full bg-neutral-950 border border-neutral-800 focus:border-indigo-500 text-neutral-200 px-2 py-1 rounded outline-none text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-neutral-400 font-semibold mb-0.5">
                      COUNTERPART (THEM)
                    </label>
                    <input
                      type="text"
                      value={discussionPreset.whoTheyAre}
                      onChange={(e) =>
                        setDiscussionPreset((prev) => ({ ...prev, whoTheyAre: e.target.value }))
                      }
                      placeholder="e.g. Operating Leaders / Clinical Chairs / Client VP"
                      className="w-full bg-neutral-950 border border-neutral-800 focus:border-indigo-500 text-neutral-200 px-2 py-1 rounded outline-none text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  <div>
                    <label className="block text-[10px] text-neutral-400 font-semibold mb-0.5">
                      DISCUSSION SCOPE
                    </label>
                    <input
                      type="text"
                      value={discussionPreset.discussionScope}
                      onChange={(e) =>
                        setDiscussionPreset((prev) => ({ ...prev, discussionScope: e.target.value }))
                      }
                      placeholder="e.g. CHIA compliance, hospital loss integration, scope bounds"
                      className="w-full bg-neutral-950 border border-neutral-800 focus:border-indigo-500 text-neutral-200 px-2 py-1 rounded outline-none text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-neutral-400 font-semibold mb-0.5">
                      TARGET GAIN
                    </label>
                    <input
                      type="text"
                      value={discussionPreset.targetGain}
                      onChange={(e) =>
                        setDiscussionPreset((prev) => ({ ...prev, targetGain: e.target.value }))
                      }
                      placeholder="e.g. Lock standardized packs with pre-support numbers"
                      className="w-full bg-neutral-950 border border-neutral-800 focus:border-indigo-500 text-neutral-200 px-2 py-1 rounded outline-none text-xs"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 2. MODULATORS GAUGE (Temperature & Option B Search Mode) */}
          <div className="bg-neutral-900/60 border border-neutral-800 rounded p-1.5 shrink-0 flex items-center justify-between text-[10px] gap-2">
            <div className="flex items-center gap-2 flex-1">
              <span className="text-neutral-400 font-semibold shrink-0">TEMP GAUGE:</span>
              <input
                type="range"
                min="0.1"
                max="0.9"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-24 accent-indigo-500 cursor-pointer h-1.5"
                title={`Temperature: ${temperature} (Lower = Strict Grounding, Higher = Broad Search/Radar)`}
              />
              <span className="font-mono text-indigo-300 w-8">{temperature.toFixed(2)}</span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <span className="text-neutral-400 font-semibold">RADAR B:</span>
              <button
                type="button"
                onClick={() => setRadarSearchMode('domain_search')}
                className={`px-1.5 py-0.5 rounded cursor-pointer ${
                  radarSearchMode === 'domain_search'
                    ? 'bg-purple-900 text-purple-200 font-bold border border-purple-700'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
                title="Option B uses Coordinates + Generic Search & Domain Intelligence (unconstrained by notes)"
              >
                Search/Domain
              </button>
              <button
                type="button"
                onClick={() => setRadarSearchMode('blended')}
                className={`px-1.5 py-0.5 rounded cursor-pointer ${
                  radarSearchMode === 'blended'
                    ? 'bg-purple-900 text-purple-200 font-bold border border-purple-700'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
                title="Option B blends notes context with external benchmarks"
              >
                Blended
              </button>
            </div>
          </div>

          {/* 3. MAIN KNOWLEDGE BANK & CONTENT BOX (Scrollable Notes + Sample Q&A) */}
          <div className="flex-1 flex flex-col min-h-0 bg-neutral-900/70 border border-neutral-800 rounded p-2">
            <div className="flex items-center justify-between pb-1.5 shrink-0 border-b border-neutral-800 text-xs">
              <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px] text-neutral-300">
                <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                <span>CONTENT BOX (NOTES & BACKGROUND):</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-neutral-500">
                  {countWords(sessionNotes)} words
                </span>
                <button
                  type="button"
                  onClick={() => handleInsertSnippet('SAMPLE_QA:\nQ: [Expected question]\nA: [Your strong prepared answer]')}
                  className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-cyan-300 border border-cyan-900/60 rounded text-[10px] cursor-pointer"
                  title="Insert a Sample Q&A block"
                >
                  + Sample Q&A
                </button>
                <button
                  type="button"
                  onClick={() => handleInsertSnippet('KEY_FACTS:\n- [Metric or number]\n- [Deliverable boundary]')}
                  className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 rounded text-[10px] cursor-pointer"
                  title="Insert key facts"
                >
                  + Facts
                </button>
                <button
                  type="button"
                  onClick={() => setSessionNotes('')}
                  className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 border border-neutral-700 rounded text-[10px] cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>

            <textarea
              value={sessionNotes}
              onChange={(e) => setSessionNotes(e.target.value)}
              placeholder="Paste meeting background, project summaries, key numbers, talking points, and Sample Q&As (Q: ... A: ...)..."
              className="flex-1 w-full bg-transparent text-neutral-200 text-xs font-mono p-1.5 resize-none outline-none overflow-y-auto leading-relaxed border-none focus:ring-0 mt-1"
            />
          </div>

          {/* 4. LIVE NOTES (Bottom 50% split - manual on-click only to guarantee zero latency) */}
          <div className="h-40 flex flex-col shrink-0 bg-neutral-900/70 border border-neutral-800 rounded p-2">
            <div className="flex items-center justify-between pb-1 shrink-0 border-b border-neutral-800 text-xs">
              <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px] text-neutral-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span>LIVE NOTES:</span>
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={liveNotesFilter}
                  onChange={(e) => setLiveNotesFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleExtractLiveNotes();
                  }}
                  placeholder="Filter (e.g. CHIA, rate, rule)..."
                  className="w-28 bg-neutral-950 border border-neutral-800 text-neutral-300 text-[10px] px-1.5 py-0.5 rounded outline-none"
                />
                <button
                  type="button"
                  onClick={handleExtractLiveNotes}
                  disabled={isExtractingNotes}
                  className="px-2 py-0.5 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-700 rounded text-[10px] font-bold cursor-pointer disabled:opacity-50"
                  title="Runs background extractor strictly on click"
                >
                  {isExtractingNotes ? '...' : '⟳ Update'}
                </button>
              </div>
            </div>

            {/* Bullets List */}
            <div className="flex-1 overflow-y-auto py-1 space-y-1 text-xs">
              {liveNotesList.length === 0 ? (
                <div className="text-[11px] text-neutral-500 italic p-1">
                  No notes extracted yet. Click "⟳ Update" or add bullet below.
                </div>
              ) : (
                liveNotesList.map((note, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-1 text-[11px] bg-neutral-950/70 p-1 rounded border border-neutral-800/80 group"
                  >
                    <span className="text-neutral-300 leading-snug">
                      • {note}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteNote(idx)}
                      className="text-neutral-600 hover:text-red-400 px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Manual Bullet Bar */}
            <form onSubmit={handleAddManualNote} className="flex gap-1 pt-1 border-t border-neutral-800 shrink-0">
              <input
                type="text"
                value={manualNoteInput}
                onChange={(e) => setManualNoteInput(e.target.value)}
                placeholder="Type manual note / fact heard on call..."
                className="flex-1 bg-neutral-950 border border-neutral-800 text-neutral-200 text-[10px] px-1.5 py-0.5 rounded outline-none"
              />
              <button
                type="submit"
                className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-[10px] cursor-pointer"
              >
                Add
              </button>
            </form>
          </div>
        </section>

        {/* ========================================================= */}
        {/* COLUMN 2: CENTER - DUAL SUGGESTION COCKPIT (CLICK TO REFRESH) */}
        {/* ========================================================= */}
        <section className="flex flex-col h-full p-2.5 overflow-hidden bg-neutral-950 gap-2">
          <div className="flex items-center justify-between pb-1 shrink-0 border-b border-neutral-800 text-xs">
            <span className="font-bold uppercase tracking-wider text-neutral-300">
              SUGGESTION BOX (CLICK CARD TO REFRESH)
            </span>
            <span className="text-[10px] text-neutral-500">
              Source: {lastTriggerSource}
            </span>
          </div>

          {/* DUAL HIGH-CONTRAST SUGGESTION CARDS */}
          <div className="flex-1 flex flex-col gap-2 min-h-0 overflow-y-auto">
            {/* OPTION A: SPOKEN ANCHOR (CONTENT-GROUNDED) */}
            <div
              onClick={() =>
                requestSuggestion({
                  which: 'a',
                  triggerLabel: 'Card A Click',
                })
              }
              className={`flex-1 flex flex-col p-3 rounded-lg border-2 transition-all cursor-pointer relative ${
                isLoadingA
                  ? 'bg-neutral-900 border-emerald-500/50 animate-pulse'
                  : 'bg-neutral-900/90 hover:bg-neutral-900 border-emerald-500/80 hover:border-emerald-400 shadow-lg shadow-emerald-950/20'
              }`}
            >
              <div className="flex items-center justify-between pb-1.5 border-b border-neutral-800 shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 bg-emerald-950 text-emerald-300 text-[10px] font-bold rounded border border-emerald-700">
                    SAY THIS (A: SPOKEN ANCHOR)
                  </span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[9px] font-bold border uppercase ${getModeBadgeClass(
                      optA.mode
                    )}`}
                  >
                    {optA.mode}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-neutral-400 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800">
                    {optA.wordCount} words
                  </span>
                  <button
                    type="button"
                    onClick={(e) => handleCopy('a', optA.sayThis, e)}
                    className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 rounded text-[10px] cursor-pointer"
                  >
                    {copiedId === 'a' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Formatted Spoken Sentence */}
              <div className="flex-1 flex items-center justify-center p-2 text-center">
                <p className="text-base font-semibold leading-relaxed text-neutral-100 max-w-xl">
                  "{renderFormattedSentence(optA.sayThis, 'text-emerald-300')}"
                </p>
              </div>

              <div className="text-[10px] text-neutral-500 text-right shrink-0">
                [Grounded in Content Box & Stance • Click to regenerate]
              </div>
            </div>

            {/* OPTION B: RECALL RADAR (DOMAIN INTELLIGENCE & SEARCH RADAR) */}
            <div
              onClick={() =>
                requestSuggestion({
                  which: 'b',
                  triggerLabel: 'Card B Click',
                })
              }
              className={`flex-1 flex flex-col p-3 rounded-lg border-2 transition-all cursor-pointer relative ${
                isLoadingB
                  ? 'bg-neutral-900 border-purple-500/50 animate-pulse'
                  : 'bg-neutral-900/90 hover:bg-neutral-900 border-purple-500/80 hover:border-purple-400 shadow-lg shadow-purple-950/20'
              }`}
            >
              <div className="flex items-center justify-between pb-1.5 border-b border-neutral-800 shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 bg-purple-950 text-purple-300 text-[10px] font-bold rounded border border-purple-700">
                    SAY THIS (B: RECALL RADAR)
                  </span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[9px] font-bold border uppercase ${getModeBadgeClass(
                      optB.mode
                    )}`}
                  >
                    {optB.mode}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-neutral-400 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800">
                    {optB.wordCount} words
                  </span>
                  <button
                    type="button"
                    onClick={(e) => handleCopy('b', optB.sayThis, e)}
                    className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 rounded text-[10px] cursor-pointer"
                  >
                    {copiedId === 'b' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Formatted Spoken Sentence */}
              <div className="flex-1 flex items-center justify-center p-2 text-center">
                <p className="text-base font-semibold leading-relaxed text-neutral-100 max-w-xl">
                  "{renderFormattedSentence(optB.sayThis, 'text-purple-300')}"
                </p>
              </div>

              <div className="text-[10px] text-neutral-500 text-right shrink-0">
                [Grounded in Coordinates + Domain/Search • Click to regenerate]
              </div>
            </div>
          </div>

          {/* Strategic Context Metadata Badges */}
          <div className="bg-neutral-900 border border-neutral-800 rounded p-2 text-[11px] space-y-1 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-neutral-500 font-bold shrink-0">RECALL HOOK:</span>
              <span className="text-amber-300/90 truncate font-mono">
                {recallHook}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-neutral-500 font-bold shrink-0">TARGET OUTCOME:</span>
              <span className="text-indigo-300/90 truncate font-mono">
                {objectiveStatus}
              </span>
            </div>
          </div>

          {/* Bottom Dual Action Buttons */}
          <div className="grid grid-cols-2 gap-2 pt-1 shrink-0">
            <button
              type="button"
              onClick={() =>
                requestSuggestion({
                  isAlternate: false,
                  triggerLabel: 'Help Now Button',
                  which: 'both',
                })
              }
              className="py-2 px-3 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 hover:border-neutral-500 text-neutral-100 font-bold rounded cursor-pointer transition-colors text-xs flex items-center justify-center gap-1.5 shadow"
            >
              <span>⚡</span> HELP NOW (REFRESH BOTH)
            </button>
            <button
              type="button"
              onClick={() =>
                requestSuggestion({
                  isAlternate: true,
                  triggerLabel: 'Alternate Pivot Button',
                  which: 'both',
                })
              }
              className="py-2 px-3 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 hover:border-neutral-500 text-neutral-100 font-bold rounded cursor-pointer transition-colors text-xs flex items-center justify-center gap-1.5 shadow"
            >
              <span>↻</span> ALTERNATE (SWAP & PIVOT)
            </button>
          </div>
        </section>

        {/* ========================================================= */}
        {/* COLUMN 3: RIGHT - LIVE TRANSCRIPT & SPEECH PAUSE ENGINE */}
        {/* ========================================================= */}
        <section className="flex flex-col h-full p-2.5 overflow-hidden bg-neutral-950 gap-2">
          {/* Header Controls: Mic Button & Speaker Attribution Selector */}
          <div className="flex items-center justify-between pb-1.5 shrink-0 border-b border-neutral-800 text-xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleListening}
                disabled={!speechSupported}
                className={`px-3 py-1 rounded font-bold cursor-pointer transition-colors border text-xs flex items-center gap-1.5 ${
                  isListening
                    ? 'bg-rose-950 text-rose-300 border-rose-600 hover:bg-rose-900'
                    : 'bg-emerald-950 text-emerald-300 border-emerald-600 hover:bg-emerald-900'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {isListening ? '■ STOP MIC' : '▶ START CONTINUOUS MIC'}
              </button>

              {/* Attribution Mode Pill */}
              <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setSpeakerMode('AUTO')}
                  className={`px-1.5 py-0.5 rounded cursor-pointer ${
                    speakerMode === 'AUTO'
                      ? 'bg-indigo-900 text-indigo-200 font-bold'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  Auto
                </button>
                <button
                  type="button"
                  onClick={() => setSpeakerMode('THEM')}
                  className={`px-1.5 py-0.5 rounded cursor-pointer ${
                    speakerMode === 'THEM'
                      ? 'bg-amber-900 text-amber-200 font-bold'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  Them
                </button>
                <button
                  type="button"
                  onClick={() => setSpeakerMode('YOU')}
                  className={`px-1.5 py-0.5 rounded cursor-pointer ${
                    speakerMode === 'YOU'
                      ? 'bg-emerald-900 text-emerald-200 font-bold'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  You
                </button>
              </div>
            </div>

            {/* 1.0s Pause Countdown Badge */}
            {pauseCountdown !== null && (
              <div className="flex items-center gap-1 bg-amber-950/80 border border-amber-600 px-2 py-0.5 rounded text-[10px] text-amber-300 font-bold animate-pulse">
                <span>⏱</span>
                <span>Pause: {pauseCountdown}s</span>
              </div>
            )}
          </div>

          {/* Transcript Scroll Area with Speaker Attribution and Toggle */}
          <div
            ref={transcriptContainerRef}
            className="flex-1 overflow-y-auto space-y-2 p-1 font-mono text-xs"
          >
            {transcriptHistory.map((item) => (
              <div
                key={item.id}
                className={`p-2 rounded border flex flex-col gap-1 transition-colors ${
                  item.speaker === 'THEM'
                    ? 'bg-neutral-900/90 border-amber-900/60 text-amber-100'
                    : 'bg-neutral-900/90 border-emerald-900/60 text-emerald-100'
                }`}
              >
                <div className="flex items-center justify-between text-[10px]">
                  {/* Speaker Label with 1-Click Interactive Toggle */}
                  <button
                    type="button"
                    onClick={() => handleToggleSpeaker(item.id)}
                    title="Click to flip speaker attribution"
                    className={`font-bold px-1.5 py-0.2 rounded border cursor-pointer flex items-center gap-1 ${
                      item.speaker === 'THEM'
                        ? 'bg-amber-950 text-amber-300 border-amber-700 hover:bg-amber-900'
                        : 'bg-emerald-950 text-emerald-300 border-emerald-700 hover:bg-emerald-900'
                    }`}
                  >
                    <span>
                      {item.speaker === 'THEM' ? '[COUNTERPART]' : '[YOU / ME]'}
                    </span>
                    <span className="text-neutral-400 hover:text-white">⇄</span>
                  </button>

                  <span className="text-neutral-500 font-mono">
                    {item.timestamp} {item.isSimulated && '(test)'}
                  </span>
                </div>
                <div className="text-neutral-200 text-xs leading-relaxed pl-1">
                  {item.text}
                </div>
              </div>
            ))}

            {/* Live Interim Speech Bubble */}
            {interimTranscript && (
              <div className="p-2 rounded border border-emerald-500 bg-neutral-900/90 text-emerald-300 animate-pulse text-xs">
                <div className="text-[10px] text-emerald-400 font-bold mb-0.5">
                  [LISTENING...]
                </div>
                <div className="italic">{interimTranscript}</div>
              </div>
            )}
          </div>

          {/* SIMULATED DISCUSSION TURNS */}
          <div className="border-t border-neutral-800 pt-2 shrink-0 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-neutral-400">
              <span className="font-semibold text-neutral-300">
                SIMULATE DISCUSSION TURN:
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSimulatedSpeaker('THEM')}
                  className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${
                    simulatedSpeaker === 'THEM'
                      ? 'bg-amber-900 text-amber-200 font-bold'
                      : 'bg-neutral-900 text-neutral-500'
                  }`}
                >
                  As: Counterpart
                </button>
                <button
                  type="button"
                  onClick={() => setSimulatedSpeaker('YOU')}
                  className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer ${
                    simulatedSpeaker === 'YOU'
                      ? 'bg-emerald-900 text-emerald-200 font-bold'
                      : 'bg-neutral-900 text-neutral-500'
                  }`}
                >
                  As: You
                </button>
              </div>
            </div>

            {/* Open Input Box */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!simulatedInput.trim()) return;
                handleSpokenTurnCompleted(simulatedInput, true, simulatedSpeaker);
                setSimulatedInput('');
              }}
              className="flex gap-1"
            >
              <input
                type="text"
                value={simulatedInput}
                onChange={(e) => setSimulatedInput(e.target.value)}
                placeholder="Type any question or comment (e.g. why did stewart not file CHIA reports)..."
                className="flex-1 bg-neutral-950 border border-neutral-800 text-neutral-200 text-xs px-2 py-1 rounded outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                className="px-2.5 py-1 bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-700 rounded text-xs font-bold cursor-pointer"
              >
                Send
              </button>
            </form>

            {/* Quick Test Turn Prompts */}
            <div className="flex flex-wrap gap-1 text-[10px]">
              <button
                type="button"
                onClick={() =>
                  handleSpokenTurnCompleted('why did stewart not file CHIA reports', true, 'THEM')
                }
                className="px-1.5 py-0.5 bg-neutral-900 hover:bg-neutral-800 text-cyan-300 border border-cyan-900/60 rounded cursor-pointer font-bold"
              >
                "Stewart CHIA reports?" [THEM]
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSpokenTurnCompleted('What specific CMS changes are going to impact us in 2027?', true, 'THEM')
                }
                className="px-1.5 py-0.5 bg-neutral-900 hover:bg-neutral-800 text-cyan-300 border border-cyan-900/60 rounded cursor-pointer"
              >
                "CMS 2027 changes?" [THEM]
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSpokenTurnCompleted('What is the team bundled payment model?', true, 'THEM')
                }
                className="px-1.5 py-0.5 bg-neutral-900 hover:bg-neutral-800 text-cyan-300 border border-cyan-900/60 rounded cursor-pointer"
              >
                "TEAM model?" [THEM]
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSpokenTurnCompleted('How do you approach clinical predictive models and AI governance?', true, 'THEM')
                }
                className="px-1.5 py-0.5 bg-neutral-900 hover:bg-neutral-800 text-purple-300 border border-purple-900/60 rounded cursor-pointer"
              >
                "AI governance?" [THEM]
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
