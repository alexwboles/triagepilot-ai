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

echo ""
echo "smoke: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
