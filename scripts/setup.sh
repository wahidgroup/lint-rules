#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP_DIR="$ROOT/.make"
SETUP_HASH_FILE="$STAMP_DIR/setup.hash"

# GitHub Actions sets CI=true; prefer lockfile-faithful installs there.
NPM_INSTALL_CMD=install
if [ "${CI:-}" = "true" ] || [ "${CI:-}" = "1" ]; then
	NPM_INSTALL_CMD=ci
fi

compute_setup_hash() {
	shasum -a 256 \
		"$ROOT/package.json" \
		"$ROOT/package-lock.json" \
		2>/dev/null \
		| shasum -a 256 \
		| awk '{ print $1 }'
}

setup_required() {
	if [ ! -d "$ROOT/node_modules" ]; then
		return 0
	fi
	if [ ! -f "$SETUP_HASH_FILE" ]; then
		return 0
	fi

	local current_hash
	local saved_hash=""
	current_hash="$(compute_setup_hash)"
	saved_hash="$(tr -d '\n' < "$SETUP_HASH_FILE")"
	if [ "$current_hash" != "$saved_hash" ]; then
		return 0
	fi

	return 1
}

main() {
	mkdir -p "$STAMP_DIR"

	if setup_required; then
		echo "Installing dependencies (npm ${NPM_INSTALL_CMD})..."
		# shellcheck disable=SC2086
		npm --prefix "$ROOT" "${NPM_INSTALL_CMD}" ${NPM_INSTALL_FLAGS:-}
		compute_setup_hash > "$SETUP_HASH_FILE"
		echo "Setup complete."
	else
		echo "Setup already up to date."
	fi
}

main "$@"
