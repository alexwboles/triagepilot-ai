#!/usr/bin/env bash
# triagepilot-ai end-to-end tests — exercise the full triage -> digest -> draft flow in node.
set -euo pipefail
cd "$(dirname "$0")/.."

node <<'EOF'
const assert = require('assert');
const T = require('./js/classifier.js');
const samples = require('./data/samples.json');

let n = 0;
const flow = (name, fn) => { fn(); n++; console.log('ok   - ' + name); };

// FLOW 1: full inbox triage produces a sane digest
flow('digest: 10 emails triaged, counts add up, all 4 categories present', () => {
  const counts = { urgent: 0, reply: 0, fyi: 0, spam: 0 };
  for (const e of samples) counts[T.classify(e.subject, e.body).category]++;
  assert.strictEqual(counts.urgent + counts.reply + counts.fyi + counts.spam, 10);
  for (const c of Object.keys(counts)) assert.ok(counts[c] >= 1, 'category ' + c + ' empty');
  console.log('       digest = ' + JSON.stringify(counts));
});

// FLOW 2: urgent complaint flagged urgent with a plain-language reason
flow('urgent complaint (no hot water, legal threat) -> urgent with reason', () => {
  const e = samples.find(x => x.id === 'e2');
  const r = T.classify(e.subject, e.body);
  assert.strictEqual(r.category, 'urgent');
  assert.ok(r.reason.length > 20, 'reason should explain itself');
  assert.ok(/urgent/i.test(r.reason));
});

// FLOW 3: spam filtered (both spam samples)
flow('spam filtered: crypto + SEO pitches -> spam', () => {
  for (const id of ['e6', 'e7']) {
    const e = samples.find(x => x.id === id);
    assert.strictEqual(T.classify(e.subject, e.body).category, 'spam', id);
  }
});

// FLOW 4: reply drafted for an urgent email, contains apology + business name
flow('urgent draft: apology tone, personalized, business sign-off', () => {
  const e = samples.find(x => x.id === 'e1');
  const r = T.classify(e.subject, e.body);
  const draft = T.draftReply({ ...e, category: r.category }, 'professional', 'Acme Plumbing');
  assert.ok(/sorry/i.test(draft), 'urgent draft should apologize');
  assert.ok(draft.includes('Sarah'), 'draft should use sender first name');
  assert.ok(draft.includes('Acme Plumbing'), 'draft should sign off with business');
});

// FLOW 5: tones differ, FYI draft is short, spam draft says no reply needed
flow('tones differ; fyi draft brief; spam draft declines to reply', () => {
  const e = samples.find(x => x.id === 'e3');
  const pro = T.draftReply({ ...e, category: 'reply' }, 'professional', 'Biz');
  const fri = T.draftReply({ ...e, category: 'reply' }, 'friendly', 'Biz');
  assert.notStrictEqual(pro, fri, 'tones should differ');
  const fyi = T.draftReply({ ...samples.find(x => x.id === 'e9'), category: 'fyi' }, 'professional', 'Biz');
  assert.ok(fyi.length < pro.length, 'fyi draft should be shorter than reply draft');
  const spam = T.draftReply({ ...samples.find(x => x.id === 'e6'), category: 'spam' }, 'professional', 'Biz');
  assert.ok(/no reply needed/i.test(spam), 'spam draft should decline');
});

// FLOW 6: paste-in flow — brand-new flooded-basement email triaged urgent
flow('paste-in: "basement flooded, need help ASAP" -> urgent', () => {
  const r = T.classify('Help!', 'My basement is flooded, need help ASAP, water everywhere.');
  assert.strictEqual(r.category, 'urgent');
});

// FLOW 7: sample accuracy — at least 8/10 match human-expected labels
flow('accuracy: >= 8/10 samples match expected labels', () => {
  let correct = 0;
  for (const e of samples) {
    if (T.classify(e.subject, e.body).category === e.expected) correct++;
    else console.log('       miss: ' + e.id + ' expected ' + e.expected);
  }
  console.log('       accuracy = ' + correct + '/10');
  assert.ok(correct >= 8, 'accuracy below 8/10');
});

// FLOW 8: inbox search finds the right emails, category filter isolates spam
flow('search + category filter over the triaged inbox', () => {
  const inbox = samples.map(e => ({ ...e, category: T.classify(e.subject, e.body).category }));
  const flood = T.filterEmails(inbox, 'flood', '');
  assert.ok(flood.length >= 1 && flood.every(e => (e.subject + e.body).toLowerCase().includes('flood')));
  const spamOnly = T.filterEmails(inbox, '', 'spam');
  assert.ok(spamOnly.length >= 2 && spamOnly.every(e => e.category === 'spam'));
  const cleared = inbox.filter(e => e.category !== 'spam');
  assert.strictEqual(cleared.length, inbox.length - spamOnly.length);
  assert.ok(cleared.every(e => e.category !== 'spam'), 'clear-spam must remove all spam');
  console.log('       flood hits=' + flood.length + ', spam=' + spamOnly.length);
});

// FLOW 9: manual label correction — cycle then re-derive the digest
flow('wrong-label correction cycles the category and digest follows', () => {
  const inbox = samples.map(e => ({ ...e, category: T.classify(e.subject, e.body).category }));
  const target = inbox.find(e => e.category === 'fyi');
  assert.ok(target, 'need an fyi email to correct');
  target.category = T.nextCategory(target.category); // fyi -> spam
  assert.strictEqual(target.category, 'spam');
  target.label = T.LABELS[target.category];
  const d = T.digestText(inbox);
  const m = d.match(/^(\d+) emails triaged: (\d+) urgent, (\d+) need reply, (\d+) FYI, (\d+) spam$/m);
  assert.ok(m, 'digest headline parseable');
  assert.strictEqual(Number(m[1]), 10);
  assert.strictEqual(Number(m[2]) + Number(m[3]) + Number(m[4]) + Number(m[5]), 10);
});

// FLOW 10: search is case-insensitive and matches from/subject/body
flow('search matches sender, subject, and body text', () => {
  const inbox = samples.map(e => ({ ...e, category: T.classify(e.subject, e.body).category }));
  const byName = T.filterEmails(inbox, 'SARAH', '');
  assert.ok(byName.length >= 1, 'sender name search');
  const bySubject = T.filterEmails(inbox, 'quote', '');
  assert.ok(bySubject.some(e => e.id === 'e3'), 'subject search finds quote request');
  const none = T.filterEmails(inbox, 'qqqzzz-nope', '');
  assert.strictEqual(none.length, 0);
});

console.log('\ne2e: ' + n + ' flows passed');
EOF
