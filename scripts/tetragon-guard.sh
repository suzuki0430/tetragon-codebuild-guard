#!/usr/bin/env bash
set -euo pipefail

readonly TETRAGON_CONTAINER_NAME="${TETRAGON_CONTAINER_NAME:-tetragon}"
readonly TETRAGON_DATA_DIR="${TETRAGON_ARTIFACT_DIR:-/tmp/tetragon-codebuild-guard}"
readonly POLICY_CONTAINER_PATH="/tmp/block-curl-egress.yaml"

# Usage: print_diagnostics
# Description: Prints bootstrap state and daemon output without exposing secrets.
# Returns: Always returns zero so it can be called from error paths.
print_diagnostics() {
  local status_file="${TETRAGON_DATA_DIR}/startup-status"

  printf 'Tetragon startup status: %s\n' "$(cat "${status_file}" 2>/dev/null || printf 'missing')"
  if [[ -f "${TETRAGON_DATA_DIR}/startup-error.log" ]]; then
    printf '%s\n' '--- startup-error.log ---'
    sed -n '1,160p' "${TETRAGON_DATA_DIR}/startup-error.log"
  fi
  docker logs "${TETRAGON_CONTAINER_NAME}" 2>&1 | tail -n 160 || true
}

# Usage: require_ready
# Description: Verifies that the pre-build phase started a responsive Tetragon agent.
# Returns: Zero when Tetragon reports ready; non-zero with diagnostics otherwise.
require_ready() {
  local status
  status="$(cat "${TETRAGON_DATA_DIR}/startup-status" 2>/dev/null || true)"

  if [[ "${status}" != "ready" ]]; then
    print_diagnostics
    return 1
  fi

  if ! docker exec "${TETRAGON_CONTAINER_NAME}" tetra status; then
    print_diagnostics
    return 1
  fi
}

# Usage: apply_policy <baseline|observe|enforce>
# Description: Loads the demo policy through Tetragon's gRPC API in the selected mode.
# Returns: Zero after the expected policy state is established.
apply_policy() {
  local mode="${1:?mode is required}"
  local policy_mode
  local project_root

  require_ready

  if [[ "${mode}" == "baseline" ]]; then
    printf '%s\n' 'Baseline mode selected; no tracing policy was loaded.'
    return 0
  fi

  case "${mode}" in
    observe)
      policy_mode="monitor"
      ;;
    enforce)
      policy_mode="enforce"
      ;;
    *)
      printf 'Unsupported mode: %s\n' "${mode}" >&2
      return 2
      ;;
  esac

  project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  docker cp \
    "${project_root}/policies/block-curl-egress.yaml" \
    "${TETRAGON_CONTAINER_NAME}:${POLICY_CONTAINER_PATH}"
  docker exec "${TETRAGON_CONTAINER_NAME}" \
    tetra tracingpolicy add --mode "${policy_mode}" "${POLICY_CONTAINER_PATH}"
  docker exec "${TETRAGON_CONTAINER_NAME}" tetra tracingpolicy list
}

# Usage: capture_artifacts <destination-directory>
# Description: Copies Tetragon events, daemon logs, and active policy state for upload.
# Returns: Zero after readable diagnostic artifacts have been collected.
capture_artifacts() {
  local destination="${1:?destination directory is required}"

  mkdir -p "${destination}"
  sync
  cp "${TETRAGON_DATA_DIR}/startup-status" "${destination}/" 2>/dev/null || true
  cp "${TETRAGON_DATA_DIR}/startup-error.log" "${destination}/" 2>/dev/null || true
  cp "${TETRAGON_DATA_DIR}/tetragon.log" "${destination}/" 2>/dev/null || true
  docker logs "${TETRAGON_CONTAINER_NAME}" > "${destination}/tetragon-daemon.log" 2>&1 || true
  docker exec "${TETRAGON_CONTAINER_NAME}" tetra tracingpolicy list \
    > "${destination}/tracing-policies.txt" 2>&1 || true
  chmod -R a+rX "${destination}"
}

# Usage: main <status|apply|capture> [argument]
# Description: Dispatches the command-line interface used by the GitHub workflow.
# Returns: The selected operation's status code.
main() {
  local command="${1:-}"

  case "${command}" in
    status)
      require_ready
      ;;
    apply)
      apply_policy "${2:?mode is required}"
      ;;
    capture)
      capture_artifacts "${2:?destination directory is required}"
      ;;
    *)
      printf 'Usage: %s <status|apply|capture> [argument]\n' "$0" >&2
      return 2
      ;;
  esac
}

main "$@"
