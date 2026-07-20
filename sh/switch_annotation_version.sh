#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_DIR}"

show_versions() {
  cat <<'EOF'
Available annotation versions:

  matrix   Matrix-first interface
           branch: main
           commit: 1637c7b (matrix annotation)

  pairs    Pair-by-pair prototype
           branch: pairwise-annotation
           commit: e32935c (prototype annotate by pairs)

  hybrid   Progressive row matrix + focused pair scorer
           branch: row-hybrid-annotation
           status: current prototype branch

  initial  Initial project checkpoint (detached/read-only inspection)
           commit: e86586a (Initial annotation app checkpoint)

Examples:
  ./sh/switch_annotation_version.sh status
  ./sh/switch_annotation_version.sh matrix
  ./sh/switch_annotation_version.sh pairs
  ./sh/switch_annotation_version.sh hybrid
  ./sh/switch_annotation_version.sh initial
EOF
}

require_clean_worktree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Cannot switch versions because the working tree has uncommitted changes."
    echo
    git status --short
    echo
    echo "Commit the changes or temporarily store them with:"
    echo "  git stash push --include-untracked -m \"work before version switch\""
    echo
    echo "Restore stashed work later with:"
    echo "  git stash pop"
    exit 1
  fi
}

command="${1:-status}"

case "${command}" in
  status|list)
    show_versions
    echo
    echo "Current version:"
    git status --short --branch
    git log -1 --oneline
    ;;
  matrix)
    require_clean_worktree
    git switch main
    echo "Now using the matrix-first interface."
    ;;
  pairs|pairwise)
    require_clean_worktree
    git switch pairwise-annotation
    echo "Now using the pair-by-pair prototype."
    ;;
  hybrid|row-hybrid)
    require_clean_worktree
    git switch row-hybrid-annotation
    echo "Now using the progressive row-hybrid prototype."
    ;;
  initial)
    require_clean_worktree
    git switch --detach e86586a
    echo "Now inspecting the initial checkpoint in detached HEAD mode."
    echo "Return with: ./sh/switch_annotation_version.sh pairs"
    ;;
  *)
    echo "Unknown version: ${command}"
    echo
    show_versions
    exit 2
    ;;
esac
