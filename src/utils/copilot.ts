export type SourceMode = 'PREPARED' | 'YOUR_PROJECT' | 'DOMAIN' | 'STRATEGIC' | 'LIFELINE';

export interface SuggestionItem {
  id: string;
  label: string;
  mode: SourceMode;
  sayThis: string;
  wordCount: number;
}

export interface CopilotOutput {
  mode: SourceMode;
  sayThis: string;
  wordCount: number;
  suggestions: SuggestionItem[];
  recallHook: string;
  newFactsLearned: string[];
  objectiveStatus: string;
  speakerAttribution?: 'THEM' | 'YOU';
  rawText: string;
}

export function countWords(text: string): number {
  if (!text) return 0;
  // Strip markdown formatting symbols like **, *, _, # before tokenizing words
  const clean = text.replace(/[*_#`~[\]]/g, ' ').trim();
  const words = clean.match(/[^\s]+/g);
  return words ? words.length : 0;
}

export function detectSpeaker(
  text: string,
  mode: 'THEM' | 'YOU' | 'AUTO' = 'AUTO'
): 'THEM' | 'YOU' {
  if (mode === 'THEM' || mode === 'YOU') {
    return mode;
  }
  const clean = text.trim();
  if (!clean) return 'THEM';

  const questionStarters = /^(tell me|can you|could you|what|why|how|who|where|when|which|is it|are you|do you|would you|have you|walk me|describe|explain|give me)\b/i;
  if (clean.endsWith('?') || questionStarters.test(clean)) {
    return 'THEM';
  }

  const firstPersonIndicators = /\b(i led|i built|i designed|i managed|i worked|in my experience|our team|we built|we scaled|my focus|i usually|in my last role|in my previous company|i implemented)\b/i;
  if (firstPersonIndicators.test(clean)) {
    return 'YOU';
  }

  if (/^(tell me about yourself|walk us through|describe a scenario|let's discuss|can we touch on)\b/i.test(clean)) {
    return 'THEM';
  }

  return 'THEM';
}

export function detectTone(notes: string): 'EXECUTIVE' | 'CONSUMER' | 'TECHNICAL' | 'COLLABORATIVE' {
  const lower = (notes || '').toLowerCase();
  if (
    lower.includes('insurance') ||
    lower.includes('claim') ||
    lower.includes('denial') ||
    lower.includes('landlord') ||
    lower.includes('lease') ||
    lower.includes('personal') ||
    lower.includes('tenant')
  ) {
    return 'CONSUMER';
  }
  if (
    lower.includes('kafka') ||
    lower.includes('latency') ||
    lower.includes('microservice') ||
    lower.includes('kubernetes') ||
    lower.includes('postgres') ||
    lower.includes('database') ||
    lower.includes('architecture') ||
    lower.includes('api') ||
    lower.includes('endpoint')
  ) {
    return 'TECHNICAL';
  }
  if (
    lower.includes('client') ||
    lower.includes('partner') ||
    lower.includes('vendor') ||
    lower.includes('contract') ||
    lower.includes('negotiation')
  ) {
    return 'COLLABORATIVE';
  }
  return 'EXECUTIVE';
}

export function cleanSpokenText(text: string): string {
  return text.trim().replace(/^["“]|["”]$/g, '').trim().replace(/\s+/g, ' ');
}

export function parseCopilotResponse(rawText: string): CopilotOutput {
  const result: CopilotOutput = {
    mode: 'DOMAIN',
    sayThis: '',
    wordCount: 0,
    suggestions: [],
    recallHook: 'NONE',
    newFactsLearned: [],
    objectiveStatus: 'NONE',
    rawText: rawText || '',
  };

  if (!rawText || typeof rawText !== 'string') {
    const fallbackText = 'Let us anchor on our **primary shared objective** and evaluate the **tradeoffs directly**.';
    result.sayThis = fallbackText;
    result.wordCount = countWords(fallbackText);
    result.suggestions = [
      {
        id: 'sug-1',
        label: 'Option A: Spoken Anchor (Content)',
        mode: 'DOMAIN',
        sayThis: fallbackText,
        wordCount: result.wordCount,
      },
    ];
    return result;
  }

  const primaryModeMatch = rawText.match(/PRIMARY_MODE:\s*\[?(PREPARED|YOUR_PROJECT|DOMAIN|STRATEGIC|LIFELINE)\]?/i);
  const primarySayMatch = rawText.match(/PRIMARY_SAY_THIS:\s*(?:"|“)?([^"\n\r“]+(?:[^\n\r"]+)?)(?:"|”)?(?:\r?\n|$)/i);

  const secondaryModeMatch = rawText.match(/SECONDARY_MODE:\s*\[?(PREPARED|YOUR_PROJECT|DOMAIN|STRATEGIC|LIFELINE)\]?/i);
  const secondarySayMatch = rawText.match(/SECONDARY_SAY_THIS:\s*(?:"|“)?([^"\n\r“]+(?:[^\n\r"]+)?)(?:"|”)?(?:\r?\n|$)/i);

  let primaryText = '';
  let primaryMode: SourceMode = 'PREPARED';
  let secondaryText = '';
  let secondaryMode: SourceMode = 'DOMAIN';

  if (primarySayMatch && primarySayMatch[1]) {
    primaryText = cleanSpokenText(primarySayMatch[1]);
    if (primaryModeMatch && primaryModeMatch[1]) {
      primaryMode = primaryModeMatch[1].toUpperCase() as SourceMode;
    }
  }

  if (secondarySayMatch && secondarySayMatch[1]) {
    secondaryText = cleanSpokenText(secondarySayMatch[1]);
    if (secondaryModeMatch && secondaryModeMatch[1]) {
      secondaryMode = secondaryModeMatch[1].toUpperCase() as SourceMode;
    }
  }

  if (!primaryText) {
    const singleModeMatch = rawText.match(/MODE:\s*\[?(PREPARED|YOUR_PROJECT|DOMAIN|STRATEGIC|LIFELINE)\]?/i);
    if (singleModeMatch && singleModeMatch[1]) {
      primaryMode = singleModeMatch[1].toUpperCase() as SourceMode;
    }

    const singleSayMatch = rawText.match(/SAY THIS:\s*(?:"|“)?([^"\n\r“]+(?:[^\n\r"]+)?)(?:"|”)?(?:\r?\n|$)/i);
    if (singleSayMatch && singleSayMatch[1]) {
      primaryText = cleanSpokenText(singleSayMatch[1]);
    }
  }

  if (!primaryText) {
    primaryText = 'Our priority is advancing our **core strategic objective** while maintaining clear **mutual accountability** across deliverables.';
  }

  if (!secondaryText) {
    secondaryText = 'Looking at broader **industry benchmarks**, we should evaluate the **underlying dependencies** before finalizing contractual commitments.';
  }

  result.mode = primaryMode;
  result.sayThis = primaryText;
  result.wordCount = countWords(primaryText);

  result.suggestions = [
    {
      id: 'sug-1',
      label: 'Option A: Spoken Anchor (Content)',
      mode: primaryMode,
      sayThis: primaryText,
      wordCount: countWords(primaryText),
    },
    {
      id: 'sug-2',
      label: 'Option B: Recall Radar (Domain & Search)',
      mode: secondaryMode,
      sayThis: secondaryText,
      wordCount: countWords(secondaryText),
    },
  ];

  const recallMatch = rawText.match(/RECALL HOOK:\s*([^\r\n]+)/i);
  if (recallMatch && recallMatch[1]) {
    const hook = recallMatch[1].trim();
    result.recallHook = hook.toUpperCase() === 'NONE' ? 'NONE' : hook;
  }

  const factsMatch = rawText.match(/NEW FACTS LEARNED:\s*([^\r\n]+)/i);
  if (factsMatch && factsMatch[1]) {
    const factsStr = factsMatch[1].trim();
    if (factsStr.toUpperCase() !== 'NONE' && factsStr.length > 0) {
      const items = factsStr
        .split(/;|\n|(?<!\d),(?!\d)/)
        .map((f) => f.trim().replace(/^[-*•]\s*/, ''))
        .filter((f) => f.length > 0 && f.toUpperCase() !== 'NONE');
      result.newFactsLearned = items;
    }
  }

  const objectiveMatch = rawText.match(/OBJECTIVE STATUS:\s*([^\r\n]+)/i);
  if (objectiveMatch && objectiveMatch[1]) {
    const objStr = objectiveMatch[1].trim();
    result.objectiveStatus = objStr.toUpperCase() === 'NONE' ? 'NONE' : objStr;
  }

  return result;
}

export interface DiscussionPreset {
  whoWeAre: string;
  whoTheyAre: string;
  discussionScope?: string;
  targetGain?: string;
  purpose?: string;
  desiredOutcome?: string;
}

export function buildSystemPrompt(preset?: DiscussionPreset, temperature = 0.4): string {
  const whoWeAre = preset?.whoWeAre || 'Strategic Leader / Advisor';
  const whoTheyAre = preset?.whoTheyAre || 'Executive Counterpart / Stakeholder';
  const scope = preset?.discussionScope || preset?.purpose || 'Advance shared priorities and evaluate operational commitments';
  const targetGain = preset?.targetGain || preset?.desiredOutcome || 'Secure agreement advancing core objectives with mutual accountability';

  return `ROLE & STRATEGIC MISSION
You are a real-time live DISCUSSION COPILOT operating privately for the user during a high-stakes discussion.
This can be a client advisory meeting, vendor/commercial negotiation, regulatory review, executive board briefing, or personal/difficult conversation.
This is NOT an interview or quiz. It is a live, peer-level strategic conversation.

ALIGNMENT CONTEXT:
- WHO WE ARE (USER'S ROLE & STANCE): ${whoWeAre}
- COUNTERPART (THEIR ROLE & STANCE): ${whoTheyAre}
- DISCUSSION SCOPE: ${scope}
- TARGET GAIN / OUTCOME: ${targetGain}

YOUR DUAL-TRACK DELIVERABLES (SAY THIS):
- OPTION A (SPOKEN ANCHOR): Direct, articulate sentence closely knitted to the user's Content Box notes, written to be said aloud verbatim right now.
  * IF THE NOTES CONTAIN SAMPLE Q&A: Treat them as high-value source material to dynamically adapt to the actual question and moment—NOT as rigid scripts. Adapt the prepared answer to fit the nuance of what was just said.
  * IF NOTES CONTAIN PROJECTS/FACTS: Weave the user's actual proof points, numbers, and boundaries into the response.
  * MUST be strictly 15 to 35 words. Bold 2 to 4 key anchor words (e.g. **scope boundary**, **delivery SLA**).

- OPTION B (RECALL RADAR & DOMAIN SEARCH): Looks at WHO WE ARE, COUNTERPART, DISCUSSION SCOPE, and TARGET GAIN, combined with GENERIC LLM SEARCH and DOMAIN BENCHMARKS.
  * It acts as an external search radar covering public facts, regulatory filings (e.g. state agency reports, legal disputes, statutory deadlines), industry benchmarks, and counterpart motives.
  * Stimulate the user's recall and cover blindspots WITHOUT sounding like an abstract textbook definition.
  * MUST also be strictly 15 to 35 words with key nouns bolded (e.g. **statutory CHIA reporting subpoena**, **unplanned change order premium**).

COMMANDER DIRECTIVE & OPERATING PRINCIPLES:
1. STRICT BREVITY: Every SAY_THIS must be strictly 15 to 35 words (count verified without markdown symbols).
2. KEYWORD BOLDING: Bold the 2 to 4 highest-leverage keywords in both options using markdown **keyword**.
3. NOT ABSTRACT DEFINITIONS: Ground all suggestions into the discussion reality and advance the TARGET GAIN.
4. TONE ADAPTATION: Match the tone of the meeting (executive polish, collaborative client advisory, rigorous engineering, or firm personal boundaries).

OUTPUT FORMAT:
PRIMARY_MODE: [PREPARED | YOUR_PROJECT | DOMAIN | STRATEGIC | LIFELINE]
PRIMARY_SAY_THIS: "[15-35 words of exact spoken phrasing with **key terms** bolded]"

SECONDARY_MODE: [PREPARED | YOUR_PROJECT | DOMAIN | STRATEGIC | LIFELINE]
SECONDARY_SAY_THIS: "[15-35 words of domain search & recall radar with **key terms** bolded]"

RECALL HOOK: [If useful to jog memory: "unsupported: [plausible fact/metric/risk]" + how to use it, else NONE]
NEW FACTS LEARNED: [Any new detail, number, or constraint stated by counterpart in the latest turn, else NONE]
OBJECTIVE STATUS: [Note how this turn advances or protects the TARGET GAIN, else NONE]

HARD CONSTRAINTS:
- STRICTLY 15 TO 35 WORDS FOR EACH SAY THIS.
- Bold the critical keywords in both sentences.
- Never give rigid canned text; adapt dynamically to the live dialogue.`;
}

