import { countWords, SourceMode, SuggestionItem, detectTone, DiscussionPreset } from './copilot';

export interface MatchResult {
  mode: SourceMode;
  sayThis: string;
  wordCount: number;
  suggestions: SuggestionItem[];
  recallHook: string;
  newFactsLearned: string[];
  objectiveStatus: string;
}

export interface ParsedQA {
  question: string;
  answer: string;
  keywords: string[];
}

const COMMON_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'in', 'on', 'at', 'to', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'from', 'up', 'down',
  'of', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
  'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'what',
  'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'do', 'does',
  'did', 'doing', 'would', 'could', 'tell', 'me', 'us', 'you', 'your', 'we', 'our',
  'they', 'their', 'i', 'my', 'mine', 'myself', 'yourself', 'yourselves', 'not'
]);

// Generic conversational nouns that should not single-handedly trigger Q&A matches
const GENERIC_COMMON_NOUNS = new Set([
  'report', 'reports', 'reporting', 'file', 'files', 'filing', 'filings',
  'data', 'note', 'notes', 'meeting', 'call', 'time', 'issue', 'issues',
  'thing', 'things', 'work', 'works', 'working', 'team', 'teams', 'plan'
]);

/**
 * Extracts non-trivial search keywords from text.
 */
export function extractKeywords(text: string): string[] {
  if (!text) return [];
  const clean = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  return clean
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !COMMON_STOP_WORDS.has(word));
}

/**
 * Parses Sample Q&A blocks from session notes.
 */
export function parseQAPairs(sessionNotes: string): ParsedQA[] {
  const qaList: ParsedQA[] = [];
  if (!sessionNotes) return qaList;

  const regex = /(?:^|\n)\s*(?:[-*•]\s*)?(?:Q|Question)\s*[:.\-]\s*([^\n\r]+(?:\n(?!\s*(?:[-*•]\s*)?(?:A|Answer|Q|Question)\s*[:.\-])[^\n\r]+)*)\s*(?:\n\s*(?:[-*•]\s*)?(?:A|Answer)\s*[:.\-]\s*([^\n\r]+(?:\n(?!\s*(?:[-*•]\s*)?(?:Q|Question)\s*[:.\-])[^\n\r]+)*))/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(sessionNotes)) !== null) {
    const question = match[1].trim().replace(/\s+/g, ' ');
    const answer = match[2].trim().replace(/\s+/g, ' ');
    if (question.length > 3 && answer.length > 5) {
      qaList.push({
        question,
        answer,
        keywords: extractKeywords(question),
      });
    }
  }

  return qaList;
}

/**
 * Returns clean spoken text without distracting markdown asterisks.
 */
export function ensureBoldKeywords(text: string): string {
  // Strip bold markdown formatting so text is clean, readable spoken prose
  return text.replace(/\*\*/g, '').trim();
}

/**
 * Ensures natural, complete spoken sentences without arbitrary mid-sentence cut-offs.
 */
export function ensureWordBudget(
  text: string,
  minWords = 15,
  maxWords = 70,
  tone: 'EXECUTIVE' | 'CONSUMER' | 'TECHNICAL' | 'COLLABORATIVE' = 'EXECUTIVE'
): string {
  let clean = text.trim().replace(/^["“]|["”]$/g, '').replace(/\s+/g, ' ');
  // Clean off distracting bolding
  clean = clean.replace(/\*\*/g, '');
  // Clean dangling prepositions/conjunctions before period
  clean = clean.replace(/\s+(?:the|a|an|to|of|in|on|at|and|or|for|with|that)\s*\.?$/i, '.');
  if (!clean.endsWith('.') && !clean.endsWith('?') && !clean.endsWith('!')) {
    clean += '.';
  }

  const words = clean.split(' ');
  const currentCount = words.length;

  if (currentCount <= maxWords) {
    return clean;
  }

  // If over maxWords, cleanly truncate at a sentence boundary
  const sentences = clean.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length > 1) {
    let acc = '';
    for (const s of sentences) {
      const candidate = (acc + ' ' + s).trim();
      if (candidate.split(' ').length <= maxWords) {
        acc = candidate;
      } else {
        break;
      }
    }
    if (acc.length > 20) {
      return acc;
    }
  }

  // Truncate cleanly without leaving dangling words
  const truncatedWords = words.slice(0, maxWords);
  let result = truncatedWords.join(' ');
  result = result.replace(/\s+(?:the|a|an|to|of|in|on|at|and|or|for|with|that|I|we|my|our)\s*$/i, '');
  result = result.replace(/[,;:\-\s]+$/, '') + '.';
  return result;
}

/**
 * Simple word root / stem helper for matching plurals, gerunds, and suffixes
 */
function getStem(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (w.length <= 4) return w;
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ing')) return w.slice(0, -3);
  if (w.endsWith('tion')) return w.slice(0, -4);
  if (w.endsWith('ions')) return w.slice(0, -4);
  if (w.endsWith('ers') || w.endsWith('ors')) return w.slice(0, -3);
  if (w.endsWith('es') && w.length > 5) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export interface VoiceConfig {
  pronoun: 'I' | 'we';
  possessive: 'my' | 'our';
  objective: 'me' | 'us';
  rolePrefix: string;
}

export function detectVoice(whoWeAre: string): VoiceConfig {
  const lower = (whoWeAre || '').toLowerCase();
  const isPlural = /\b(we|our team|our firm|our company|us|partners|joint|co-founders|leadership team)\b/.test(lower);
  if (isPlural) {
    return {
      pronoun: 'we',
      possessive: 'our',
      objective: 'us',
      rolePrefix: whoWeAre ? `In our role as ${whoWeAre}` : 'In our role',
    };
  }
  return {
    pronoun: 'I',
    possessive: 'my',
    objective: 'me',
    rolePrefix: whoWeAre ? `In my role as ${whoWeAre}` : 'In my role',
  };
}

/**
 * Cleans extracted subjects without mid-word slicing.
 */
export function cleanExtractedSubject(phrase: string, maxLen = 45): string {
  let s = phrase.replace(/^\[(THEM|YOU)\]:\s*/i, '').trim();

  // Strip question leads and capture verbs
  s = s.replace(/^(can|could|how|what|why|where|when|which)\s+(would|could|will|do|does|did|should|can|are|is)\s+(you|we|they|one)\s*(?:\b(approach|handle|build|create|manage|deliver|address|seeing|see|think about|isolate)\b)?\s*/i, (_m, _p1, _p2, _p3, verb) => {
    if (verb) {
      const v = verb.toLowerCase();
      if (v === 'build') return 'building ';
      if (v === 'manage') return 'managing ';
      if (v === 'handle') return 'handling ';
      if (v === 'deliver') return 'delivering ';
      if (v === 'approach') return 'approaching ';
      if (v === 'create') return 'creating ';
      if (v === 'isolate') return 'isolating ';
      if (v === 'address') return 'addressing ';
    }
    return '';
  });

  s = s.replace(/^what\s+are\s+you\s+(seeing|looking\s+at)\s+(at|in)?\s*/i, '');
  s = s.replace(/^(what are you seeing at|what do you see at|what are we seeing at|what are you seeing in|what do you see in)\s*/i, '');
  s = s.replace(/^(tell me about|tell us about|walk me through|walk us through|describe|explain|let's discuss|what about)\s+(your|the|our|their|they|it)?\s*/i, '');
  s = s.replace(/^(how would you|how do you|how will you|how can you|how to|how do we|how can we|how would we)\s*/i, '');
  s = s.replace(/^(would you|do you|did you|have you|can you|could you|will you|are you)\s*/i, '');
  s = s.replace(/^(why did|why does|why do|why would)\s*/i, '');
  s = s.replace(/^(about|regarding|on|at the|in the|at|in|the|our|my)\s+/i, '');
  s = s.replace(/[?!.:;,]/g, '').trim();

  if (/^build\s+/i.test(s)) s = s.replace(/^build\s+/i, 'building ');
  if (/^create\s+/i.test(s)) s = s.replace(/^create\s+/i, 'creating ');
  if (/^isolate\s+/i.test(s)) s = s.replace(/^isolate\s+/i, 'isolating ');

  const words = s.split(/\s+/).filter(Boolean);
  return words.length <= 6 ? words.join(' ') : words.slice(0, 5).join(' ');
}

/**
 * Dynamic Universal Context Matcher:
 * - Option A: Grounded strictly in Content Box notes + Who We Are + Scope + Target Gain.
 * - Option B: Generic LLM / Domain Search Radar grounded in Who We Are + Counterpart + Scope + Target Gain.
 */
export function matchContextNotes(params: {
  sessionNotes: string;
  latestTurn: string;
  isAlternate?: boolean;
  discussionPreset?: DiscussionPreset;
}): MatchResult {
  const { sessionNotes = '', latestTurn = '', isAlternate = false, discussionPreset } = params;
  const lowerTurn = latestTurn.toLowerCase().trim();
  const tone = detectTone(sessionNotes);
  const turnKeywords = extractKeywords(latestTurn);

  const whoWeAre = discussionPreset?.whoWeAre || 'Strategic Leader / Advisor';
  const whoTheyAre = discussionPreset?.whoTheyAre || 'Counterpart';
  const scope = discussionPreset?.discussionScope || discussionPreset?.purpose || 'operational alignment';
  const targetGain = discussionPreset?.targetGain || discussionPreset?.desiredOutcome || 'our core priorities';

  const voice = detectVoice(whoWeAre);

  let optA = {
    mode: 'PREPARED' as SourceMode,
    sayThis: '',
  };
  let optB = {
    mode: 'DOMAIN' as SourceMode,
    sayThis: '',
  };
  let recallHook = 'NONE';
  let facts: string[] = [];
  let objectiveStatus = `Advancing: ${targetGain}`;

  // 1. SPECIFIC REGULATORY RECOGNITION: STEWARD HEALTH CARE / CHIA FILINGS
  if (
    (lowerTurn.includes('stewart') || lowerTurn.includes('steward')) &&
    (lowerTurn.includes('chia') || lowerTurn.includes('report') || lowerTurn.includes('filing') || lowerTurn.includes('file'))
  ) {
    // Option A: Grounded in our role & stance (BMC / hospital leadership governance)
    optA = {
      mode: 'PREPARED',
      sayThis:
        'As **governed hospital leadership**, we maintain transparent, verified compliance with **CHIA statutory filings** while isolating acquired facilities from historical reporting liabilities.',
    };
    // Option B: Generic domain search intelligence (Steward's private equity withholding and court contempt)
    optB = {
      mode: 'DOMAIN',
      sayThis:
        'Steward cited private equity ownership to withhold audited **CHIA financial statements**, triggering **state superior court contempt orders** prior to their Chapter 11 bankruptcy.',
    };
    recallHook = 'unsupported: Massachusetts AG and CHIA issued civil subpoenas and fines against Steward for unfiled audited financials';
    facts = ['Counterpart inquired about Steward Health Care CHIA reporting failures'];
    objectiveStatus = 'CHIA statutory reporting transparency and liability ring-fencing asserted';
  }

  // 1B. OTHER SPECIFIC CHIA OR MASSACHUSETTS HEALTH FILINGS
  else if (lowerTurn.includes('chia') || lowerTurn.includes('center for health information')) {
    optA = {
      mode: 'PREPARED',
      sayThis:
        'Our financial packs ensure full compliance with CHIA reporting requirements, isolating pre-support campus numbers from statutory state reconciling items.',
    };
    optB = {
      mode: 'DOMAIN',
      sayThis:
        'Massachusetts CHIA statutory benchmarks monitor health system operating margins, total medical expenses, and hospital uncompensated care shortfalls statewide.',
    };
    recallHook = 'unsupported: CHIA mandates annual audited financial filings and quarterly margin extracts';
    facts = ['Counterpart inquired about CHIA regulatory oversight'];
    objectiveStatus = 'CHIA regulatory compliance and hospital reporting verified';
  }

  // 1C. DASHBOARDS, PACKS, REPORTING ARCHITECTURE
  else if (
    lowerTurn.includes('dashboard') ||
    lowerTurn.includes('dashboards') ||
    lowerTurn.includes('reporting pack') ||
    lowerTurn.includes('variance pack') ||
    (lowerTurn.includes('build') && (lowerTurn.includes('report') || lowerTurn.includes('metric') || lowerTurn.includes('pack')))
  ) {
    optA = {
      mode: 'PREPARED',
      sayThis: `${voice.possessive === 'my' ? 'My' : 'Our'} approach to building the dashboards is delivering usable packs for campus and service-line leaders that isolate controllable labor, carry residual tags, and show pre-support operating results. ${voice.pronoun} anchor everything on a single governed dataset across the five teams so every number is defended upfront and tied to operational action.`,
    };
    optB = {
      mode: 'DOMAIN',
      sayThis: `Beyond dashboard layout, ${voice.pronoun} focus on operational actionability to ensure leaders act on variances. In broader health system integrations, locking data lineage and setting automated alerts for labor leakage is essential to prevent month-end reporting surprises.`,
    };
    recallHook = 'unsupported: Automated daily labor variance alerts drive faster corrective action than monthly board packs';
    facts = ['Counterpart inquired about dashboard architecture and executive reporting'];
    objectiveStatus = 'Dashboard structure and governed variance reporting framed';
  }

  // 2. CHECK SAMPLE Q&A PAIRS IN SESSION NOTES (STRICT MATCHING)
  // Requires at least 2 distinct specific keywords or >40% keyword overlap
  if (!optA.sayThis) {
    const qaPairs = parseQAPairs(sessionNotes);
    let bestQAMatch: ParsedQA | null = null;
    let bestQAScore = 0;

    for (const qa of qaPairs) {
      let specificMatches = 0;
      for (const kw of turnKeywords) {
        // Ignore generic common words when evaluating Q&A match
        if (GENERIC_COMMON_NOUNS.has(kw)) continue;
        if (qa.keywords.includes(kw)) {
          specificMatches += 2;
        } else if (qa.question.toLowerCase().includes(kw)) {
          specificMatches += 1;
        }
      }

      // Compute ratio against question keywords
      const qaNonGeneric = qa.keywords.filter((k) => !GENERIC_COMMON_NOUNS.has(k));
      const overlapRatio = qaNonGeneric.length > 0 ? specificMatches / (qaNonGeneric.length * 2) : 0;

      // Only accept match if there are at least 2 specific keyword hits OR high overlap ratio
      if ((specificMatches >= 3 || (specificMatches >= 2 && overlapRatio >= 0.35)) && specificMatches > bestQAScore) {
        bestQAScore = specificMatches;
        bestQAMatch = qa;
      }
    }

    if (bestQAMatch) {
      const rawAnswer = bestQAMatch.answer;
      optA = {
        mode: 'PREPARED',
        sayThis: ensureBoldKeywords(rawAnswer),
      };

      const cleanTopic = cleanExtractedSubject(bestQAMatch.question);
      optB = {
        mode: 'DOMAIN',
        sayThis: `Beyond immediate **${cleanTopic}**, we should confirm our **underlying baseline dependencies** and establish clear **mutual accountability criteria**.`,
      };

      recallHook = `adapted: Sample Q&A on "${cleanTopic}"`;
      facts = [`Discussion addressed prepared Q&A topic: ${cleanTopic}`];
      objectiveStatus = `Prepared point on ${cleanTopic} applied`;
    }
  }

  // 3. REGULATORY AND VALUE-BASED CARE INQUIRIES (TEAM, V28, DSH, CMS 2027)
  if (!optA.sayThis) {
    if (
      lowerTurn.includes('team bundled') ||
      lowerTurn.includes('team model') ||
      lowerTurn.includes('what is the team') ||
      lowerTurn.includes('what is team') ||
      lowerTurn.includes('bundled payment model') ||
      lowerTurn.includes('team bundle') ||
      (lowerTurn.includes('team') && lowerTurn.includes('bundled')) ||
      (lowerTurn.includes('team') && lowerTurn.includes('payment model'))
    ) {
      optA = {
        mode: 'PREPARED',
        sayThis:
          'The **TEAM model** holds hospitals accountable for **episode spending and quality** across a **30-day post-discharge window** for five specific inpatient surgical categories.',
      };
      optB = {
        mode: 'DOMAIN',
        sayThis:
          'CMS mandated **Transforming Episode Accountability Model** evaluates **target prices vs actuals** on joint replacements, CABG, and spinal fusions, penalizing excess readmissions or post-acute leakage.',
      };
      recallHook = 'unsupported: Mandatory CMS TEAM starts 2026/2027 for selected MSAs; includes CABG, LEJR, femur, spinal, bowel';
      facts = ['Counterpart inquired about CMS TEAM bundled payment model mechanics'];
      objectiveStatus = 'TEAM bundled payment mechanics and episode accountability defined';
    } else if (
      lowerTurn.includes('v28') ||
      lowerTurn.includes('v-28') ||
      (lowerTurn.includes('medicare advantage') && (lowerTurn.includes('risk') || lowerTurn.includes('coding') || lowerTurn.includes('hcc')))
    ) {
      optA = {
        mode: 'PREPARED',
        sayThis:
          '**CMS V28** restructures risk adjustment by removing thousands of non-predictive diagnostic codes, reducing **inpatient risk scores** and lowering net Medicare Advantage yield.',
      };
      optB = {
        mode: 'DOMAIN',
        sayThis:
          'We counter the **V28 diagnostic coding gap** by establishing **reconciled documentation audits** across high-volume surgical service lines before final rate calculations are booked.',
      };
      recallHook = 'unsupported: CMS V28 removes ~2,000 ICD-10 diagnosis codes and alters clinical HCC groupings';
      facts = ['Counterpart inquired about Medicare Advantage V28 risk model'];
      objectiveStatus = 'V28 risk adjustment yield impact and audit defense articulated';
    } else if (
      lowerTurn.includes('dsh') ||
      lowerTurn.includes('disproportionate share')
    ) {
      optA = {
        mode: 'PREPARED',
        sayThis:
          '**Medicaid DSH reductions** decrease statutory supplemental payments for high-uncompensated-care hospitals, requiring us to isolate safety-net shortfalls below our **core operating margin**.',
      };
      optB = {
        mode: 'DOMAIN',
        sayThis:
          'To defend against **annual DSH funding cliffs**, our forecast separates **statutory state support** from campus-level controllable operating performance.',
      };
      recallHook = 'unsupported: $8B annual statutory DSH cuts scheduled under federal deficit targets';
      facts = ['Counterpart inquired about Medicaid DSH allotment reductions'];
      objectiveStatus = 'DSH supplemental revenue risk isolated from controllable operations';
    } else if (
      lowerTurn.includes('cms') ||
      lowerTurn.includes('2027') ||
      lowerTurn.includes('regulatory changes')
    ) {
      optA = {
        mode: 'PREPARED',
        sayThis:
          'Our baseline forecast accounts for **CMS regulatory changes** by locking a **governed baseline bridge** that separates statutory payment reductions from controllable operating margin.',
      };
      optB = {
        mode: 'DOMAIN',
        sayThis:
          'Key 2027 rules include the mandatory **TEAM bundled payment model**, final **Medicare Advantage V28 phase-in**, and Medicaid **DSH allotment reductions** impacting safety-net margins.',
      };
      recallHook = 'unsupported: CMS 2027 mandates TEAM bundled episodes, completes MA V28 transition, and enacts statutory DSH cuts';
      facts = ['Counterpart inquired about CMS 2027 regulatory impact'];
      objectiveStatus = 'CMS 2027 regulatory payment rules and baseline bridge framed';
    } else if (
      lowerTurn.includes('ai governance') ||
      lowerTurn.includes('predictive model') ||
      lowerTurn.includes('algorithm')
    ) {
      optA = {
        mode: 'PREPARED',
        sayThis:
          'We govern clinical models through a **cross-functional review committee** that enforces automated drift alerts, bias audits, and clear **rollback thresholds** before clinical deployment.',
      };
      optB = {
        mode: 'DOMAIN',
        sayThis:
          'Our framework aligns with the **NIST AI Risk Management Framework**, mandating ongoing **model drift tracking**, data lineage audits, and documented clinician-in-the-loop validation.',
      };
      recallHook = 'unsupported: automated drift detection triggers retrain evaluation when performance drops >5%';
      facts = ['Counterpart inquired about AI model governance and risk mitigation'];
      objectiveStatus = 'AI governance controls and validation standards communicated';
    }
  }

  // 4. CHECK COMMERCIAL NEGOTIATIONS (Pricing, Timeline, Scope)
  if (!optA.sayThis) {
    if (
      lowerTurn.includes('price') ||
      lowerTurn.includes('pricing') ||
      lowerTurn.includes('fee') ||
      lowerTurn.includes('expensive') ||
      lowerTurn.includes('budget') ||
      lowerTurn.includes('higher than') ||
      lowerTurn.includes('cheaper')
    ) {
      optA = {
        mode: 'PREPARED',
        sayThis:
          'Our fee structure includes end-to-end **SLA guarantees** and dedicated support, eliminating the **costly change orders** typical of lower-priced competitors.',
      };
      optB = {
        mode: 'DOMAIN',
        sayThis:
          'Industry benchmarks confirm that low-bid software providers average thirty percent in **unplanned scope adjustments** and post-launch integration delays.',
      };
      recallHook = 'unsupported: Fixed scope with guaranteed SLA saves 25% overall TCO';
      facts = ['Counterpart raised pricing/budget objection'];
      objectiveStatus = 'Value proposition and TCO defended';
    } else if (
      lowerTurn.includes('timeline') ||
      lowerTurn.includes('deadline') ||
      lowerTurn.includes('schedule') ||
      lowerTurn.includes('q3') ||
      lowerTurn.includes('delay')
    ) {
      optA = {
        mode: 'PREPARED',
        sayThis:
          'We guarantee target **delivery milestones** by locking the **core API specifications** early and running sprint validation cycles in parallel.',
      };
      optB = {
        mode: 'STRATEGIC',
        sayThis:
          'To ensure zero slippage, we recommend establishing a **weekly joint steerco** to unblock dependencies and sign off on incremental deliverables.',
      };
      objectiveStatus = 'Delivery timeline and governance verified';
    } else if (
      lowerTurn.includes('scope') ||
      lowerTurn.includes('change request') ||
      lowerTurn.includes('expansion') ||
      lowerTurn.includes('creep')
    ) {
      optA = {
        mode: 'PREPARED',
        sayThis:
          'We maintain a clear **scope boundary** where any net-new requirements are tagged, estimated, and slotted into **Phase 2 releases** without impacting the launch date.',
      };
      optB = {
        mode: 'DOMAIN',
        sayThis:
          'Establishing a documented **change control charter** prevents delivery drag and ensures budget adjustments require **bilateral executive sign-off**.',
      };
      objectiveStatus = 'Scope management boundaries asserted';
    }
  }

  // 5. DYNAMIC SEMANTIC SCAN OF USER'S CONTENT BOX NOTES (Content Grounding for Option A)
  if (!optA.sayThis) {
    const noteSegments = sessionNotes
      .split(/(?:\r?\n)+/)
      .map((line) => line.trim().replace(/^[-*•\d.]+\s*/, ''))
      .filter((line) => line.length >= 20 && !line.startsWith('Q:') && !line.startsWith('Question:'));

    let bestSegment = '';
    let bestSegmentScore = 0;

    for (const seg of noteSegments) {
      let score = 0;
      const segLower = seg.toLowerCase();
      const segStems = extractKeywords(seg).map(getStem);

      for (const kw of turnKeywords) {
        const kwStem = getStem(kw);
        if (segLower.includes(kw)) {
          score += GENERIC_COMMON_NOUNS.has(kw) ? 1 : 3;
        } else if (segStems.includes(kwStem)) {
          score += GENERIC_COMMON_NOUNS.has(kw) ? 1 : 2;
        }
      }
      if (score > bestSegmentScore) {
        bestSegmentScore = score;
        bestSegment = seg;
      }
    }

    const cleanTurn = cleanExtractedSubject(latestTurn) || 'our core priorities';
    const cleanTargetGain = cleanExtractedSubject(targetGain) || 'core operational commitments';

    if (bestSegment && bestSegmentScore >= 1) {
      const trimmedSeg = bestSegment.replace(/^[A-Z_]+:\s*/, '').trim();
      const needsIntro = lowerTurn.includes('?') || lowerTurn.startsWith('how') || lowerTurn.startsWith('what') || lowerTurn.startsWith('why') || lowerTurn.includes('tell me');

      const intro = voice.pronoun === 'I'
        ? `My approach to ${cleanTurn} is ensuring ${trimmedSeg.charAt(0).toLowerCase() + trimmedSeg.slice(1)}`
        : `Our approach to ${cleanTurn} is ensuring ${trimmedSeg.charAt(0).toLowerCase() + trimmedSeg.slice(1)}`;

      optA = {
        mode: 'YOUR_PROJECT',
        sayThis: ensureBoldKeywords(needsIntro && trimmedSeg.length < 130 ? intro : trimmedSeg),
      };
      optB = {
        mode: 'DOMAIN',
        sayThis: `Looking beyond immediate ${cleanTurn}, ${voice.pronoun} recommend confirming baseline dependencies and establishing clear mutual accountability criteria.`,
      };
      recallHook = `adapted: Content note matched to "${cleanTurn}"`;
      objectiveStatus = `Direct note applied to ${cleanTurn}`;
    } else {
      // Dynamic turn-specific fallback that directly answers what the speaker just said in the user's voice
      optA = {
        mode: 'PREPARED',
        sayThis: `${voice.rolePrefix}, my approach to ${cleanTurn} is establishing transparent governance and mutual accountability. I focus on bringing leaders together around verified data to advance ${cleanTargetGain}.`,
      };
      optB = {
        mode: 'DOMAIN',
        sayThis: `To evaluate ${cleanTurn} effectively, we should review the underlying baseline metrics, identify operational dependencies, and agree on clear milestone criteria.`,
      };
      recallHook = `focus: Address ${cleanTurn} while steering toward ${cleanTargetGain}`;
      objectiveStatus = `Turn on ${cleanTurn} addressed`;
    }
  }

  // 6. ENFORCE CLEAN NATURAL COMPLETE SENTENCES (ALLOW UP TO 70 WORDS)
  optA.sayThis = ensureWordBudget(optA.sayThis, 15, 70, tone);
  optB.sayThis = ensureWordBudget(optB.sayThis, 15, 70, tone);

  if (isAlternate) {
    const temp = optA;
    optA = { mode: optB.mode, sayThis: optB.sayThis };
    optB = { mode: temp.mode, sayThis: temp.sayThis };
  }

  const suggestions: SuggestionItem[] = [
    {
      id: 'sug-1',
      label: 'Option A: Spoken Anchor (Content)',
      mode: optA.mode,
      sayThis: optA.sayThis,
      wordCount: countWords(optA.sayThis),
    },
    {
      id: 'sug-2',
      label: 'Option B: Recall Radar (Domain & Search)',
      mode: optB.mode,
      sayThis: optB.sayThis,
      wordCount: countWords(optB.sayThis),
    },
  ];

  return {
    mode: optA.mode,
    sayThis: optA.sayThis,
    wordCount: countWords(optA.sayThis),
    suggestions,
    recallHook,
    newFactsLearned: facts,
    objectiveStatus,
  };
}

/**
 * Extracts minimalist Live Notes bullets from session notes and recent transcript turns.
 */
export function extractLiveNotes(params: {
  sessionNotes: string;
  transcriptHistory?: Array<{ speaker: string; text: string }>;
  filter?: string;
}): string[] {
  const { sessionNotes = '', transcriptHistory = [], filter = '' } = params;
  const filterLower = filter.trim().toLowerCase();

  const bullets: string[] = [];
  const seen = new Set<string>();

  const lines = sessionNotes.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim().replace(/^[-*•\d.]+\s*/, '').replace(/[*_#]/g, '');
    if (line.length < 15 || line.length > 150) continue;
    if (line.endsWith(':')) continue;

    if (!filterLower || line.toLowerCase().includes(filterLower)) {
      if (!seen.has(line.toLowerCase())) {
        seen.add(line.toLowerCase());
        bullets.push(line);
      }
    }
  }

  for (const turn of transcriptHistory.slice(-10)) {
    const text = turn.text || '';
    const factMatch = text.match(/\b(?:\$\d+[\d,.]*(?:k|m|b)?|\d+%\b|\b(?:q[1-4]|202[4-9])\b|\b\d+\s+(?:days|months|weeks|teams|campuses|hours|fusions|cases)\b)/gi);
    if (factMatch && factMatch.length > 0) {
      const summary = `Fact: "${text.slice(0, 80).trim()}${text.length > 80 ? '...' : ''}"`;
      if (!filterLower || summary.toLowerCase().includes(filterLower)) {
        if (!seen.has(summary.toLowerCase())) {
          seen.add(summary.toLowerCase());
          bullets.push(summary);
        }
      }
    }
  }

  return bullets.slice(0, 15);
}
