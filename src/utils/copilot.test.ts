import test from 'node:test';
import assert from 'node:assert/strict';
import { countWords, parseCopilotResponse, detectSpeaker } from './copilot';

test('countWords accurately counts word tokens', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('Hello world'), 2);
  assert.equal(
    countWords('We solved high latency in our previous microservice migration by adopting asynchronous queues and Redis caching.'),
    16
  );
});

test('detectSpeaker categorizes questions and answers accurately', () => {
  // Typical interview questions from the other person
  assert.equal(detectSpeaker('Tell me about yourself and your technical background.'), 'THEM');
  assert.equal(detectSpeaker('Can you explain how Kafka handles partition rebalancing?'), 'THEM');
  assert.equal(detectSpeaker('Why should we choose your approach over an off-the-shelf SaaS?'), 'THEM');
  assert.equal(detectSpeaker('Walk us through your biggest production incident.'), 'THEM');

  // Answers spoken by the user
  assert.equal(
    detectSpeaker('In my last role, I led the migration of our monolithic payment gateway to microservices.'),
    'YOU'
  );
  assert.equal(
    detectSpeaker('Our team built a distributed caching layer that reduced database load by forty percent.'),
    'YOU'
  );

  // Manual override works
  assert.equal(detectSpeaker('What is your rate?', 'YOU'), 'YOU');
  assert.equal(detectSpeaker('I built this system.', 'THEM'), 'THEM');
});

test('parseCopilotResponse parses dual suggestions format', () => {
  const dualRaw = `PRIMARY_MODE: YOUR_PROJECT
PRIMARY_SAY_THIS: "In our payment gateway revamp, we cut p99 latency from four hundred milliseconds to under sixty milliseconds using connection pooling."

SECONDARY_MODE: STRATEGIC
SECONDARY_SAY_THIS: "Beyond latency, would it help to discuss how our architecture keeps infrastructure compute spend strictly within your target quarterly budget?"

RECALL HOOK: unsupported: Redis cache cluster with 99.99% uptime SLA
NEW FACTS LEARNED: Client mentions 50,000 peak concurrent users, 3 AWS regions
OBJECTIVE STATUS: Performance SLA validation addressed`;

  const parsed = parseCopilotResponse(dualRaw);
  assert.equal(parsed.mode, 'YOUR_PROJECT');
  assert.equal(parsed.suggestions.length, 2);

  // Option 1
  assert.equal(parsed.suggestions[0].mode, 'YOUR_PROJECT');
  assert.equal(
    parsed.suggestions[0].sayThis,
    'In our payment gateway revamp, we cut p99 latency from four hundred milliseconds to under sixty milliseconds using connection pooling.'
  );
  assert.ok(parsed.suggestions[0].wordCount >= 15 && parsed.suggestions[0].wordCount <= 35);

  // Option 2
  assert.equal(parsed.suggestions[1].mode, 'STRATEGIC');
  assert.equal(
    parsed.suggestions[1].sayThis,
    'Beyond latency, would it help to discuss how our architecture keeps infrastructure compute spend strictly within your target quarterly budget?'
  );
  assert.ok(parsed.suggestions[1].wordCount >= 15 && parsed.suggestions[1].wordCount <= 35);

  assert.equal(parsed.recallHook, 'unsupported: Redis cache cluster with 99.99% uptime SLA');
  assert.equal(parsed.newFactsLearned.length, 2);
  assert.equal(parsed.newFactsLearned[0], 'Client mentions 50,000 peak concurrent users');
  assert.equal(parsed.newFactsLearned[1], '3 AWS regions');
  assert.equal(parsed.objectiveStatus, 'Performance SLA validation addressed');
});

test('parseCopilotResponse maintains backwards compatibility with single suggestion format', () => {
  const singleRaw = `MODE: DOMAIN
SAY THIS: "When evaluating micro-frontends versus a modular monolith, team velocity and boundary decoupling always determine the tipping point."
RECALL HOOK: NONE
NEW FACTS LEARNED: NONE
OBJECTIVE STATUS: NONE`;

  const parsed = parseCopilotResponse(singleRaw);
  assert.equal(parsed.mode, 'DOMAIN');
  assert.equal(parsed.suggestions.length, 2);
  assert.equal(parsed.suggestions[0].mode, 'DOMAIN');
  assert.ok(parsed.suggestions[0].wordCount >= 15);
  assert.ok(parsed.suggestions[1].wordCount >= 15);
  assert.equal(parsed.recallHook, 'NONE');
  assert.deepEqual(parsed.newFactsLearned, []);
});
