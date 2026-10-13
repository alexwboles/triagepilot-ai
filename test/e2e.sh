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

// FLOW 11: manual correction teaches the classifier a distinctive keyword
flow('learning: correcting to urgent teaches "zylophone" -> future emails urgent', () => {
  T.resetLearnedRules();
  const before = T.classify('Zylophone status', 'How is the zylophone holding up?');
  assert.notStrictEqual(before.category, 'urgent', 'must not be urgent before learning');
  const fresh = T.learnCorrection('urgent', 'Zylophone calibration overdue', 'The zylophone calibration is overdue, please advise.');
  assert.ok(fresh.includes('zylophone'), 'should learn the distinctive word');
  const after = T.classify('Zylophone status', 'How is the zylophone holding up?');
  assert.strictEqual(after.category, 'urgent');
  assert.ok(/learned/i.test(after.reason), 'reason should cite learning');
  assert.ok(T.getLearnedRules().urgent.includes('zylophone'), 'persisted in learned rules');
});

// FLOW 12: learned rules are per-category and reset cleanly
flow('learning: set/reset round-trips and does not leak across categories', () => {
  T.resetLearnedRules();
  T.setLearnedRules({ urgent: ['quimblex'], reply: [], fyi: [], spam: [] });
  const r = T.classify('Quimblex?', 'The quimblex is making noise again.');
  assert.strictEqual(r.category, 'urgent');
  assert.strictEqual(T.getLearnedRules().reply.length, 0, 'no cross-category leak');
  T.resetLearnedRules();
  assert.deepStrictEqual(T.getLearnedRules().urgent, [], 'reset clears');
  const plain = T.classify('Quimblex?', 'The quimblex is making noise again.');
  assert.notStrictEqual(plain.category, 'urgent', 'no learned residue after reset');
});

// FLOW 13: stopwords are never learned
flow('learning: stopwords ("the", "please") are never learned', () => {
  T.resetLearnedRules();
  const fresh = T.learnCorrection('spam', 'The please thank you', 'Please thank the team.');
  assert.ok(!fresh.includes('the') && !fresh.includes('please'), 'stopwords skipped: ' + JSON.stringify(fresh));
  T.resetLearnedRules();
});


// FLOW 14: snooze — hidden until the stamp passes, remaining text formats
flow('snooze: visibleEmails hides snoozed mail, snoozeRemaining formats', () => {
  const now = 1000000;
  const emails = [
    { id: 'a', snoozedUntil: 0 },
    { id: 'b', snoozedUntil: now - 1 },
    { id: 'c', snoozedUntil: now + 25 * 60000 },
    { id: 'd', snoozedUntil: now + 3 * 3600000 },
    { id: 'e', snoozedUntil: now + 3 * 24 * 3600000 }
  ];
  const vis = T.visibleEmails(emails, now).map((e) => e.id);
  assert.deepStrictEqual(vis, ['a', 'b'], 'only awake emails visible');
  assert.strictEqual(T.snoozeRemaining(emails[2], now), '25m');
  assert.strictEqual(T.snoozeRemaining(emails[3], now), '3h');
  assert.strictEqual(T.snoozeRemaining(emails[4], now), '3d');
  assert.strictEqual(T.snoozeRemaining(emails[0], now), '', 'awake -> empty string');
});

// FLOW 15: sender lists — blocked forces spam, trusted can never be spam
flow('sender lists: block forces spam, trust rescues spam', () => {
  T.resetSenderLists();
  const spammy = 'Congratulations, you won the lottery! Claim your prize now.';
  const before = T.classify('Prize', spammy);
  assert.strictEqual(before.category, 'spam', 'sanity: this is spam');
  T.listSender('trusted', 'Lucky Winner <winner@lotto-prizes.biz>');
  const trusted = T.classifyWithSender('Prize', spammy, 'Lucky Winner <winner@lotto-prizes.biz>');
  assert.strictEqual(trusted.category, 'reply', 'trusted sender kept out of spam');
  T.listSender('blocked', 'newsletter@spam-deals.com');
  const forced = T.classifyWithSender('Hello', 'Just checking in about Tuesday.', 'Bob <newsletter@spam-deals.com>');
  assert.strictEqual(forced.category, 'spam', 'blocked sender -> spam');
  assert.ok(/blocklist/.test(forced.reason));
  T.listSender('trusted', 'newsletter@spam-deals.com');
  assert.strictEqual(T.senderAction('newsletter@spam-deals.com'), 'trust');
  assert.strictEqual(T.senderAction('nobody@nowhere.test'), null);
  T.resetSenderLists();
});

// FLOW 16: bulk ops — remove / handled / relabel are pure and scoped to ids
flow('bulk: remove, handled, relabel act only on the given ids', () => {
  const emails = [
    { id: 'm1', category: 'reply', label: 'Needs reply', handled: false },
    { id: 'm2', category: 'reply', label: 'Needs reply', handled: false },
    { id: 'm3', category: 'spam', label: 'Spam', handled: false }
  ];
  const gone = T.bulkRemove(emails, ['m2']);
  assert.deepStrictEqual(gone.map((e) => e.id), ['m1', 'm3']);
  assert.strictEqual(emails.length, 3, 'input untouched');
  const held = T.bulkSetHandled(emails, ['m1'], true);
  assert.strictEqual(held[0].handled, true);
  assert.strictEqual(held[1].handled, false);
  const rel = T.bulkRelabel(emails, ['m1', 'm3'], 'urgent');
  assert.strictEqual(rel[0].category, 'urgent');
  assert.strictEqual(rel[0].label, 'Urgent');
  assert.strictEqual(rel[2].category, 'urgent');
  const bad = T.bulkRelabel(emails, ['m1'], 'nope');
  assert.strictEqual(bad[0].category, 'reply', 'bad category leaves email alone');
});

console.log('\ne2e: ' + n + ' flows passed');
EOF
