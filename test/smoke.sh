#!/usr/bin/env bash
# triagepilot-ai smoke tests — fast sanity checks. Exit non-zero on failure.
set -euo pipefail
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "ok   - $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL - $1"; }

# 1-6: required files exist
for f in index.html css/style.css js/classifier.js js/app.js data/samples.json README.md; do
  if [ -f "$f" ]; then ok "file exists: $f"; else bad "missing file: $f"; fi
done

# 7-8: JS syntax valid
for f in js/classifier.js js/app.js; do
  if node --check "$f" >/dev/null 2>&1; then ok "syntax valid: $f"; else bad "syntax error: $f"; fi
done

# 9: samples.json is valid JSON with 10 entries
if node -e "const s=require('./data/samples.json'); if(!Array.isArray(s)||s.length!==10) process.exit(1)" 2>/dev/null; then
  ok "samples.json: valid JSON with 10 emails"
else
  bad "samples.json: must be valid JSON with exactly 10 emails"
fi

# 10: classifier loads in node
if node -e "const T=require('./js/classifier.js'); if(typeof T.classify!=='function'||typeof T.draftReply!=='function') process.exit(1)" 2>/dev/null; then
  ok "classifier loads in node with classify + draftReply"
else
  bad "classifier failed to load in node"
fi

# 11: every sample gets a valid category
if node -e "
const T=require('./js/classifier.js');
const s=require('./data/samples.json');
const cats=new Set(T.CATEGORIES);
for(const e of s){ const r=T.classify(e.subject,e.body); if(!cats.has(r.category)) process.exit(1); }
" 2>/dev/null; then
  ok "every sample email gets a valid category"
else
  bad "some sample email got an invalid category"
fi

# 12-14: key samples classified as expected
check_expected() {
  node -e "
const T=require('./js/classifier.js');
const s=require('./data/samples.json');
const e=s.find(x=>x.id==='$1');
if(!e||T.classify(e.subject,e.body).category!=='$2') process.exit(1);
" 2>/dev/null
}
if check_expected e1 urgent; then ok "burst-pipe email -> urgent"; else bad "burst-pipe email not urgent"; fi
if check_expected e6 spam;   then ok "crypto email -> spam";       else bad "crypto email not spam"; fi
if check_expected e3 reply;  then ok "quote request -> needs reply"; else bad "quote request misclassified"; fi

# 15: draftReply works for every category x both tones
if node -e "
const T=require('./js/classifier.js');
for(const c of T.CATEGORIES) for(const t of ['professional','friendly']){
  const d=T.draftReply({from:'A B <a@b.com>',subject:'s',body:'b',category:c},t,'Biz');
  if(typeof d!=='string'||d.length<20) process.exit(1);
}
" 2>/dev/null; then
  ok "draftReply returns usable drafts for all categories x tones"
else
  bad "draftReply failed for some category/tone"
fi

# 16: confidence is always high|medium|low
if node -e "
const T=require('./js/classifier.js');
const s=require('./data/samples.json');
for(const e of s){ const r=T.classify(e.subject,e.body); if(!/^(high|medium|low)$/.test(r.confidence)) process.exit(1); }
" 2>/dev/null; then
  ok "confidence is always high/medium/low"
else
  bad "confidence value out of range"
fi

# 17: new classifier API (filterEmails, nextCategory, digestText)
if node -e "
const T=require('./js/classifier.js');
['filterEmails','nextCategory','digestText'].forEach(f=>{if(typeof T[f]!=='function')process.exit(1)});
" 2>/dev/null; then
  ok "classifier exports filterEmails + nextCategory + digestText"
else
  bad "classifier missing new API"
fi

# 18: filterEmails — query + category combos over the sample inbox
if node -e "
const T=require('./js/classifier.js');
const s=require('./data/samples.json').map(e=>({id:e.id,from:e.from,subject:e.subject,body:e.body,category:T.classify(e.subject,e.body).category}));
const q=T.filterEmails(s,'flood','');
if(!q.length||!q.every(e=>(e.subject+e.body).toLowerCase().includes('flood')))process.exit(1);
const spam=T.filterEmails(s,'','spam');
if(spam.length<1||!spam.every(e=>e.category==='spam'))process.exit(1);
const combo=T.filterEmails(s,'quote','reply');
if(combo.length!==1||combo[0].id!=='e3')process.exit(1);
if(T.filterEmails(s,'','').length!==10)process.exit(1);
if(T.filterEmails(s,'zzz-no-match','').length!==0)process.exit(1);
" 2>/dev/null; then
  ok "filterEmails narrows by query, category, and both"
else
  bad "filterEmails broken"
fi

# 19: nextCategory cycles urgent->reply->fyi->spam->urgent
if node -e "
const T=require('./js/classifier.js');
const seq=['urgent','reply','fyi','spam']; let c='urgent';
for(const want of ['reply','fyi','spam','urgent']){ c=T.nextCategory(c); if(c!==want)process.exit(1); }
if(T.nextCategory('bogus')!=='urgent')process.exit(1);
" 2>/dev/null; then
  ok "nextCategory cycles labels for manual correction"
else
  bad "nextCategory cycle broken"
fi

# 20: digestText summarizes counts + lists action items
if node -e "
const T=require('./js/classifier.js');
const s=require('./data/samples.json').map(e=>({from:e.from,subject:e.subject,category:T.classify(e.subject,e.body).category}));
const d=T.digestText(s);
if(!/^10 emails triaged: \d+ urgent, \d+ need reply, \d+ FYI, \d+ spam\$/.test(d.split('\n')[0]))process.exit(1);
if(!d.includes('[Urgent]'))process.exit(1);
" 2>/dev/null; then
  ok "digestText renders countable one-line summary"
else
  bad "digestText broken"
fi

# 21: UI wiring — search, clear-spam, persistence, correction hooks
missing=""
for id in searchBox clearSpam; do grep -q "id=\"$id\"" index.html || missing="$missing #$id"; done
for n in saveState loadState filterCat nextCategory clearSpam searchBox digestText; do
  grep -q "$n" js/app.js || missing="$missing $n"
done
if [ -z "$missing" ]; then ok "app.js wires search/filter/persistence/correction UI"; else bad "missing wiring:$missing"; fi

echo ""
echo "smoke: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
