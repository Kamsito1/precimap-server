#!/bin/bash
# MapaTacaño v4.0.0 — API Health Check
BASE="https://web-production-a8023.up.railway.app"
PASS=0; FAIL=0

check() {
  local name="$1" url="$2" expect="$3"
  local resp=$(curl -s -m 10 "$url" 2>&1)
  if echo "$resp" | grep -q "$expect"; then
    echo "  ✅ $name"
    PASS=$((PASS+1))
  else
    echo "  ❌ $name — expected '$expect', got: ${resp:0:80}"
    FAIL=$((FAIL+1))
  fi
}

echo "🧪 MapaTacaño API Tests"
echo "========================"
echo ""

# Health
check "Health" "$BASE/api/health" "4.0.0"

# Version
check "Version" "$BASE/api/version" "4.0.0"

# Gas stats (may need warm-up after deploy)
resp=$(curl -s -m 15 "$BASE/api/gasolineras/stats")
if echo "$resp" | grep -q "g95"; then echo "  ✅ Gas stats"; PASS=$((PASS+1)); 
else 
  sleep 5; resp=$(curl -s -m 15 "$BASE/api/gasolineras/stats")
  if echo "$resp" | grep -q "g95"; then echo "  ✅ Gas stats (warm-up)"; PASS=$((PASS+1)); 
  else echo "  ❌ Gas stats"; FAIL=$((FAIL+1)); fi
fi

# Deals
check "Deals list" "$BASE/api/deals?limit=1" "title"

# Places
check "Places list" "$BASE/api/places?limit=1" "name"

# Events
check "Events list" "$BASE/api/events?limit=1" "title"

# Auth protection
resp=$(curl -s -X POST "$BASE/api/deals/1/report-scam" -H 'Content-Type: application/json' -d '{}')
if echo "$resp" | grep -q "No autenticado"; then echo "  ✅ Auth: deals report"; PASS=$((PASS+1)); else echo "  ❌ Auth: deals report"; FAIL=$((FAIL+1)); fi

resp=$(curl -s -X POST "$BASE/api/deals" -H 'Content-Type: application/json' -d '{"title":"t"}')
if echo "$resp" | grep -q "No autenticado"; then echo "  ✅ Auth: create deal"; PASS=$((PASS+1)); else echo "  ❌ Auth: create deal"; FAIL=$((FAIL+1)); fi

# New categories (empty array is valid)
check "Places: peluqueria" "$BASE/api/places?cat=peluqueria&limit=1" "id\|\\[\\]"
check "Places: veterinario" "$BASE/api/places?cat=veterinario&limit=1" "id\|\\[\\]"
check "Places: pelu canina" "$BASE/api/places?cat=peluqueria_canina&limit=1" "id\|\\[\\]"
check "Places: bar" "$BASE/api/places?cat=bar&limit=1" "id\|\\[\\]"

# Privacy page
check "Privacy page" "$BASE/privacy" "MapaTacaño"

# Share pages
check "Share deal page" "$BASE/chollo/197" "og:title"
check "Share event page" "$BASE/evento/1" "og:title"

echo ""
echo "========================"
echo "Results: $PASS passed, $FAIL failed"
