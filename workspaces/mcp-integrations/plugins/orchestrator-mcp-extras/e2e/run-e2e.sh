#!/usr/bin/env bash
# End-to-End tests for orchestrator-mcp-extras plugin
# Tests the full MCP protocol flow against a live RHDH + Orchestrator deployment on OCP
#
# Prerequisites:
#   - oc CLI logged into the target OCP cluster
#   - RHDH deployed with orchestrator-backend, mcp-actions-backend, and orchestrator-mcp-extras plugins
#   - backend.actions.pluginSources configured to include 'orchestrator-mcp-extras'
#   - A SonataFlow workflow (e.g. "greeting") deployed and reachable
#
# Usage:
#   ./e2e/run-e2e.sh [--namespace <ns>] [--workflow <id>]
#
# Environment variables (override defaults):
#   RHDH_NAMESPACE   - OCP namespace where RHDH is deployed (default: orchestrator-mcp-e2e)
#   WORKFLOW_ID      - Workflow to execute in tests (default: greeting)
#   SKIP_EXECUTE     - Set to "true" to skip workflow execution tests

set -uo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
NAMESPACE="${RHDH_NAMESPACE:-orchestrator-mcp-e2e}"
WORKFLOW="${WORKFLOW_ID:-greeting}"
DEPLOYMENT="backstage-backstage"
SECRET_NAME="backstage-backend-auth-secret"
MCP_ENDPOINT="/api/mcp-actions/v1"
SKIP_EXECUTE="${SKIP_EXECUTE:-false}"

# ── Parse CLI flags ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --workflow)  WORKFLOW="$2"; shift 2 ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# ── Counters ──────────────────────────────────────────────────────────────────
PASS=0
FAIL=0
SKIP=0
TOTAL=0
FAILURES=()

# ── Helpers ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[INFO]${NC} $*"; }
pass() { ((PASS++)); ((TOTAL++)); echo -e "  ${GREEN}PASS${NC} $*"; }
fail() { ((FAIL++)); ((TOTAL++)); FAILURES+=("$1"); echo -e "  ${RED}FAIL${NC} $*"; }
skip() { ((SKIP++)); ((TOTAL++)); echo -e "  ${YELLOW}SKIP${NC} $*"; }

mcp_call() {
  local token="$1"
  local payload="$2"
  oc exec -n "$NAMESPACE" "deploy/$DEPLOYMENT" -- \
    curl -s --max-time 30 -X POST "http://localhost:7007${MCP_ENDPOINT}" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "$payload" 2>&1 | grep -v "^Defaulted container"
}

extract_data() {
  # Extract the JSON after "data: " from SSE response
  echo "$1" | grep "^data:" | sed 's/^data: //'
}

get_guest_token() {
  oc exec -n "$NAMESPACE" "deploy/$DEPLOYMENT" -- \
    curl -s -X POST "http://localhost:7007/api/auth/guest/refresh" \
    -H "Content-Type: application/json" 2>&1 \
    | grep -v "^Defaulted container" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['backstageIdentity']['token'])"
}

get_backend_secret() {
  oc get secret "$SECRET_NAME" -n "$NAMESPACE" -o jsonpath='{.data.BACKEND_SECRET}' | base64 -d
}

# ── Preflight ─────────────────────────────────────────────────────────────────
echo ""
echo "=============================================="
echo " Orchestrator MCP Extras - E2E Test Suite"
echo "=============================================="
echo ""
log "Namespace:  $NAMESPACE"
log "Workflow:   $WORKFLOW"
log "Deployment: $DEPLOYMENT"
echo ""

log "Preflight: checking oc connectivity..."
if ! oc whoami &>/dev/null; then
  echo "ERROR: Not logged into OCP. Run 'oc login' first."
  exit 1
fi

log "Preflight: checking deployment is ready..."
READY=$(oc get deploy "$DEPLOYMENT" -n "$NAMESPACE" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)
if [[ -z "$READY" ]] || [[ "$READY" -lt 1 ]]; then
  echo "ERROR: Deployment $DEPLOYMENT has 0 ready replicas in namespace $NAMESPACE"
  exit 1
fi

log "Preflight: obtaining authentication tokens..."
BACKEND_SECRET=$(get_backend_secret || true)
if [[ -z "$BACKEND_SECRET" ]]; then
  echo "ERROR: Could not retrieve backend secret from $SECRET_NAME"
  exit 1
fi

GUEST_TOKEN=$(get_guest_token || true)
if [[ -z "$GUEST_TOKEN" ]]; then
  echo "ERROR: Could not obtain guest user token (is guest auth enabled?)"
  exit 1
fi

log "Preflight: all checks passed"
echo ""

# ══════════════════════════════════════════════════════════════════════════════
# TEST GROUP 1: MCP Protocol
# ══════════════════════════════════════════════════════════════════════════════
echo "── Test Group 1: MCP Protocol ──────────────────"

# TC-E2E-001: MCP initialize handshake
log "TC-E2E-001: MCP initialize handshake"
RESPONSE=$(mcp_call "$BACKEND_SECRET" '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"e2e-test","version":"1.0.0"}}}')
DATA=$(extract_data "$RESPONSE")
if echo "$DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['result']['serverInfo']['name']=='backstage'" 2>/dev/null; then
  pass "TC-E2E-001: MCP server identifies as 'backstage'"
else
  fail "TC-E2E-001: MCP initialize handshake failed: $DATA"
fi

# TC-E2E-002: MCP tools/list returns all 3 tools
log "TC-E2E-002: MCP tools/list returns registered tools"
RESPONSE=$(mcp_call "$BACKEND_SECRET" '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
DATA=$(extract_data "$RESPONSE")
TOOL_COUNT=$(echo "$DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['result']['tools']))" 2>/dev/null || echo "0")
TOOL_NAMES=$(echo "$DATA" | python3 -c "
import sys,json
d=json.load(sys.stdin)
names=sorted([t['name'] for t in d['result']['tools']])
print(','.join(names))
" 2>/dev/null || echo "")

if [[ "$TOOL_COUNT" -ge 5 ]] && echo "$TOOL_NAMES" | grep -q "orchestrator-instance-get" && echo "$TOOL_NAMES" | grep -q "orchestrator-instances-list" && echo "$TOOL_NAMES" | grep -q "orchestrator-workflow-execute" && echo "$TOOL_NAMES" | grep -q "orchestrator-workflows-list" && echo "$TOOL_NAMES" | grep -q "orchestrator-workflow-get"; then
  pass "TC-E2E-002: tools/list returns all 5 orchestrator tools ($TOOL_COUNT total)"
else
  fail "TC-E2E-002: Expected 3+ tools, got $TOOL_COUNT. Names: $TOOL_NAMES"
fi

# TC-E2E-003: Each tool has required MCP fields
log "TC-E2E-003: Tool metadata completeness"
VALID=$(echo "$DATA" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for t in d['result']['tools']:
    assert 'name' in t, f'missing name in {t}'
    assert 'description' in t, f'missing description in {t}'
    assert 'inputSchema' in t, f'missing inputSchema in {t}'
    assert t['inputSchema'].get('type') == 'object', f'bad inputSchema type in {t[\"name\"]}'
print('ok')
" 2>/dev/null || echo "")

if [[ "$VALID" == "ok" ]]; then
  pass "TC-E2E-003: All tools have name, description, and valid inputSchema"
else
  fail "TC-E2E-003: Tool metadata validation failed"
fi

# TC-E2E-004: Invalid method returns error
log "TC-E2E-004: Invalid MCP method returns error"
RESPONSE=$(mcp_call "$BACKEND_SECRET" '{"jsonrpc":"2.0","id":99,"method":"nonexistent/method"}')
DATA=$(extract_data "$RESPONSE")
HAS_ERROR=$(echo "$DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if 'error' in d else 'no')" 2>/dev/null || echo "no")
if [[ "$HAS_ERROR" == "yes" ]]; then
  pass "TC-E2E-004: Invalid method correctly returns JSON-RPC error"
else
  fail "TC-E2E-004: Expected error response for invalid method"
fi

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# TEST GROUP 2: orchestrator-workflows-list
# ══════════════════════════════════════════════════════════════════════════════
echo "── Test Group 2: orchestrator-workflows-list ────"

# TC-E2E-010: List workflows returns results
log "TC-E2E-010: List workflows returns non-empty results"
RESPONSE=$(mcp_call "$GUEST_TOKEN" '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"orchestrator-workflows-list","arguments":{}}}')
DATA=$(extract_data "$RESPONSE")
LIST_TEXT=$(echo "$DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null || echo "")
LIST_JSON=$(echo "$LIST_TEXT" | sed 's/^```json//' | sed 's/^```//' | tr -d '\n')

WF_COUNT=$(echo "$LIST_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('workflows',[])))" 2>/dev/null || echo "0")
if [[ "$WF_COUNT" -ge 1 ]]; then
  pass "TC-E2E-010: List workflows returned $WF_COUNT workflow(s)"
else
  fail "TC-E2E-010: Expected at least 1 workflow, got $WF_COUNT"
fi

# TC-E2E-011: Target workflow is in the list
log "TC-E2E-011: Workflow '$WORKFLOW' appears in list"
HAS_WORKFLOW=$(echo "$LIST_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ids=[w['workflowId'] for w in d.get('workflows',[])]
print('yes' if '$WORKFLOW' in ids else 'no')
" 2>/dev/null || echo "no")

if [[ "$HAS_WORKFLOW" == "yes" ]]; then
  pass "TC-E2E-011: Workflow '$WORKFLOW' found in list"
else
  fail "TC-E2E-011: Workflow '$WORKFLOW' not found. Available: $(echo "$LIST_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print([w['workflowId'] for w in d.get('workflows',[])])" 2>/dev/null)"
fi

# TC-E2E-012: Workflow fields are populated
log "TC-E2E-012: Workflow overview fields are populated"
FIELDS_OK=$(echo "$LIST_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
wf = next((w for w in d.get('workflows',[]) if w['workflowId']=='$WORKFLOW'), None)
if not wf:
    print('missing')
else:
    assert 'workflowId' in wf and wf['workflowId'], 'empty workflowId'
    assert 'format' in wf and wf['format'], 'empty format'
    print('ok')
" 2>/dev/null || echo "error")

if [[ "$FIELDS_OK" == "ok" ]]; then
  pass "TC-E2E-012: Workflow '$WORKFLOW' has required fields (workflowId, format)"
else
  fail "TC-E2E-012: Workflow fields validation failed: $FIELDS_OK"
fi

# TC-E2E-013: List workflows with service token also works (read-only op)
log "TC-E2E-013: List workflows works with service token"
RESPONSE=$(mcp_call "$BACKEND_SECRET" '{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"orchestrator-workflows-list","arguments":{}}}')
DATA=$(extract_data "$RESPONSE")
SVC_TEXT=$(echo "$DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null || echo "")
SVC_JSON=$(echo "$SVC_TEXT" | sed 's/^```json//' | sed 's/^```//' | tr -d '\n')
SVC_COUNT=$(echo "$SVC_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('workflows',[])))" 2>/dev/null || echo "0")

if [[ "$SVC_COUNT" -ge 1 ]]; then
  pass "TC-E2E-013: List workflows with service token returned $SVC_COUNT workflow(s)"
else
  fail "TC-E2E-013: Service token list returned $SVC_COUNT workflows"
fi

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# TEST GROUP 3: orchestrator-workflow-execute
# ══════════════════════════════════════════════════════════════════════════════
echo "── Test Group 3: orchestrator-workflow-execute ──"

if [[ "$SKIP_EXECUTE" == "true" ]]; then
  skip "TC-E2E-020: Execute workflow (SKIP_EXECUTE=true)"
  skip "TC-E2E-021: Execute returns valid instanceId (SKIP_EXECUTE=true)"
  skip "TC-E2E-022: Execute with service token fails (SKIP_EXECUTE=true)"
  INSTANCE_ID=""
else

  # TC-E2E-020: Execute workflow succeeds
  log "TC-E2E-020: Execute workflow '$WORKFLOW'"
  RESPONSE=$(mcp_call "$GUEST_TOKEN" "{\"jsonrpc\":\"2.0\",\"id\":20,\"method\":\"tools/call\",\"params\":{\"name\":\"orchestrator-workflow-execute\",\"arguments\":{\"workflowId\":\"$WORKFLOW\",\"inputData\":{\"name\":\"E2E Test\",\"language\":\"English\"}}}}")
  DATA=$(extract_data "$RESPONSE")
  EXEC_TEXT=$(echo "$DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null || echo "")
  EXEC_JSON=$(echo "$EXEC_TEXT" | sed 's/^```json//' | sed 's/^```//' | tr -d '\n')

  INSTANCE_ID=$(echo "$EXEC_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('instanceId',''))" 2>/dev/null || echo "")
  EXEC_ERROR=$(echo "$EXEC_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")

  if [[ -n "$INSTANCE_ID" ]] && [[ -z "$EXEC_ERROR" ]]; then
    pass "TC-E2E-020: Workflow executed, instanceId=$INSTANCE_ID"
  else
    fail "TC-E2E-020: Execute failed. instanceId='$INSTANCE_ID' error='$EXEC_ERROR'"
    INSTANCE_ID=""
  fi

  # TC-E2E-021: Instance ID is a valid UUID
  log "TC-E2E-021: Instance ID format validation"
  if [[ "$INSTANCE_ID" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    pass "TC-E2E-021: Instance ID is a valid UUID"
  elif [[ -z "$INSTANCE_ID" ]]; then
    skip "TC-E2E-021: No instance ID (execute may have failed)"
  else
    fail "TC-E2E-021: Instance ID '$INSTANCE_ID' is not a valid UUID"
  fi

  # TC-E2E-022: Execute with service token fails (requires user credentials)
  log "TC-E2E-022: Execute with service token returns error"
  RESPONSE=$(mcp_call "$BACKEND_SECRET" "{\"jsonrpc\":\"2.0\",\"id\":22,\"method\":\"tools/call\",\"params\":{\"name\":\"orchestrator-workflow-execute\",\"arguments\":{\"workflowId\":\"$WORKFLOW\",\"inputData\":{\"name\":\"SvcTest\",\"language\":\"English\"}}}}")
  DATA=$(extract_data "$RESPONSE")
  SVC_EXEC_TEXT=$(echo "$DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null || echo "")
  SVC_EXEC_JSON=$(echo "$SVC_EXEC_TEXT" | sed 's/^```json//' | sed 's/^```//' | tr -d '\n')
  SVC_EXEC_ERROR=$(echo "$SVC_EXEC_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")

  if [[ -n "$SVC_EXEC_ERROR" ]]; then
    pass "TC-E2E-022: Service token correctly rejected for execute (error: user credentials required)"
  else
    fail "TC-E2E-022: Execute with service token should fail but succeeded"
  fi
fi

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# TEST GROUP 4: orchestrator-instance-get
# ══════════════════════════════════════════════════════════════════════════════
echo "── Test Group 4: orchestrator-instance-get ──────"

if [[ -z "${INSTANCE_ID:-}" ]]; then
  skip "TC-E2E-030: Get instance (no instance ID available)"
  skip "TC-E2E-031: Instance status is COMPLETED (no instance ID)"
  skip "TC-E2E-032: Instance has workflow data (no instance ID)"
  skip "TC-E2E-033: Instance workflowId matches (no instance ID)"
else

  # Wait briefly for workflow to complete
  log "Waiting 3s for workflow completion..."
  sleep 3

  # TC-E2E-030: Get instance succeeds
  log "TC-E2E-030: Get workflow instance"
  RESPONSE=$(mcp_call "$GUEST_TOKEN" "{\"jsonrpc\":\"2.0\",\"id\":30,\"method\":\"tools/call\",\"params\":{\"name\":\"orchestrator-instance-get\",\"arguments\":{\"instanceId\":\"$INSTANCE_ID\"}}}")
  DATA=$(extract_data "$RESPONSE")
  INST_TEXT=$(echo "$DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null || echo "")
  INST_JSON=$(echo "$INST_TEXT" | sed 's/^```json//' | sed 's/^```//' | tr -d '\n')
  INST_ERROR=$(echo "$INST_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")

  if [[ -z "$INST_ERROR" ]]; then
    pass "TC-E2E-030: Get instance succeeded"
  else
    fail "TC-E2E-030: Get instance failed: $INST_ERROR"
  fi

  # TC-E2E-031: Instance status is COMPLETED
  log "TC-E2E-031: Instance status is COMPLETED"
  INST_STATUS=$(echo "$INST_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
  if [[ "$INST_STATUS" == "COMPLETED" ]]; then
    pass "TC-E2E-031: Instance status is COMPLETED"
  elif [[ "$INST_STATUS" == "ACTIVE" ]]; then
    log "Instance still ACTIVE, waiting 5s and retrying..."
    sleep 5
    RESPONSE=$(mcp_call "$GUEST_TOKEN" "{\"jsonrpc\":\"2.0\",\"id\":31,\"method\":\"tools/call\",\"params\":{\"name\":\"orchestrator-instance-get\",\"arguments\":{\"instanceId\":\"$INSTANCE_ID\"}}}")
    DATA=$(extract_data "$RESPONSE")
    INST_TEXT=$(echo "$DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null || echo "")
    INST_JSON=$(echo "$INST_TEXT" | sed 's/^```json//' | sed 's/^```//' | tr -d '\n')
    INST_STATUS=$(echo "$INST_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
    if [[ "$INST_STATUS" == "COMPLETED" ]]; then
      pass "TC-E2E-031: Instance status is COMPLETED (after retry)"
    else
      fail "TC-E2E-031: Expected COMPLETED, got '$INST_STATUS'"
    fi
  else
    fail "TC-E2E-031: Expected COMPLETED, got '$INST_STATUS'"
  fi

  # TC-E2E-032: Instance has workflow data
  log "TC-E2E-032: Instance contains workflow output data"
  HAS_DATA=$(echo "$INST_JSON" | python3 -c "
import sys,json
d=json.load(sys.stdin)
wd = d.get('workflowdata','')
if wd:
    print('yes')
else:
    print('no')
" 2>/dev/null || echo "no")

  if [[ "$HAS_DATA" == "yes" ]]; then
    pass "TC-E2E-032: Instance has workflow output data"
  else
    fail "TC-E2E-032: Instance missing workflow data"
  fi

  # TC-E2E-033: Instance workflowId matches
  log "TC-E2E-033: Instance workflowId matches executed workflow"
  INST_WF=$(echo "$INST_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('workflowId',''))" 2>/dev/null || echo "")
  if [[ "$INST_WF" == "$WORKFLOW" ]]; then
    pass "TC-E2E-033: Instance workflowId='$INST_WF' matches '$WORKFLOW'"
  else
    fail "TC-E2E-033: Instance workflowId='$INST_WF' != expected '$WORKFLOW'"
  fi
fi

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# TEST GROUP 5: Error Handling
# ══════════════════════════════════════════════════════════════════════════════
echo "── Test Group 5: Error Handling ─────────────────"

# TC-E2E-040: Call non-existent tool
log "TC-E2E-040: Call non-existent tool returns error"
RESPONSE=$(mcp_call "$GUEST_TOKEN" '{"jsonrpc":"2.0","id":40,"method":"tools/call","params":{"name":"nonexistent:tool","arguments":{}}}')
DATA=$(extract_data "$RESPONSE")
HAS_ERROR=$(echo "$DATA" | python3 -c "
import sys,json
d=json.load(sys.stdin)
# MCP errors can be in result.isError or at the JSON-RPC error level
has_err = 'error' in d or d.get('result',{}).get('isError',False)
print('yes' if has_err else 'no')
" 2>/dev/null || echo "no")

if [[ "$HAS_ERROR" == "yes" ]]; then
  pass "TC-E2E-040: Non-existent tool correctly returns error"
else
  fail "TC-E2E-040: Expected error for non-existent tool"
fi

# TC-E2E-041: Execute non-existent workflow
log "TC-E2E-041: Execute non-existent workflow returns error"
RESPONSE=$(mcp_call "$GUEST_TOKEN" '{"jsonrpc":"2.0","id":41,"method":"tools/call","params":{"name":"orchestrator-workflow-execute","arguments":{"workflowId":"nonexistent-workflow-xyz","inputData":{"x":"y"}}}}')
DATA=$(extract_data "$RESPONSE")
EXEC_TEXT=$(echo "$DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null || echo "")
EXEC_JSON=$(echo "$EXEC_TEXT" | sed 's/^```json//' | sed 's/^```//' | tr -d '\n')
NONEXIST_ERROR=$(echo "$EXEC_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")

if [[ -n "$NONEXIST_ERROR" ]]; then
  pass "TC-E2E-041: Non-existent workflow correctly returns error"
else
  fail "TC-E2E-041: Expected error for non-existent workflow"
fi

# TC-E2E-042: Get non-existent instance
log "TC-E2E-042: Get non-existent instance returns error"
RESPONSE=$(mcp_call "$GUEST_TOKEN" '{"jsonrpc":"2.0","id":42,"method":"tools/call","params":{"name":"orchestrator-instance-get","arguments":{"instanceId":"00000000-0000-0000-0000-000000000000"}}}')
DATA=$(extract_data "$RESPONSE")
INST_TEXT=$(echo "$DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null || echo "")
INST_JSON=$(echo "$INST_TEXT" | sed 's/^```json//' | sed 's/^```//' | tr -d '\n')
NONEXIST_INST_ERROR=$(echo "$INST_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo "")

if [[ -n "$NONEXIST_INST_ERROR" ]]; then
  pass "TC-E2E-042: Non-existent instance correctly returns error"
else
  fail "TC-E2E-042: Expected error for non-existent instance"
fi

# TC-E2E-043: Unauthenticated request is rejected
log "TC-E2E-043: Unauthenticated MCP request is rejected"
UNAUTH_RESPONSE=$(oc exec -n "$NAMESPACE" "deploy/$DEPLOYMENT" -- \
  curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST "http://localhost:7007${MCP_ENDPOINT}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":43,"method":"tools/list"}' 2>&1 | grep -v "^Defaulted container" | tail -1 || echo "000")

if [[ "$UNAUTH_RESPONSE" == "401" ]]; then
  pass "TC-E2E-043: Unauthenticated request returns 401"
else
  fail "TC-E2E-043: Expected 401, got HTTP $UNAUTH_RESPONSE"
fi

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# TEST GROUP 6: Full Lifecycle
# ══════════════════════════════════════════════════════════════════════════════
echo "── Test Group 6: Full MCP Lifecycle ─────────────"

if [[ "$SKIP_EXECUTE" == "true" ]]; then
  skip "TC-E2E-050: Full lifecycle (SKIP_EXECUTE=true)"
else
  log "TC-E2E-050: Full lifecycle: list -> execute -> get"

  # Step 1: List workflows
  R1=$(mcp_call "$GUEST_TOKEN" '{"jsonrpc":"2.0","id":50,"method":"tools/call","params":{"name":"orchestrator-workflows-list","arguments":{}}}')
  D1=$(extract_data "$R1")
  T1=$(echo "$D1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null || echo "")
  J1=$(echo "$T1" | sed 's/^```json//' | sed 's/^```//' | tr -d '\n')
  WF_FOUND=$(echo "$J1" | python3 -c "
import sys,json
d=json.load(sys.stdin)
wf = next((w for w in d.get('workflows',[]) if w['workflowId']=='$WORKFLOW'), None)
print('yes' if wf and wf.get('isAvailable', True) else 'no')
" 2>/dev/null || echo "no")

  if [[ "$WF_FOUND" != "yes" ]]; then
    fail "TC-E2E-050: Lifecycle step 1 failed: workflow '$WORKFLOW' not found or not available"
  else
    # Step 2: Execute the workflow
    R2=$(mcp_call "$GUEST_TOKEN" "{\"jsonrpc\":\"2.0\",\"id\":51,\"method\":\"tools/call\",\"params\":{\"name\":\"orchestrator-workflow-execute\",\"arguments\":{\"workflowId\":\"$WORKFLOW\",\"inputData\":{\"name\":\"Lifecycle Test\",\"language\":\"English\"}}}}")
    D2=$(extract_data "$R2")
    T2=$(echo "$D2" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null || echo "")
    J2=$(echo "$T2" | sed 's/^```json//' | sed 's/^```//' | tr -d '\n')
    LC_INSTANCE=$(echo "$J2" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('instanceId',''))" 2>/dev/null || echo "")

    if [[ -z "$LC_INSTANCE" ]]; then
      fail "TC-E2E-050: Lifecycle step 2 failed: no instanceId returned"
    else
      # Step 3: Wait and get instance
      sleep 3
      R3=$(mcp_call "$GUEST_TOKEN" "{\"jsonrpc\":\"2.0\",\"id\":52,\"method\":\"tools/call\",\"params\":{\"name\":\"orchestrator-instance-get\",\"arguments\":{\"instanceId\":\"$LC_INSTANCE\"}}}")
      D3=$(extract_data "$R3")
      T3=$(echo "$D3" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null || echo "")
      J3=$(echo "$T3" | sed 's/^```json//' | sed 's/^```//' | tr -d '\n')
      LC_STATUS=$(echo "$J3" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
      LC_WF_ID=$(echo "$J3" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('workflowId',''))" 2>/dev/null || echo "")

      if [[ "$LC_STATUS" == "COMPLETED" ]] && [[ "$LC_WF_ID" == "$WORKFLOW" ]]; then
        pass "TC-E2E-050: Full lifecycle completed: list->execute->get (status=$LC_STATUS, instanceId=$LC_INSTANCE)"
      elif [[ "$LC_STATUS" == "ACTIVE" ]]; then
        sleep 5
        R3=$(mcp_call "$GUEST_TOKEN" "{\"jsonrpc\":\"2.0\",\"id\":53,\"method\":\"tools/call\",\"params\":{\"name\":\"orchestrator-instance-get\",\"arguments\":{\"instanceId\":\"$LC_INSTANCE\"}}}")
        D3=$(extract_data "$R3")
        T3=$(echo "$D3" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['result']['content'][0]['text'])" 2>/dev/null || echo "")
        J3=$(echo "$T3" | sed 's/^```json//' | sed 's/^```//' | tr -d '\n')
        LC_STATUS=$(echo "$J3" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
        if [[ "$LC_STATUS" == "COMPLETED" ]]; then
          pass "TC-E2E-050: Full lifecycle completed after retry (status=$LC_STATUS)"
        else
          fail "TC-E2E-050: Instance status='$LC_STATUS', expected COMPLETED"
        fi
      else
        fail "TC-E2E-050: Lifecycle step 3 failed: status='$LC_STATUS' workflowId='$LC_WF_ID'"
      fi
    fi
  fi
fi

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════
echo "=============================================="
echo " E2E Test Results"
echo "=============================================="
echo -e "  ${GREEN}Passed:${NC}  $PASS"
echo -e "  ${RED}Failed:${NC}  $FAIL"
echo -e "  ${YELLOW}Skipped:${NC} $SKIP"
echo "  Total:   $TOTAL"
echo ""

if [[ ${#FAILURES[@]} -gt 0 ]]; then
  echo -e "${RED}Failed tests:${NC}"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  echo ""
fi

if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}$FAIL test(s) failed.${NC}"
  exit 1
fi
