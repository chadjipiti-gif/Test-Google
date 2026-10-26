import test from 'node:test';
import assert from 'node:assert/strict';
import { matchContextNotes, ensureWordBudget, extractLiveNotes, parseQAPairs } from './contextMatcher';
import { countWords } from './copilot';

const MULTI_PURPOSE_CLIENT_NOTES = `ENGAGEMENT_GOAL:
Deliver enterprise data modernization on time within Q3, securing client trust and establishing ongoing advisory retainer.

SCOPE_AND_DELIVERY:
Phase 1 locks core API endpoints by May 15th, running sprint validations in parallel. Phase 2 handles non-critical reporting extensions.

SAMPLE_QA:
Q: Why is your fee structure higher than other consulting firms?
A: Our rate includes dedicated tier-one engineering and end-to-end SLA guarantees, preventing costly downstream scope rework.

Q: Can you guarantee Q3 delivery if our internal team is delayed?
A: We decouple our delivery pipeline from non-critical client dependencies, maintaining sprint momentum through mock service interfaces.`;

test('parses Sample Q&A pairs accurately', () => {
  const qa = parseQAPairs(MULTI_PURPOSE_CLIENT_NOTES);
  assert.equal(qa.length, 2);
  assert.ok(qa[0].question.includes('fee structure'));
  assert.ok(qa[0].answer.includes('SLA guarantees'));
  assert.ok(qa[1].question.includes('Q3 delivery'));
});

test('adapts Sample Q&A dynamically when client asks price objection', () => {
  const result = matchContextNotes({
    sessionNotes: MULTI_PURPOSE_CLIENT_NOTES,
    latestTurn: 'Why are your rates so much higher than competitor bids?',
    discussionPreset: {
      whoWeAre: 'Lead Strategic Consultant',
      whoTheyAre: 'Client VP of Operations',
      purpose: 'Scope enterprise modernization',
      desiredOutcome: 'Secure sign-off on Phase 1 contract',
    },
  });

  const optA = result.suggestions[0];
  const optB = result.suggestions[1];

  // Option A must dynamically adapt the prepared answer without rigid recital
  assert.ok(optA.sayThis.includes('SLA guarantees') || optA.sayThis.includes('fee structure') || optA.sayThis.includes('rate'));
  assert.ok(optA.wordCount >= 15 && optA.wordCount <= 35, `Option A words: ${optA.wordCount}`);

  // Option B must provide strategic radar / domain perspective
  assert.ok(optB.wordCount >= 15 && optB.wordCount <= 35, `Option B words: ${optB.wordCount}`);
});

test('handles contract negotiation inquiry on scope creep without hardcoded hospital bias', () => {
  const result = matchContextNotes({
    sessionNotes: 'We maintain a strict scope boundary. Any net-new features must be estimated and scheduled for Phase 2 releases.',
    latestTurn: 'What happens if we need to add three new reporting modules mid-project?',
    discussionPreset: {
      whoWeAre: 'Senior Engagement Director',
      whoTheyAre: 'Client Product Owner',
      purpose: 'Align sprint backlog',
      desiredOutcome: 'Protect delivery schedule and budget',
    },
  });

  const optA = result.suggestions[0];
  const optB = result.suggestions[1];

  assert.ok(optA.sayThis.toLowerCase().includes('scope') || optA.sayThis.toLowerCase().includes('phase 2'));
  assert.ok(optA.wordCount >= 15 && optA.wordCount <= 35);
  assert.ok(optB.wordCount >= 15 && optB.wordCount <= 35);
});

test('handles personal/tenant discussion with proper consumer tone', () => {
  const result = matchContextNotes({
    sessionNotes: 'LEAST_TERMS: Section 14 mandates 48-hour repairs for heating and plumbing failures under city housing codes.',
    latestTurn: 'Why do you keep asking about the furnace repair?',
    discussionPreset: {
      whoWeAre: 'Tenant',
      whoTheyAre: 'Property Manager',
      purpose: 'Resolve outstanding heating maintenance',
      desiredOutcome: 'Secure written repair confirmation for this week',
    },
  });

  const optA = result.suggestions[0];
  const optB = result.suggestions[1];

  assert.ok(optA.sayThis.includes('written agreement') || optA.sayThis.includes('repair') || optA.sayThis.includes('maintenance'));
  assert.ok(optA.wordCount >= 15 && optA.wordCount <= 35);
  assert.ok(optB.wordCount >= 15 && optB.wordCount <= 35);
});

test('handles: what is the team bundled payment model (regulatory regression check)', () => {
  const result = matchContextNotes({
    sessionNotes: 'Mandatory bundled payment models take effect in selected MSAs.',
    latestTurn: 'what is the team bundled payment model',
  });

  const optA = result.suggestions[0];
  const optB = result.suggestions[1];

  assert.ok(optA.sayThis.toLowerCase().includes('team model') || optA.sayThis.toLowerCase().includes('episode spending'));
  assert.ok(optA.wordCount >= 15 && optA.wordCount <= 70);
  assert.ok(optB.sayThis.toLowerCase().includes('transforming episode accountability model') || optB.sayThis.toLowerCase().includes('target prices'));
  assert.ok(optB.wordCount >= 15 && optB.wordCount <= 70);
});

test('ensureWordBudget preserves complete sentences without cut-off and cleans dangling prepositions', () => {
  const shortText = 'We need to align on the core metric.';
  const expanded = ensureWordBudget(shortText, 15, 70, 'COLLABORATIVE');
  const expCount = countWords(expanded);
  assert.ok(expCount >= 5, `Expanded count (${expCount})`);
  assert.ok(expanded.endsWith('.'));

  const textWithDangling = 'In our role we align with our core commitment to Prove that I have the.';
  const cleaned = ensureWordBudget(textWithDangling, 10, 70);
  assert.ok(!cleaned.endsWith('the.'), 'Must not end with dangling article');
  assert.ok(cleaned.endsWith('.'));
});

test('handles: why did stewart not file CHIA reports accurately with BMC and domain knowledge', () => {
  const result = matchContextNotes({
    sessionNotes: `ORGANIZATIONAL_MANDATE:
Operating review for Boston Medical Center (BMC) health system integration. The five teams run one planning and performance cycle.
SAMPLE_QA:
Q: What happens if our stakeholders request additional custom reports?
A: We maintain a clear scope boundary where net-new reporting requirements are estimated and scheduled into Phase 2 releases.`,
    latestTurn: 'why did stewart not file CHIA reports',
    discussionPreset: {
      whoWeAre: 'VP of Finance & Hospital Operations Lead (BMC)',
      whoTheyAre: 'Operating Leaders, Clinical Chairs & Regulatory Counterparts',
      discussionScope: 'Governance, hospital financial integration, and regulatory compliance',
      targetGain: 'Lock governed variance packs and verify statutory reporting compliance',
    },
  });

  const optA = result.suggestions[0];
  const optB = result.suggestions[1];

  // Option A must NOT be the unrelated custom reports Q&A or sliced gibberish
  assert.ok(!optA.sayThis.includes('happens if our stakeholders re'));
  assert.ok(!optA.sayThis.includes('Phase 2 releases'));
  assert.ok(optA.sayThis.toLowerCase().includes('chia statutory filings') || optA.sayThis.toLowerCase().includes('governed hospital leadership'));
  assert.ok(optA.wordCount >= 15 && optA.wordCount <= 70, `Option A word count: ${optA.wordCount}`);

  // Option B must surface Steward's CHIA reporting failure and court contempt
  assert.ok(optB.sayThis.includes('Steward') || optB.sayThis.includes('CHIA'));
  assert.ok(optB.wordCount >= 15 && optB.wordCount <= 70, `Option B word count: ${optB.wordCount}`);
});

test('handles: how would you build the dashboards in first-person candidate voice without cutoff', () => {
  const notes = `ORGANIZATIONAL_MANDATE & CONTEXT:
Operating review for Boston Medical Center (BMC) health system integration. The five teams run one planning and performance cycle in which the explanation, the forecast, and the operating commitment use the same governed numbers.
Campus and service-line leaders at Brighton and South receive usable packs that isolate controllable labor, carry residual tags, and show the pre-support result.
Isolate boarding hours, sitter hours, and traveler differentials against the flexible budget.`;

  const result = matchContextNotes({
    sessionNotes: notes,
    latestTurn: 'how would you build the dashboards',
    discussionPreset: {
      whoWeAre: 'Candidate for Executive Director - Financial Analytics',
      whoTheyAre: 'VP of Finance & Search Committee',
      discussionScope: 'Health system financial integration and analytics leadership',
      targetGain: 'Demonstrate leadership readiness and operational command',
    },
  });

  const optA = result.suggestions[0];
  const optB = result.suggestions[1];

  // Must use first-person singular (I/my), NOT "our role" or "we"
  assert.ok(optA.sayThis.startsWith('My approach') || optA.sayThis.includes(' I ') || optA.sayThis.includes('my '));
  assert.ok(!optA.sayThis.includes('In our role as Candidate'));

  // Must address building dashboards / packs directly
  assert.ok(optA.sayThis.toLowerCase().includes('dashboard') || optA.sayThis.toLowerCase().includes('pack'));
  assert.ok(optA.sayThis.toLowerCase().includes('controllable labor') || optA.sayThis.toLowerCase().includes('pre-support'));

  // Must not have trailing cut-off like "Prove that I have the."
  assert.ok(!optA.sayThis.includes('have the.'));
  assert.ok(optA.sayThis.endsWith('.'));
  assert.ok(optA.wordCount >= 20 && optA.wordCount <= 70, `Opt A word count: ${optA.wordCount}`);

  // Option B must provide strategic domain radar
  assert.ok(optB.wordCount >= 15 && optB.wordCount <= 70, `Opt B word count: ${optB.wordCount}`);
  assert.ok(!optB.sayThis.includes('would you build the dashboard')); // Clean subject
});

test('extractLiveNotes returns minimalist bullets and responds to filters', () => {
  const bullets = extractLiveNotes({
    sessionNotes: MULTI_PURPOSE_CLIENT_NOTES,
    transcriptHistory: [{ speaker: 'THEM', text: 'Our total budget is $450k across 6 months' }],
    filter: 'budget',
  });

  assert.ok(bullets.some((b) => b.toLowerCase().includes('budget') || b.toLowerCase().includes('$450k')));
});

test('distinct discussion turns produce dynamic, turn-specific Suggestion Box updates', () => {
  const notes = `ORGANIZATIONAL_MANDATE:
Operating review for Boston Medical Center (BMC) health system integration. The five teams run one planning and performance cycle.
All campus reporting must strictly satisfy Massachusetts CHIA statutory filing standards.
Isolate boarding hours, sitter hours, and traveler differentials against the flexible budget.`;

  const turnA = matchContextNotes({
    sessionNotes: notes,
    latestTurn: '[THEM]: tell me about your background leading finance teams',
  });

  const turnB = matchContextNotes({
    sessionNotes: notes,
    latestTurn: '[THEM]: how do we isolate controllable labor variances',
  });

  const turnC = matchContextNotes({
    sessionNotes: notes,
    latestTurn: '[THEM]: what are you seeing at the acquired campuses',
  });

  // Suggestion boxes must NOT be identical across different discussion turns
  assert.notStrictEqual(turnA.suggestions[0].sayThis, turnB.suggestions[0].sayThis);
  assert.notStrictEqual(turnA.suggestions[1].sayThis, turnB.suggestions[1].sayThis);
  assert.notStrictEqual(turnB.suggestions[0].sayThis, turnC.suggestions[0].sayThis);

  // Turn B Option A should address controllable labor variances
  assert.ok(turnB.suggestions[0].sayThis.toLowerCase().includes('labor') || turnB.suggestions[0].sayThis.toLowerCase().includes('boarding'));

  // Turn C should address acquired campuses
  assert.ok(turnC.suggestions[0].sayThis.toLowerCase().includes('campus') || turnC.suggestions[0].sayThis.toLowerCase().includes('acquired'));
});



