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

  /** Cycle a label one step: urgent -> reply -> fyi -> spam -> urgent. */
  function nextCategory(cat) {
    var i = CATEGORIES.indexOf(cat);
    return CATEGORIES[(i + 1) % CATEGORIES.length];
  }

  /** One-line plain-text digest of an inbox, for copying elsewhere. */
  function digestText(emails) {
    var counts = { urgent: 0, reply: 0, fyi: 0, spam: 0 };
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

  return {
    classify: classify,
    draftReply: draftReply,
    filterEmails: filterEmails,
    nextCategory: nextCategory,
    digestText: digestText,
    CATEGORIES: CATEGORIES,
    LABELS: LABELS
  };
});
