#!/bin/bash
# MapaTacaño — Server Monitor
# Usage: bash monitor.sh
# Run periodically to check server health

BASE="https://web-production-a8023.up.railway.app"
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "╔═══════════════════════════════════╗"
echo "║  MapaTacaño Server Monitor       ║"
echo "╚═══════════════════════════════════╝"
echo ""

# Health
health=$(curl -s -m 10 "$BASE/api/health")
version=$(echo "$health" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','?'))" 2>/dev/null)
stations=$(echo "$health" | python3 -c "import sys,json; print(json.load(sys.stdin).get('stations',0))" 2>/dev/null)

if [ "$version" = "4.0.0" ]; then
  echo -e "  ${GREEN}✅${NC} Server: v$version | $stations stations"
else
  echo -e "  ${RED}❌${NC} Server: v$version (expected 4.0.0)"
fi

# Stats
stats=$(curl -s -m 10 "$BASE/api/stats")
places=$(echo "$stats" | python3 -c "import sys,json; print(json.load(sys.stdin).get('places',0))" 2>/dev/null)
deals=$(echo "$stats" | python3 -c "import sys,json; print(json.load(sys.stdin).get('deals',0))" 2>/dev/null)
events=$(echo "$stats" | python3 -c "import sys,json; print(json.load(sys.stdin).get('events',0))" 2>/dev/null)
users=$(echo "$stats" | python3 -c "import sys,json; print(json.load(sys.stdin).get('users',0))" 2>/dev/null)
echo "  📊 Places: $places | Deals: $deals | Events: $events | Users: $users"

# G95
g95=$(echo "$stats" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{d[\"gas_stats\"][\"g95\"][\"min\"]}€')" 2>/dev/null)
echo "  ⛽ G95 min: $g95"

# Response time
ms=$(curl -s -o /dev/null -w "%{time_total}" "$BASE/api/health" | python3 -c "import sys; print(int(float(sys.stdin.read())*1000))")
if [ "$ms" -lt 1000 ]; then
  echo -e "  ${GREEN}✅${NC} Response: ${ms}ms"
else
  echo -e "  ${RED}⚠️${NC}  Response: ${ms}ms (slow)"
fi

# Helmet
helmet=$(curl -sI "$BASE/api/health" | grep -c "x-content-type-options")
if [ "$helmet" -gt 0 ]; then
  echo -e "  ${GREEN}✅${NC} Helmet: active"
else
  echo -e "  ${RED}❌${NC} Helmet: missing"
fi

echo ""
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
