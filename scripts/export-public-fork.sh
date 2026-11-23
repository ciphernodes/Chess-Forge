#!/usr/bin/env bash
# Non-destructive helper to export a public-safe ChessForge fork with
# autonomous execution and aggressive humanization modules stripped out.
# Usage: ./scripts/export-public-fork.sh <destination-dir>

set -euo pipefail

DEST_DIR="${1:-}"
if [[ -z "${DEST_DIR}" ]]; then
  echo "Usage: $0 <destination-dir>" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rm -rf "${DEST_DIR}"
mkdir -p "${DEST_DIR}"

cp -a "${ROOT_DIR}/." "${DEST_DIR}/"

# Strip private autonomous execution, native OS input, aggressive humanization, and private docs
rm -rf \
  "${DEST_DIR}/native-host" \
  "${DEST_DIR}/README_PRIVATE.md" \
  "${DEST_DIR}/scripts/export-public-fork.sh" \
  "${DEST_DIR}/browser-extension/src/ts/autoPlayPorts.ts" \
  "${DEST_DIR}/browser-extension/src/ts/autoPlayOrchestrator.ts" \
  "${DEST_DIR}/browser-extension/src/ts/autoPlayPipeline.test.ts" \
  "${DEST_DIR}/browser-extension/src/ts/behavioralStateMachine.ts" \
  "${DEST_DIR}/browser-extension/src/ts/clockAndSessionManager.ts" \
  "${DEST_DIR}/browser-extension/src/ts/desktopInputDrivers.ts" \
  "${DEST_DIR}/browser-extension/src/ts/environmentWatchdog.ts" \
  "${DEST_DIR}/browser-extension/src/ts/humanizerMoveSelector.ts" \
  "${DEST_DIR}/browser-extension/src/ts/inputModeController.ts" \
  "${DEST_DIR}/browser-extension/src/ts/kinematicPointerExecutor.ts" \
  "${DEST_DIR}/browser-extension/src/ts/openingPreferenceMatrix.ts" \
  "${DEST_DIR}/browser-extension/src/ts/promotionHandler.ts" \
  "${DEST_DIR}/browser-extension/src/ts/phase2Upgrade.test.ts" \
  "${DEST_DIR}/browser-extension/src/ts/phase3Upgrade.test.ts" \
  "${DEST_DIR}/browser-extension/src/ts/phase4Upgrade.test.ts"

echo "Exported stripped public-safe ChessForge fork to: ${DEST_DIR}"
