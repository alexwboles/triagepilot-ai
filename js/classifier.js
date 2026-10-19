/* triagepilot-ai — local email triage + reply drafting.
 * Works in the browser (window.TriagePilot) and in Node (module.exports).
 * No network, no API keys required. Pure heuristics + templates.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.TriagePilot = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CATEGORIES = ['urgent', 'reply', 'fyi', 'spam'];

  var LABELS = {
    urgent: 'Urgent',
    reply: 'Needs reply',
    fyi: 'FYI',
    spam: 'Spam'
  };

  // Each rule: regex, weight, plain-language label shown to the owner.
  var RULES = {
    spam: [
      { re: /crypto|bitcoin|forex|binary options|investment opportunity/i, w: 3, label: "mentions crypto/investment schemes" },
      { re: /viagra|cialis|pharmacy|weight loss miracle/i, w: 3, label: "looks like pharmacy spam" },
      { re: /lottery|inheritance|prince|beneficiary|claim your prize|you (have|ve) won/i, w: 3, label: "prize/inheritance scam pattern" },
      { re: /seo|guaranteed #1|first page of google|rank higher/i, w: 2, label: "unsolicited SEO pitch" },
      { re: /unsubscribe/i, w: 1, label: "bulk-mail footer (unsubscribe link)" },
      { re: /dear (friend|beneficiary)|hello dear/i, w: 2, label: "generic mass-mail greeting" },
      { re: /double your|make money fast|work from home.{0,20}\$\$\$?/i, w: 2, label: "get-rich-quick pitch" }
    ],
    urgent: [
      { re: /burst pipe|flood(ed|ing)?|water (everywhere|pouring|leak)/i, w: 3, label: "water damage / flooding" },
      { re: /no hot water|no heat|gas leak|carbon monoxide|electrical (fire|spark)/i, w: 3, label: "safety or essential-service outage" },
      { re: /emergency|asap|urgent|immediately|right away/i, w: 2, label: "marked urgent by sender" },
      { re: /angry|furious|disgusted|unacceptable|terrible service/i, w: 2, label: "angry customer language" },
      { re: /refund|chargeback|lawsuit|attorney|lawyer|better business bureau|bad review/i, w: 2, label: "mentions refund, dispute or legal threat" },
      { re: /cancel (my|the).{0,20}(order|service|contract|appointment)/i, w: 2, label: "cancellation request" },
      { re: /today|within (the )?hour|deadline/i, w: 1, label: "same-day time pressure" },
      { re: /broken|not working|stopped working/i, w: 1, label: "something broken" }
    ],
    reply: [
      { re: /how much|what.{0,10}cost|price|cost of|quote|estimate/i, w: 2, label: "asks about pricing" },
      { re: /book|schedule|appointment|availability|come (out|by)/i, w: 2, label: "wants to book or schedule" },
      { re: /invoice|bill|payment|charged|overcharg/i, w: 2, label: "billing or payment question" },
      { re: /warranty|guarantee/i, w: 1, label: "warranty question" },
      { re: /do you (offer|do|provide|service)|are you able to/i, w: 1, label: "asks about services" },
      { re: /question|wondering|can you (tell|explain|confirm)/i, w: 1, label: "asks a question" }
    ],
    fyi: [
      { re: /newsletter/i, w: 2, label: "newsletter" },
      { re: /thank you|thanks (so much|a lot)|great job|five stars/i, w: 2, label: "thank-you note" },
      { re: /receipt|payment received|payment confirmation|order confirmation/i, w: 2, label: "receipt or confirmation" },
      { re: /reminder:/i, w: 1, label: "reminder notice" },
      { re: /price (increase|update)|new catalog|supplier update/i, w: 2, label: "supplier update" },
      { re: /out of office|ooo/i, w: 2, label: "out-of-office auto-reply" }
    ]
  };

  function scoreText(text) {
    var score = { urgent: 0, reply: 0, fyi: 0, spam: 0 };
    var reasons = { urgent: [], reply: [], fyi: [], spam: [] };
    CATEGORIES.forEach(function (cat) {
      RULES[cat].forEach(function (rule) {
        if (rule.re.test(text)) {
          score[cat] += rule.w;
          reasons[cat].push(rule.label);
        }
      });
    });
    // Learned rules: user corrections teach the classifier local keywords.
    CATEGORIES.forEach(function (cat) {
      var words = learnedRules[cat] || [];
      if (!words.length) return;
      var hits = [];
      words.forEach(function (w) {
        if (text.indexOf(w) !== -1 && hits.indexOf(w) === -1) hits.push(w);
      });
      if (hits.length) {
        score[cat] += Math.min(4, hits.length * 2);
        reasons[cat].push('learned from your corrections ("' + hits.slice(0, 3).join('", "') + '")');
      }
    });
    return { score: score, reasons: reasons };
  }

  function classify(subject, body) {
    var text = ((subject || '') + '\n' + (body || '')).toLowerCase();
    var out = scoreText(text);
    var score = out.score;
    var reasons = out.reasons;

    if (/\?/.test(body || '')) {
      score.reply += 1;
      reasons.reply.push('contains a direct question');
    }
    var links = text.match(/https?:\/\//g) || [];
    if (links.length >= 3) {
      score.spam += 2;
      reasons.spam.push('contains many links (' + links.length + ')');
    }

    var category;
    if (score.spam >= 3 && score.spam >= score.urgent && score.spam >= score.reply) {
      category = 'spam';
    } else {
      // Priority order breaks ties: urgent > reply > fyi
      var order = ['urgent', 'reply', 'fyi'];
      category = 'fyi';
      var best = -1;
      order.forEach(function (c) {
        if (score[c] > best) { best = score[c]; category = c; }
      });
      if (best <= 0) {
        // No strong signal: default to "needs reply" so nothing slips through.
        category = 'reply';
        reasons.reply.push('no strong signals — defaulted to needs-reply so it is not missed');
      }
    }

    var ranked = CATEGORIES.slice().sort(function (a, b) { return score[b] - score[a]; });
    var margin = score[ranked[0]] - score[ranked[1]];
    var confidence = 'low';
    if (score[category] >= 3 && margin >= 2) confidence = 'high';
    else if (score[category] >= 2 || margin >= 1) confidence = 'medium';

    var whyList = reasons[category].slice(0, 3);
    var reason = whyList.length
      ? 'Flagged as ' + LABELS[category] + ' because: ' + whyList.join('; ') + '.'
      : 'Flagged as ' + LABELS[category] + ' (no strong signals).';

    return {
      category: category,
      label: LABELS[category],
      confidence: confidence,
      reason: reason,
      scores: score
    };
  }

  function firstName(from) {
    var m = /^([^<@]+)/.exec(from || '');
    if (!m) return 'there';
    var name = m[1].trim().split(/\s+/)[0];
    return name || 'there';
  }

  function firstSentence(body) {
    var m = /[^.!?\n]{10,120}[.!?]?/.exec((body || '').trim());
    return m ? m[0].trim() : 'your message';
  }

  var TEMPLATES = {
    urgent: {
      professional: function (ctx) {
        return 'Hi ' + ctx.name + ',\n\n' +
          "I'm very sorry to hear about this — I understand it's urgent and I'm treating it as a priority.\n\n" +
          'Regarding: "' + ctx.issue + '"\n\n' +
          "Here's what happens next: I'll review this personally today and get back to you with a concrete plan and timeline.\n\n" +
          'Could you reply with any photos or extra details (when it started, what you\'ve tried so far)? That will help me act faster.\n\n' +
          'Thank you for flagging this so quickly,\n' + ctx.business;
      },
      friendly: function (ctx) {
        return 'Hi ' + ctx.name + ',\n\n' +
          "Oh no — I'm really sorry you're dealing with this. I can see it's urgent, so I'm bumping it straight to the top of my list.\n\n" +
          'About: "' + ctx.issue + '"\n\n' +
          "I'll take a personal look today and follow up with a plan and timeline. If you have any photos or extra details, send them over — the more I know, the faster I can help.\n\n" +
          'Thanks for letting me know right away,\n' + ctx.business;
      }
    },
    reply: {
      professional: function (ctx) {
        return 'Hi ' + ctx.name + ',\n\n' +
          'Thanks for getting in touch.\n\n' +
          'Regarding: "' + ctx.issue + '"\n\n' +
          "Here's my answer: [add your specific answer here — e.g. pricing, availability, or next steps].\n\n" +
          'If that works for you, just reply and we\'ll get it scheduled. Happy to answer any follow-up questions.\n\n' +
          'Best regards,\n' + ctx.business;
      },
      friendly: function (ctx) {
        return 'Hi ' + ctx.name + ',\n\n' +
          'Thanks for reaching out — great question!\n\n' +
          'About: "' + ctx.issue + '"\n\n' +
          "Here's the scoop: [add your specific answer here — e.g. pricing, availability, or next steps].\n\n" +
          "Just hit reply if you'd like to move forward or have any other questions. Happy to help!\n\n" +
          'Cheers,\n' + ctx.business;
      }
    },
    fyi: {
      professional: function (ctx) {
        return 'Hi ' + ctx.name + ',\n\n' +
          'Thanks for the update — noted.\n\n' +
          'I\'ll keep this on file and follow up if anything is needed on my end.\n\n' +
          'Best regards,\n' + ctx.business;
      },
      friendly: function (ctx) {
        return 'Hi ' + ctx.name + ',\n\n' +
          'Got it — thanks for sending this over!\n\n' +
          "I'll keep it on file and ping you if I need anything.\n\n" +
          'Cheers,\n' + ctx.business;
      }
    },
    spam: {
      professional: function () {
        return '[No reply needed — this looks like spam. Suggested action: delete or report as spam.]';
      },
      friendly: function () {
        return '[No reply needed — this looks like spam. Suggested action: delete or report as spam.]';
      }
    }
  };

  function draftReply(email, tone, business) {
    var t = (tone === 'friendly') ? 'friendly' : 'professional';
    var cat = (email && email.category) || 'reply';
    if (CATEGORIES.indexOf(cat) === -1) cat = 'reply';
    var ctx = {
      name: firstName(email ? email.from : ''),
      issue: firstSentence(email ? email.body : ''),
      business: business || 'Your Business'
    };
    return TEMPLATES[cat][t](ctx);
  }

  /**
   * Filter an inbox by free-text query and/or category.
   * Pure — used by the UI and the Node tests.
   */
  function filterEmails(emails, query, category) {
    var q = String(query || '').trim().toLowerCase();
    return (emails || []).filter(function (e) {
      if (category && e.category !== category) return false;
      if (!q) return true;
      return ((e.subject || '') + ' ' + (e.from || '') + ' ' + (e.body || ''))
        .toLowerCase().indexOf(q) !== -1;
    });
  }

  /** Superhuman-style split-inbox filter: '' (all awake), focus (urgent+reply),
      fyi, spam, or snoozed (only sleeping emails). */
  function applySplit(emails, split) {
    var list = emails || [];
    if (split === 'snoozed') {
      return list.filter(function (e) { return !isAwake(e); });
    }
    var awake = list.filter(function (e) { return isAwake(e); });
    if (split === 'focus') {
      return awake.filter(function (e) { return e.category === 'urgent' || e.category === 'reply'; });
    }
    if (split === 'fyi' || split === 'spam') {
      return awake.filter(function (e) { return e.category === split; });
    }
    return awake;
  }

  /** Cycle a label one step: urgent -> reply -> fyi -> spam -> urgent. */
  function nextCategory(cat) {
    var i = CATEGORIES.indexOf(cat);
    return CATEGORIES[(i + 1) % CATEGORIES.length];
  }

  // ---------------------------------------------------------------------------
  // Learned rules: manual corrections teach the classifier owner-specific
  // keywords. Kept in memory here; the UI persists them in localStorage.
  // ---------------------------------------------------------------------------
  var learnedRules = { urgent: [], reply: [], fyi: [], spam: [] };

  var LEARN_STOP = ('the and for are with you your this that have has was were from ' +
    'they them then than there their what when where which would could should ' +
    'email mail hello thanks thank please just about into over under more most ' +
    'will can our out any all one two new get got need needs want wants like ' +
    'also after before very much many some such only own same other than too')
    .split(' ');

  function setLearnedRules(rules) {
    CATEGORIES.forEach(function (cat) {
      var list = rules && rules[cat];
      learnedRules[cat] = Array.isArray(list)
        ? list.filter(function (w) { return typeof w === 'string' && /^[a-z]{5,}$/.test(w); }).slice(0, 60)
        : [];
    });
  }

  function getLearnedRules() {
    var copy = {};
    CATEGORIES.forEach(function (cat) { copy[cat] = learnedRules[cat].slice(); });
    return copy;
  }

  function resetLearnedRules() { setLearnedRules(null); }

  function tokenizeWords(text) {
    var m = String(text || '').toLowerCase().match(/[a-z]{5,}/g) || [];
    var seen = {};
    return m.filter(function (w) { return seen[w] ? false : (seen[w] = true); });
  }

  /**
   * Learn from a manual correction: harvest distinctive words from the email
   * that do NOT already trigger a built-in rule for the corrected category,
   * and remember them as keywords for that category. Returns the new words.
   */
  function learnCorrection(category, subject, body) {
    if (CATEGORIES.indexOf(category) === -1) return [];
    var words = tokenizeWords((subject || '') + ' ' + (body || ''));
    var existing = RULES[category];
    var fresh = words.filter(function (w) {
      if (LEARN_STOP.indexOf(w) !== -1) return false;
      if (learnedRules[category].indexOf(w) !== -1) return false;
      // skip words that already fire a built-in rule for this category
      for (var i = 0; i < existing.length; i++) {
        if (existing[i].re.test(w)) return false;
      }
      return true;
    }).slice(0, 8);
    fresh.forEach(function (w) {
      if (learnedRules[category].length < 60) learnedRules[category].push(w);
    });
    return fresh;
  }

  /** One-line plain-text digest of an inbox, for copying elsewhere. */
  function digestText(emails) {    var counts = { urgent: 0, reply: 0, fyi: 0, spam: 0 };
    (emails || []).forEach(function (e) {
      if (counts[e.category] !== undefined) counts[e.category]++;
    });
    var total = (emails || []).length;
    var lines = [total + ' emails triaged: ' + counts.urgent + ' urgent, ' +
      counts.reply + ' need reply, ' + counts.fyi + ' FYI, ' + counts.spam + ' spam'];
    (emails || []).forEach(function (e) {
      if (e.category === 'urgent' || e.category === 'reply') {
        lines.push('- [' + LABELS[e.category] + '] ' + (e.subject || '(no subject)') +
          ' — ' + firstName(e.from));
      }
    });
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Snooze: hide an email until a timestamp (pure helpers; the UI stores stamps)
  // ---------------------------------------------------------------------------

  /** True when the email was never snoozed or its snooze has passed. */
  function isAwake(email, now) {
    var t = Number((email && email.snoozedUntil) || 0);
    return !t || t <= (now == null ? Date.now() : now);
  }

  /** Emails whose snooze has passed (or was never set). Pure. */
  function visibleEmails(emails, now) {
    return (emails || []).filter(function (e) { return isAwake(e, now); });
  }

  /** Remaining snooze as a short string ("25m", "3h", "2d"), or "" when awake. */
  function snoozeRemaining(email, now) {
    var ms = Number((email && email.snoozedUntil) || 0) - (now == null ? Date.now() : now);
    if (ms <= 0) return '';
    var m = Math.round(ms / 60000);
    if (m < 60) return m + 'm';
    var h = Math.round(m / 60);
    if (h < 48) return h + 'h';
    return Math.round(h / 24) + 'd';
  }

  // ---------------------------------------------------------------------------
  // Sender lists: personal blocklist / trustlist keyed by address (or domain).
  // Blocked senders always file as spam; trusted senders can never file as spam.
  // ---------------------------------------------------------------------------
  var senderLists = { blocked: [], trusted: [] };

  /** Specific-to-general keys for a sender: full address first, then domain. */
  function senderKeys(from) {
    var m = /<([^>]+)>/.exec(String(from || ''));
    var addr = (m ? m[1] : String(from || '').split(/\s+/).pop()).trim().toLowerCase();
    var keys = [];
    var at = addr.indexOf('@');
    if (at !== -1) { keys.push(addr); keys.push(addr.slice(at + 1)); }
    else if (addr) { keys.push(addr); }
    return keys;
  }

  function setSenderLists(lists) {
    ['blocked', 'trusted'].forEach(function (k) {
      var l = lists && lists[k];
      senderLists[k] = Array.isArray(l)
        ? l.map(function (x) { return String(x).toLowerCase().trim(); }).filter(Boolean).slice(0, 200)
        : [];
    });
  }

  function getSenderLists() {
    return { blocked: senderLists.blocked.slice(), trusted: senderLists.trusted.slice() };
  }

  function resetSenderLists() { setSenderLists(null); }

  /** 'spam' | 'trust' | null for a sender string. Exact address wins over domain. */
  function senderAction(from) {
    var keys = senderKeys(from);
    for (var i = 0; i < keys.length; i++) {
      if (senderLists.blocked.indexOf(keys[i]) !== -1) return 'spam';
    }
    for (var j = 0; j < keys.length; j++) {
      if (senderLists.trusted.indexOf(keys[j]) !== -1) return 'trust';
    }
    return null;
  }

  /** Add a sender's address (or domain) to one list; keeps the lists exclusive. */
  function listSender(kind, from) {
    var key = senderKeys(from)[0] || '';
    if (!key) return null;
    var other = kind === 'blocked' ? 'trusted' : 'blocked';
    senderLists[other] = senderLists[other].filter(function (k) { return k !== key; });
    if (senderLists[kind].indexOf(key) === -1) senderLists[kind].push(key);
    return key;
  }

  /** Remove a sender from both lists. */
  function unlistSender(from) {
    var key = senderKeys(from)[0] || '';
    ['blocked', 'trusted'].forEach(function (k) {
      senderLists[k] = senderLists[k].filter(function (x) { return x !== key; });
    });
    return key;
  }

  /** Classify with sender lists honored. Blocked → spam; trusted can never be spam.
   * Per-sender memory (the triager learns the category YOU assign to a
   * sender's mail) is honored next: it wins over the heuristic score, but
   * never resurrects a blocked sender out of spam, and a trusted sender
   * still can never be filed as spam by memory either.
   */
  function classifyWithSender(subject, body, from) {
    var r = classify(subject, body);
    var action = senderAction(from);
    if (action === 'spam') {
      return {
        category: 'spam', label: LABELS.spam, confidence: 'high',
        reason: 'Sender is on your blocklist — auto-filed as spam.', scores: r.scores
      };
    }
    var mem = memoryFor(from);
    if (mem && mem !== r.category) {
      if (mem === 'spam' && action === 'trust') {
        return {
          category: 'reply', label: LABELS.reply, confidence: 'medium',
          reason: 'Sender is on your trustlist — kept out of spam. ' + r.reason, scores: r.scores
        };
      }
      return {
        category: mem, label: LABELS[mem], confidence: 'medium',
        reason: 'Filed as ' + LABELS[mem] + ' — you usually file mail from this sender as ' +
          LABELS[mem] + '. ' + r.reason,
        scores: r.scores
      };
    }
    if (action === 'trust' && r.category === 'spam') {
      r = {
        category: 'reply', label: LABELS.reply, confidence: 'medium',
        reason: 'Sender is on your trustlist — kept out of spam. ' + r.reason, scores: r.scores
      };
    }
    return r;
  }

  // ---------------------------------------------------------------------------
  // Per-sender memory: the triager learns from YOUR corrections. When you
  // relabel an email, the sender's address is remembered with the category
  // you chose, so future mail from that sender files the same way.
  // ---------------------------------------------------------------------------
  var senderMemory = {};

  /** The remembered category for a sender string, or null. */
  function memoryFor(from) {
    var key = senderKeys(from)[0] || '';
    return senderMemory[key] || null;
  }

  /**
   * Remember that the user files this sender's mail as `category`.
   * Returns the stored key, or null when the category/address is invalid.
   */
  function rememberSender(category, from) {
    if (CATEGORIES.indexOf(category) === -1) return null;
    var key = senderKeys(from)[0] || '';
    if (!key) return null;
    senderMemory[key] = category;
    return key;
  }

  function setSenderMemory(map) {
    senderMemory = {};
    if (map && typeof map === 'object') {
      Object.keys(map).forEach(function (k) {
        if (CATEGORIES.indexOf(map[k]) !== -1 && typeof k === 'string' && k) {
          senderMemory[k.toLowerCase()] = map[k];
        }
      });
    }
  }

  function getSenderMemory() {
    var copy = {};
    Object.keys(senderMemory).forEach(function (k) { copy[k] = senderMemory[k]; });
    return copy;
  }

  function resetSenderMemory() { senderMemory = {}; }

  // ---------------------------------------------------------------------------
  // Sent tracking: which emails the user actually replied to (the "loop"
  // closer — a sent reply resolves the email).
  // ---------------------------------------------------------------------------

  /**
   * Pure: mark one email as replied. Sets sentAt and handled=true.
   * Returns a NEW array; the input is untouched.
   */
  function markSent(emails, id, now) {
    var ts = now == null ? Date.now() : now;
    return (emails || []).map(function (e) {
      if (e.id !== id) return e;
      var c = {};
      for (var k in e) c[k] = e[k];
      c.handled = true;
      c.sentAt = ts;
      return c;
    });
  }

  /** How many emails in the inbox have a reply sent. */
  function sentCount(emails) {
    return (emails || []).filter(function (e) { return !!e.sentAt; }).length;
  }

  // ---------------------------------------------------------------------------
  // Bulk operations (pure; the UI applies them to state)
  // ---------------------------------------------------------------------------

  function idSet(ids) {
    var set = {};
    (ids || []).forEach(function (i) { set[i] = true; });
    return set;
  }

  function bulkRemove(emails, ids) {
    var set = idSet(ids);
    return (emails || []).filter(function (e) { return !set[e.id]; });
  }

  function bulkSetHandled(emails, ids, handled) {
    var set = idSet(ids);
    return (emails || []).map(function (e) {
      if (!set[e.id]) return e;
      var c = {};
      for (var k in e) c[k] = e[k];
      c.handled = !!handled;
      return c;
    });
  }

  function bulkRelabel(emails, ids, category) {
    if (CATEGORIES.indexOf(category) === -1) return emails;
    var set = idSet(ids);
    return (emails || []).map(function (e) {
      if (!set[e.id]) return e;
      var c = {};
      for (var k in e) c[k] = e[k];
      c.category = category;
      c.label = LABELS[category];
      c.reason = 'Bulk-labeled ' + LABELS[category] + ' by you.';
      c.confidence = 'high';
      return c;
    });
  }

  return {
    classify: classify,
    draftReply: draftReply,
    filterEmails: filterEmails,
    applySplit: applySplit,
    nextCategory: nextCategory,
    digestText: digestText,
    learnCorrection: learnCorrection,
    setLearnedRules: setLearnedRules,
    getLearnedRules: getLearnedRules,
    resetLearnedRules: resetLearnedRules,
    isAwake: isAwake,
    visibleEmails: visibleEmails,
    snoozeRemaining: snoozeRemaining,
    senderAction: senderAction,
    listSender: listSender,
    unlistSender: unlistSender,
    setSenderLists: setSenderLists,
    getSenderLists: getSenderLists,
    resetSenderLists: resetSenderLists,
    memoryFor: memoryFor,
    rememberSender: rememberSender,
    setSenderMemory: setSenderMemory,
    getSenderMemory: getSenderMemory,
    resetSenderMemory: resetSenderMemory,
    classifyWithSender: classifyWithSender,
    markSent: markSent,
    sentCount: sentCount,
    bulkRemove: bulkRemove,
    bulkSetHandled: bulkSetHandled,
    bulkRelabel: bulkRelabel,
    CATEGORIES: CATEGORIES,
    LABELS: LABELS
  };
});
