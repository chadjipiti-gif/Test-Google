import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { buildSystemPrompt, parseCopilotResponse, countWords, SourceMode } from './src/utils/copilot.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Initialize GoogleGenAI SDK
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}
import { matchContextNotes, extractLiveNotes } from './src/utils/contextMatcher.ts';


// Extract minimalist Live Notes (only called on explicit user click)
app.post('/api/copilot/extract-notes', (req, res) => {
  const { sessionNotes, transcriptHistory, filter } = req.body;
  const bullets = extractLiveNotes({
    sessionNotes: sessionNotes || '',
    transcriptHistory: Array.isArray(transcriptHistory) ? transcriptHistory : [],
    filter: filter || '',
  });
  return res.json({ success: true, bullets });
});

// Quota exhaustion cooldown tracking (avoids hammering the API when free-tier quota is reached)
let quotaCooldownUntil = 0;

// API endpoint for instant meeting copilot guidance
app.post('/api/copilot/suggest', async (req, res) => {
  const {
    sessionNotes,
    liveFacts,
    recentTranscript,
    latestTurn,
    isAlternate,
    which = 'both',
    discussionPreset,
    temperature = 0.35,
    radarSearchMode = 'domain_search',
  } = req.body;

  // Compute context-matched result from Session Notes & Coordinates
  const contextResult = matchContextNotes({
    sessionNotes: sessionNotes || '',
    latestTurn: latestTurn || '',
    isAlternate: Boolean(isAlternate),
    discussionPreset,
  });

  // Option A is served instantly from the local intelligent context engine
  if (which === 'a') {
    return res.json({
      success: true,
      suggestions: [contextResult.suggestions[0], contextResult.suggestions[1]],
      recallHook: contextResult.recallHook,
      objectiveStatus: contextResult.objectiveStatus,
      sourceEngine: 'instant-context-engine',
    });
  }

  // If currently in quota cooldown, immediately return the high-speed local engine result
  if (Date.now() < quotaCooldownUntil) {
    return res.json({
      success: true,
      ...contextResult,
      sourceEngine: 'context-engine',
      quotaLimited: true,
    });
  }

  const scope = discussionPreset?.discussionScope || discussionPreset?.purpose || 'Advance shared priorities';
  const targetGain = discussionPreset?.targetGain || discussionPreset?.desiredOutcome || 'Secure agreement advancing core objectives';

  const contentPrompt = `ALIGNMENT CONTEXT:
- WHO WE ARE: ${discussionPreset?.whoWeAre || 'Strategic Leader / Advisor'}
- COUNTERPART: ${discussionPreset?.whoTheyAre || 'Executive Counterpart / Stakeholder'}
- DISCUSSION SCOPE: ${scope}
- TARGET GAIN / OUTCOME: ${targetGain}
- OPTION B MODE: ${radarSearchMode === 'domain_search' ? 'Prioritize broad external domain search, public regulatory facts, and blindspots' : 'Blended notes + external benchmarks'}

SESSION_NOTES:
${sessionNotes ? sessionNotes.trim() : 'None provided.'}

RECENT_TRANSCRIPT:
${Array.isArray(recentTranscript) && recentTranscript.length > 0 ? recentTranscript.slice(-5).join('\n') : 'Conversation underway.'}

LATEST_TURN:
${latestTurn ? latestTurn.trim() : 'The speaker paused. What should I say next?'}

${isAlternate ? 'INSTRUCTION: The user pressed ALTERNATE. Provide a completely different angle, phrasing, or strategic pivot from a different mode if possible.' : ''}`;

  try {
    if (!ai && process.env.GEMINI_API_KEY) {
      ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }

    if (!ai) {
      return res.json({ success: true, ...contextResult, sourceEngine: 'context-engine' });
    }

    // Call Gemini 3.1 Flash Lite without slow external search tools for rapid sub-second turnaround
    const geminiCall = ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: contentPrompt,
      config: {
        systemInstruction: buildSystemPrompt(discussionPreset, temperature),
        temperature: isAlternate ? Math.min(1.0, Number(temperature) + 0.3) : Number(temperature),
      },
    });

    const timeoutPromise = new Promise<'TIMEOUT'>((resolve) =>
      setTimeout(() => resolve('TIMEOUT'), 2500)
    );

    const raceResult = await Promise.race([geminiCall, timeoutPromise]);

    if (raceResult !== 'TIMEOUT') {
      const rawOutput = raceResult.text || '';
      const parsed = parseCopilotResponse(rawOutput);

      if (parsed.suggestions && parsed.suggestions.length > 0) {
        return res.json({
          success: true,
          suggestions: [
            // Option A stays tightly and accurately grounded in context
            contextResult.suggestions[0],
            // Option B uses fresh domain radar from LLM
            parsed.suggestions[1] || parsed.suggestions[0],
          ],
          recallHook: parsed.recallHook !== 'NONE' ? parsed.recallHook : contextResult.recallHook,
          objectiveStatus: parsed.objectiveStatus !== 'NONE' ? parsed.objectiveStatus : contextResult.objectiveStatus,
          sourceEngine: 'gemini-3.1-flash-lite',
        });
      }
    }

    return res.json({
      success: true,
      ...contextResult,
      sourceEngine: 'context-engine',
    });
  } catch (error: any) {
    const errMessage = error instanceof Error ? error.message : String(error || '');
    const isQuotaOrDemand =
      error?.status === 'RESOURCE_EXHAUSTED' ||
      error?.code === 429 ||
      error?.status === 'UNAVAILABLE' ||
      error?.code === 503 ||
      errMessage.includes('RESOURCE_EXHAUSTED') ||
      errMessage.includes('429') ||
      errMessage.includes('503') ||
      errMessage.includes('UNAVAILABLE') ||
      errMessage.includes('quota');

    if (isQuotaOrDemand) {
      quotaCooldownUntil = Date.now() + 15_000;
      console.log('[Copilot Engine] LLM service unavailable or quota limited; seamlessly utilizing high-speed local engine.');
      return res.json({
        success: true,
        ...contextResult,
        sourceEngine: 'context-engine',
        quotaLimited: true,
      });
    }

    console.log('[Copilot Engine] Served via instant context engine:', errMessage.slice(0, 80));
    return res.json({
      success: true,
      ...contextResult,
      sourceEngine: 'context-engine',
    });
  }
});

// Setup Vite middleware in dev or static files in production
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Real-Time Meeting Copilot running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
});
