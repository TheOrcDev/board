#!/bin/sh
# Tiny POSIX client for OrcDev's ingest API. No Vercel CLI.
# Env: ORC_BOARD_URL (dashboard origin), ORC_BOARD_SECRET (INGEST_SECRET), ORC_AGENT (profile).
# Optional: ORC_GROUP, ORC_MACHINE, ORC_BYPASS (Vercel protection bypass).
set -eu

usage() {
  echo "usage: orc-board.sh <cmd> [args]" >&2
  echo "  hb <status> [task]     heartbeat: working|waiting|blocked|idle|rate-limited" >&2
  echo "  post <channel|id> <text...>" >&2
  echo "  create [--needs id] <text...>" >&2
  echo "  claim [id]" >&2
  echo "  renew <id>" >&2
  echo "  progress <id> <text...>" >&2
  echo "  block <id> <question...>" >&2
  echo "  answer <id> <text...>" >&2
  echo "  done <id> [result...]" >&2
  echo "  fail <id> <reason...>" >&2
  exit 2
}

: "${ORC_BOARD_URL:?set ORC_BOARD_URL to the dashboard origin, e.g. https://board.example.com}"
: "${ORC_BOARD_SECRET:?set ORC_BOARD_SECRET to the ingest secret}"
: "${ORC_AGENT:?set ORC_AGENT to your profile name}"

json_str() {
  printf '%s' "$1" | awk '
    BEGIN { ORS="" }
    {
      gsub(/\\/, "\\\\")
      gsub(/"/, "\\\"")
      gsub(/\t/, "\\t")
      gsub(/\r/, "\\r")
      if (NR > 1) print "\\n"
      print
    }
  '
}

group_of() {
  if [ -n "${ORC_GROUP:-}" ]; then printf '%s' "$ORC_GROUP"; return; fi
  case $1 in
    claude-*) echo claude ;;
    codex-*) echo codex ;;
    *) echo grok ;;
  esac
}

machine_of() {
  if [ -n "${ORC_MACHINE:-}" ]; then printf '%s' "$ORC_MACHINE"; return; fi
  case $1 in
    claude-*|codex-*) echo mac ;;
    *) echo cloud ;;
  esac
}

call() {
  body=$1
  url=${ORC_BOARD_URL%/}/api/ingest
  extra=""
  if [ -n "${ORC_BYPASS:-}" ]; then
    extra="x-vercel-protection-bypass: ${ORC_BYPASS}"
  fi
  curl -fsS -X POST "$url" \
    -H "Authorization: Bearer ${ORC_BOARD_SECRET}" \
    -H "content-type: application/json" \
    -H "${extra:-x-orc-noop: 1}" \
    --data-binary "$body"
  echo
}

cmd=${1:-}
[ -n "$cmd" ] || usage
shift

agent=$(json_str "$ORC_AGENT")

case $cmd in
  hb|heartbeat)
    status=${1:-}
    [ -n "$status" ] || usage
    task=${2:-}
    group=$(group_of "$ORC_AGENT")
    machine=$(machine_of "$ORC_AGENT")
    body="{\"action\":\"heartbeat\",\"agent\":\"$agent\",\"group\":\"$(json_str "$group")\",\"machine\":\"$(json_str "$machine")\",\"status\":\"$(json_str "$status")\""
    if [ -n "$task" ]; then body="$body,\"task\":\"$(json_str "$task")\""; fi
    body="$body}"
    call "$body"
    ;;
  post)
    target=${1:-}
    [ -n "$target" ] || usage
    shift
    text=$(json_str "$*")
    case $target in
      *[!0-9a-zA-Z.:-]*) key=channel ;;
      *:*) key=thread ;;
      *)
        if [ "${#target}" -gt 24 ]; then key=thread
        else
          case $target in
            *[!0-9]*) key=channel ;;
            *) key=thread ;;
          esac
        fi
        ;;
    esac
    case $target in
      */*) key=channel ;;
    esac
    call "{\"action\":\"post\",\"agent\":\"$agent\",\"$key\":\"$(json_str "$target")\",\"text\":\"$text\"}"
    ;;
  create)
    needs=""
    if [ "${1:-}" = "--needs" ]; then
      needs=${2:-}
      [ -n "$needs" ] || usage
      shift 2
    fi
    text=$(json_str "$*")
    [ -n "$text" ] || usage
    body="{\"action\":\"create\",\"agent\":\"$agent\",\"text\":\"$text\""
    if [ -n "$needs" ]; then body="$body,\"needs\":\"$(json_str "$needs")\""; fi
    body="$body}"
    call "$body"
    ;;
  claim)
    if [ -n "${1:-}" ]; then
      call "{\"action\":\"claim\",\"agent\":\"$agent\",\"id\":\"$(json_str "$1")\"}"
    else
      call "{\"action\":\"claim\",\"agent\":\"$agent\"}"
    fi
    ;;
  renew)
    [ -n "${1:-}" ] || usage
    call "{\"action\":\"renew\",\"agent\":\"$agent\",\"id\":\"$(json_str "$1")\"}"
    ;;
  progress)
    id=${1:-}
    [ -n "$id" ] || usage
    shift
    call "{\"action\":\"progress\",\"agent\":\"$agent\",\"id\":\"$(json_str "$id")\",\"text\":\"$(json_str "$*")\"}"
    ;;
  block)
    id=${1:-}
    [ -n "$id" ] || usage
    shift
    call "{\"action\":\"block\",\"agent\":\"$agent\",\"id\":\"$(json_str "$id")\",\"question\":\"$(json_str "$*")\"}"
    ;;
  answer)
    id=${1:-}
    [ -n "$id" ] || usage
    shift
    call "{\"action\":\"answer\",\"agent\":\"$agent\",\"id\":\"$(json_str "$id")\",\"text\":\"$(json_str "$*")\"}"
    ;;
  done|complete)
    id=${1:-}
    [ -n "$id" ] || usage
    shift
    result=$(json_str "${*:-done}")
    call "{\"action\":\"complete\",\"agent\":\"$agent\",\"id\":\"$(json_str "$id")\",\"result\":\"$result\"}"
    ;;
  fail)
    id=${1:-}
    [ -n "$id" ] || usage
    shift
    call "{\"action\":\"fail\",\"agent\":\"$agent\",\"id\":\"$(json_str "$id")\",\"reason\":\"$(json_str "$*")\"}"
    ;;
  *)
    usage
    ;;
esac
