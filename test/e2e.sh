#!/usr/bin/env bash
# triagepilot-ai end-to-end tests — exercise the full triage -> digest -> draft flow in node.
set -euo pipefail
cd "$(dirname "$0")/.."

node <<'EOF'
const assert = require('assert');
const T = require('./js/classifier.js');
const samples = require('./data/samples.json');

let n = 0;
const queue = [];
const flow = (name, fn) => { queue.push([name, fn]); };

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

// REDESIGN FLOW: split-inbox views partition the inbox like Superhuman
flow('split inbox: focus = urgent+reply, fyi/spam by category, snoozed separate', () => {
  const box = samples.map((s) => {
    const r = T.classify(s.subject, s.body);
    return { id: s.id, category: r.category, label: r.label, handled: false };
  });
  const focus = T.applySplit(box, 'focus');
  assert.ok(focus.length >= 2, 'focus has emails');
  assert.ok(focus.every((e) => e.category === 'urgent' || e.category === 'reply'));
  const fyi = T.applySplit(box, 'fyi');
  assert.ok(fyi.length >= 1 && fyi.every((e) => e.category === 'fyi'));
  const spam = T.applySplit(box, 'spam');
  assert.ok(spam.length >= 1 && spam.every((e) => e.category === 'spam'));
  const all = T.applySplit(box, '');
  assert.strictEqual(all.length, box.length, 'all shows everything awake');
  assert.strictEqual(T.applySplit(box, 'snoozed').length, 0, 'no snoozed yet');
  // snoozing one moves it to the snoozed split and out of the others
  const sleeping = box.map((e) => ({ ...e, snoozedUntil: e.id === 'e1' ? Date.now() + 3600000 : 0 }));
  assert.strictEqual(T.applySplit(sleeping, 'snoozed').length, 1);
  assert.strictEqual(T.applySplit(sleeping, '').length, box.length - 1);
  assert.ok(!T.applySplit(sleeping, 'focus').some((e) => e.id === 'e1'));
});

// FLOW 17: per-sender memory — corrections teach where a SENDER's mail files
flow('sender memory: rememberSender steers classifyWithSender', () => {
  T.resetSenderLists();
  T.resetSenderMemory();
  const from = 'Carol Dent <carol@dent-repairs.com>';
  // urgent-looking mail before any memory
  const before = T.classifyWithSender('Pipe burst', 'Water everywhere, emergency, come ASAP!', from);
  assert.strictEqual(before.category, 'urgent');
  // user corrects it to FYI -> memory records the sender
  assert.strictEqual(T.rememberSender('fyi', from), 'carol@dent-repairs.com');
  const after = T.classifyWithSender('Pipe burst', 'Water everywhere, emergency, come ASAP!', from);
  assert.strictEqual(after.category, 'fyi', 'memory steers to the user-chosen category');
  assert.ok(/usually file/i.test(after.reason), 'reason cites per-sender memory: ' + after.reason);
  // memory does not apply to other senders
  const other = T.classifyWithSender('Pipe burst', 'Water everywhere, emergency, come ASAP!', 'Zed <zed@other.com>');
  assert.strictEqual(other.category, 'urgent', 'other senders unaffected');
  // blocklist still wins over memory (explicit > learned)
  T.listSender('blocked', from);
  const blocked = T.classifyWithSender('Hi', 'Just a note.', from);
  assert.strictEqual(blocked.category, 'spam', 'blocklist beats memory');
  T.unlistSender(from);
  // trusted sender remembered as spam stays out of spam
  T.listSender('trusted', 'Penpal <pal@pen.com>');
  T.rememberSender('spam', 'Penpal <pal@pen.com>');
  const trusted = T.classifyWithSender('Prize', 'You won the lottery, claim your prize!', 'Penpal <pal@pen.com>');
  assert.notStrictEqual(trusted.category, 'spam', 'trust rescues even memory-spam');
  // persistence round-trip
  T.setSenderMemory({ 'a@x.com': 'urgent', 'bad': 'nope', '': 'reply' });
  assert.deepStrictEqual(T.getSenderMemory(), { 'a@x.com': 'urgent' });
  T.resetSenderMemory();
  assert.deepStrictEqual(T.getSenderMemory(), {});
  T.resetSenderLists();
});

// FLOW 18: sent tracking — markSent resolves the email, sentCount counts
flow('sent tracking: markSent sets sentAt+handled, pure; sentCount counts', () => {
  const inbox = [
    { id: 'm1', handled: false },
    { id: 'm2', handled: false }
  ];
  const out = T.markSent(inbox, 'm1', 1234567890);
  assert.strictEqual(out[0].handled, true, 'sent email is handled');
  assert.strictEqual(out[0].sentAt, 1234567890, 'sentAt stamped');
  assert.strictEqual(out[1].handled, false, 'other email untouched');
  assert.strictEqual(inbox[0].handled, false, 'input array untouched');
  assert.strictEqual(T.sentCount(out), 1);
  assert.strictEqual(T.sentCount(inbox), 0);
  assert.strictEqual(T.markSent(inbox, 'nope', 1).length, 2, 'unknown id leaves all');
});

// FLOW 19: Gmail module loads in node, no real credentials needed
flow('gmail module: loads in node, read-only scope, no hardcoded secrets', () => {
  const G = require('./js/gmail.js');
  for (const f of ['getConfig', 'isConfigured', 'requestAccessToken', 'revokeToken',
    'listRecentMessages', 'getMessageFull', 'parseGmailMessage', 'mapGmailMessage',
    'extractBody', 'stripHtml', 'b64urlDecode', 'dedupByGmailId', 'syncInbox']) {
    assert.strictEqual(typeof G[f], 'function', 'gmail.js exports ' + f);
  }
  assert.strictEqual(G.GMAIL_SCOPE, 'https://www.googleapis.com/auth/gmail.readonly');
  assert.strictEqual(G.isConfigured(), false, 'unconfigured without a client ID');
  globalThis.TRIAGEPILOT_GMAIL = { clientId: ' test-id.apps.googleusercontent.com ' };
  assert.strictEqual(G.isConfigured(), true, 'configured once a client ID is supplied');
  assert.deepStrictEqual(G.getConfig(), { clientId: 'test-id.apps.googleusercontent.com' });
  delete globalThis.TRIAGEPILOT_GMAIL;
});

// FLOW 20: Gmail parsing — headers, plain/html bodies, mapping to triage shape
flow('gmail parsing: headers + multipart body -> triage-ready email', async () => {
  const G = require('./js/gmail.js');
  const b64u = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const full = {
    id: 'abc123', threadId: 't9', internalDate: '1760890000000', snippet: 'snip…',
    payload: {
      headers: [
        { name: 'From', value: 'Jane Doe <jane@plumbco.com>' },
        { name: 'Subject', value: 'Quote request' },
        { name: 'Date', value: 'Mon, 19 Oct 2026 10:00:00 -0400' }
      ],
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64u('Hi, how much for a water heater install? Thanks!') } },
        { mimeType: 'text/html', body: { data: b64u('<p>Hi, <b>how much</b> for a water heater install?</p>') } }
      ]
    }
  };
  const parsed = G.parseGmailMessage(full);
  assert.strictEqual(parsed.from, 'Jane Doe <jane@plumbco.com>');
  assert.strictEqual(parsed.subject, 'Quote request');
  assert.strictEqual(parsed.receivedAt, 1760890000000);
  assert.ok(parsed.body.includes('how much for a water heater install'), 'text/plain preferred');
  assert.ok(!parsed.body.includes('<b>'), 'no raw HTML in body');
  // html-only fallback
  const htmlOnly = { id: 'h1', payload: { headers: [{ name: 'From', value: 'x@y.z' }], parts: [{ mimeType: 'text/html', body: { data: b64u('<div>Hello<br>world</div>') } }] } };
  assert.ok(G.parseGmailMessage(htmlOnly).body.includes('Hello'), 'html stripped to text');
  // mapping to the triage shape
  const email = G.mapGmailMessage(parsed);
  assert.strictEqual(email.id, 'gmail:abc123');
  assert.strictEqual(email.gmailId, 'abc123');
  assert.strictEqual(email.handled, false);
  // the triage classifier accepts the mapped shape
  const r = T.classifyWithSender(email.subject, email.body, email.from);
  assert.strictEqual(r.category, 'reply', 'quote request triages as needs-reply');
});

// FLOW 21: Gmail sync with a MOCKED fetch — no real Google credentials
flow('gmail sync (mocked): list -> fetch -> map, newest-first, dedupe', async () => {
  const G = require('./js/gmail.js');
  const b64u = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const mkMsg = (id, subject, body) => ({
    id, threadId: 't-' + id, internalDate: '1760890000000', snippet: '',
    payload: {
      headers: [
        { name: 'From', value: 'Sender <s@example.com>' },
        { name: 'Subject', value: subject }
      ],
      parts: [{ mimeType: 'text/plain', body: { data: b64u(body) } }]
    }
  });
  const store = {
    m1: mkMsg('m1', 'Urgent: flooding', 'Water everywhere, emergency ASAP!'),
    m2: mkMsg('m2', 'Monthly newsletter', 'Our October newsletter is here. Unsubscribe anytime.')
  };
  const calls = [];
  const mockFetch = (url, opts) => {
    calls.push(url);
    assert.ok((opts.headers.Authorization || '').startsWith('Bearer '), 'auth header sent');
    let data;
    if (url.includes('/users/me/messages?')) data = { messages: [{ id: 'm1', threadId: 't-m1' }, { id: 'm2', threadId: 't-m2' }] };
    else if (url.includes('/messages/m1')) data = store.m1;
    else if (url.includes('/messages/m2')) data = store.m2;
    else throw new Error('unexpected url: ' + url);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(data), text: () => Promise.resolve('') });
  };
  const emails = await G.syncInbox('fake-token', { maxResults: 25 }, mockFetch);
  assert.strictEqual(emails.length, 2);
  assert.strictEqual(emails[0].id, 'gmail:m1', 'newest-first order preserved');
  assert.strictEqual(emails[1].subject, 'Monthly newsletter');
  // triage applies to synced mail
  const r0 = T.classifyWithSender(emails[0].subject, emails[0].body, emails[0].from);
  assert.strictEqual(r0.category, 'urgent');
  const r1 = T.classifyWithSender(emails[1].subject, emails[1].body, emails[1].from);
  assert.strictEqual(r1.category, 'fyi', 'newsletter triages as FYI');
  // dedupe: m1 already in the inbox
  const fresh = G.dedupByGmailId([{ gmailId: 'm1' }], emails);
  assert.deepStrictEqual(fresh.map((e) => e.id), ['gmail:m2']);
  // API errors surface with status
  const badFetch = () => Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve('Invalid credentials') });
  await assert.rejects(G.listRecentMessages('bad', {}, badFetch), /401/);
  await G.revokeToken('tok', (u) => { assert.ok(u.includes('oauth2.googleapis.com/revoke'), 'revoke endpoint'); return Promise.resolve({}); });
});

// FLOW 22: setup doc covers the whole OAuth flow, warns about the secret
flow('docs: GMAIL-SETUP.md covers consent screen, scopes, test users, secret warning', () => {
  const fs = require('fs');
  const doc = fs.readFileSync('./docs/GMAIL-SETUP.md', 'utf8').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').toLowerCase();
  for (const needle of ['OAuth consent screen', 'gmail.readonly', 'Test users',
    'Authorized JavaScript origins', 'gmail.local.js', 'client secret',
    'never written to', 'revoke']) {
    assert.ok(doc.includes(needle.toLowerCase()), 'doc should mention: ' + needle);
  }
});

// FLOW 23: tasks — due dates, overdue detection, split filter, purity
flow('tasks: withTaskDue/clearTaskDue are pure, taskState labels, applySplit("tasks")', () => {
  const day = 24 * 3600000;
  const now = 1700000000000; // fixed clock: Tue Nov 14 2023
  const inbox = [{ id: 'a' }, { id: 'b' }];
  const withDue = T.withTaskDue(inbox, 'a', now + day);
  assert.strictEqual(inbox[0].taskDue, undefined, 'input untouched');
  assert.strictEqual(T.taskState({}), null, 'no due -> null');
  const st = T.taskState(withDue[0], now);
  assert.ok(st && !st.overdue && st.label === 'due tomorrow', 'label: ' + (st && st.label));
  assert.strictEqual(T.taskState({ taskDue: now - day }, now).label, 'overdue');
  assert.strictEqual(T.taskState({ taskDue: now - day }, now).overdue, true);
  assert.strictEqual(T.taskState({ taskDue: now + 3600000 }, now).label, 'due today');
  assert.strictEqual(T.taskCount(withDue), 1);
  const only = T.applySplit(withDue, 'tasks');
  assert.deepStrictEqual(only.map((e) => e.id), ['a'], 'tasks split isolates');
  const cleared = T.clearTaskDue(withDue, 'a');
  assert.strictEqual(T.taskState(cleared[0]), null, 'cleared');
  assert.strictEqual(T.taskCount(cleared), 0);
});

// FLOW 24: sender bundles — address variants group together
flow('sender bundles: emailsFromSender groups "Jane <j@x.com>" with "j@x.com"', () => {
  const inbox = [
    { id: 'm1', from: 'Jane Doe <jane@x.com>' },
    { id: 'm2', from: 'jane@x.com' },
    { id: 'm3', from: 'Bob <bob@y.com>' }
  ];
  const bundle = T.emailsFromSender(inbox, 'Jane <jane@x.com>');
  assert.deepStrictEqual(bundle.map((e) => e.id), ['m1', 'm2']);
  assert.deepStrictEqual(T.emailsFromSender(inbox, '').length, 0, 'empty sender -> empty bundle');
  assert.deepStrictEqual(T.emailsFromSender(inbox, 'nobody@z.test').length, 0, 'unknown sender -> empty bundle');
});

// FLOW 25: snippets — add/replace/remove are pure, applySnippet appends
flow('snippets: add/replace/remove are pure; applySnippet fills or appends', () => {
  let s = T.addSnippet([], 'Urgent apology', 'I am very sorry about this.');
  assert.strictEqual(s.length, 1);
  s = T.addSnippet(s, 'urgent APOLOGY', 'Replaced text.'); // same name, new case -> replace
  assert.strictEqual(s.length, 1, 'replaces same-name snippet');
  assert.strictEqual(s[0].text, 'Replaced text.');
  s = T.addSnippet(s, '', 'nope');
  s = T.addSnippet(s, 'blank', '');
  assert.strictEqual(s.length, 1, 'empty name/text ignored');
  assert.strictEqual(T.applySnippet('', 'Hello'), 'Hello', 'empty draft -> snippet');
  assert.strictEqual(T.applySnippet('  \n ', 'Hello'), 'Hello', 'whitespace draft -> snippet');
  assert.strictEqual(T.applySnippet('Hi there', 'Bye'), 'Hi there\n\nBye', 'appends with blank line');
  s = T.removeSnippet(s, 'URGENT APOLOGY');
  assert.strictEqual(s.length, 0, 'case-insensitive remove');
});

(async () => {
  for (const [name, fn] of queue) {
    await fn();
    n++;
    console.log('ok   - ' + name);
  }
  console.log('\ne2e: ' + n + ' flows passed');
})().catch((err) => { console.error(err); process.exit(1); });
EOF
