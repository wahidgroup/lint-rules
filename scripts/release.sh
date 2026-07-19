#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Project detection
# ---------------------------------------------------------------------------
PROJECT_NAME="$(git remote get-url origin 2>/dev/null \
	| sed -e 's|.*/||' -e 's/\.git$//' || echo 'unknown')"

# Default development branch (forward releases cut from here)
DEFAULT_BRANCH="main"

# ---------------------------------------------------------------------------
# Colors and formatting
# ---------------------------------------------------------------------------
BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

ok()    { printf "  ${GREEN}[ok]${RESET} %s\n" "$1"; }
fail()  { printf "  ${RED}[error]${RESET} %s\n" "$1" >&2; exit 1; }
info()  { printf "  ${CYAN}[info]${RESET} %s\n" "$1"; }
step()  { printf "\n${BOLD}==> Step %s: %s${RESET}\n" "$1" "$2"; }
header(){ printf "\n${BOLD}${CYAN}%s${RESET}\n" "$1"; }

# ---------------------------------------------------------------------------
# Submodule detection (from .gitmodules)
# ---------------------------------------------------------------------------
SUBMODULES=()
if [[ -f .gitmodules ]]; then
	while IFS= read -r name; do
		SUBMODULES+=("$name")
	done < <(git config --file .gitmodules --get-regexp 'submodule\..*\.path' \
		| awk '{print $2}')
fi

# ---------------------------------------------------------------------------
# Version helpers (DRY)
# ---------------------------------------------------------------------------

detect_version_source() {
	if [[ -f package.json ]]; then
		printf "npm"
	elif [[ -f VERSION ]]; then
		printf "file"
	fi
}

detect_version() {
	case "$(detect_version_source)" in
		npm)  node -p "require('./package.json').version" 2>/dev/null || true ;;
		file) cat VERSION ;;
	esac
}

bump_version() {
	local version="$1"
	case "$(detect_version_source)" in
		npm)
			npm version "$version" --no-git-tag-version --allow-same-version
			git add package.json
			[[ -f npm-shrinkwrap.json ]] && git add npm-shrinkwrap.json
			[[ -f package-lock.json ]] && git add package-lock.json
			;;
		file)
			printf '%s\n' "$version" > VERSION
			git add VERSION
			;;
	esac
	ok "Version updated to ${version}"
}

# ---------------------------------------------------------------------------
# General helpers
# ---------------------------------------------------------------------------

compile_changelog() {
	if [[ -n "${CHANGELOG:-}" ]]; then
		return 0
	fi

	local last_tag
	last_tag=$(git describe --tags --match "releases/v*" --abbrev=0 2>/dev/null) \
		|| last_tag=$(git rev-list --max-parents=0 HEAD)

	local date_str
	date_str=$(date +%Y-%m-%d)

	local changelog_title="## v${VERSION} (${date_str})"

	local components=""
	if [[ -z "$REPO_DIR" && ${#SUBMODULES[@]} -gt 0 ]]; then
		components=$'\n### Components\n'
		for i in "${!SUBMODULES[@]}"; do
			local submod="${SUBMODULES[$i]}"
			local sub_version
			sub_version=$(cd "$submod" && detect_version)
			local sub_sha
			sub_sha=$(git -C "$submod" rev-parse --short HEAD)

			local line="- **${submod}**"
			if [[ -n "$sub_version" ]]; then
				line+=" v${sub_version}"
			fi
			line+=" (\`${sub_sha}\`)"
			if [[ -n "${SUBMODULE_REFS[$i]:-}" ]]; then
				line+=" @ ${SUBMODULE_REFS[$i]}"
			fi
			components+="${line}"$'\n'
		done
	fi

	local body=""
	local merge_subjects
	merge_subjects=$(git log "${last_tag}..HEAD" --merges --format="%s")

	local labels_file
	labels_file=$(mktemp)

	if [[ -n "$merge_subjects" ]]; then
		while IFS= read -r subject; do
			[[ -z "$subject" ]] && continue
			local pr_num
			pr_num=$(echo "$subject" | grep -oE '#[0-9]+' | head -1 | tr -d '#') || true
			[[ -z "$pr_num" ]] && continue

			local pr_json
			pr_json=$(gh pr view "$pr_num" \
				--json number,title,url,author,headRefName,labels \
				2>/dev/null || true)
			[[ -z "$pr_json" ]] && continue

			local is_release_pr
			is_release_pr=$(echo "$pr_json" \
				| jq -r '.headRefName | startswith("process/v")')
			[[ "$is_release_pr" == "true" ]] && continue

			local pr_line
			pr_line=$(echo "$pr_json" \
				| jq -r '"- [#\(.number)](\(.url)) \(.title) (@\(.author.login))"')
			[[ -z "$pr_line" ]] && continue

			body+="${pr_line}"$'\n'

			echo "$pr_json" | jq -r '.labels[].name' >> "$labels_file"
		done <<< "$merge_subjects"
	fi

	RELEASE_LABELS=$(sort -u "$labels_file" 2>/dev/null || true)
	rm -f "$labels_file"

	if [[ -n "$body" && -n "$components" ]]; then
		CHANGELOG="${changelog_title}
${components}
### Changes

${body}"
	elif [[ -n "$components" ]]; then
		CHANGELOG="${changelog_title}
${components}"
	else
		CHANGELOG="${changelog_title}

${body}"
	fi
}

print_release_notes() {
	compile_changelog
	printf "\n"
	printf "  ${BOLD}Release Notes (v${VERSION})${RESET}\n"
	printf "  ──────────────────────────────────\n"
	printf '%s\n' "$CHANGELOG" | while IFS= read -r line; do
		printf "  %s\n" "$line"
	done
	printf "  ──────────────────────────────────\n"
}

print_summary() {
	printf "\n"
	printf "  ${BOLD}Project:${RESET}   %s\n" "$PROJECT_NAME"
	printf "  ${BOLD}Version:${RESET}   %s\n" "$VERSION"
	printf "  ${BOLD}Tag:${RESET}       %s\n" "$TAG"
	printf "  ${BOLD}Branch:${RESET}    %s\n" "$BRANCH"
	if [[ "$RELEASE_MODE" == "backport" ]]; then
		printf "  ${BOLD}Base:${RESET}      %s\n" "$PR_BASE"
	fi
	if [[ -z "$REPO_DIR" && ${#SUBMODULES[@]} -gt 0 ]]; then
		for i in "${!SUBMODULES[@]}"; do
			local submod="${SUBMODULES[$i]}"
			local label
			label="$(echo "${submod:0:1}" | tr '[:lower:]' '[:upper:]')${submod:1}"
			printf "  ${BOLD}%s:${RESET}%s%s\n" "$label" \
				"$(printf '%*s' $((10 - ${#label})) '')" \
				"${SUBMODULE_REFS[$i]:-current}"
		done
	fi
	printf "\n"
}

poll_pr() {
	local pr_number="$1"
	local start_time
	start_time=$(date +%s)

	info "Polling PR #${pr_number} for merge (every 10s)..."
	while true; do
		local state
		state=$(gh pr view "$pr_number" --json state --jq .state)

		local now elapsed
		now=$(date +%s)
		elapsed=$(( now - start_time ))

		if [[ "$state" == "MERGED" ]]; then
			ok "PR #${pr_number} merged (${elapsed}s elapsed)"
			return 0
		fi

		if [[ "$state" == "CLOSED" ]]; then
			fail "PR #${pr_number} was closed without merging. Release aborted."
		fi

		printf "  ${YELLOW}[wait]${RESET} PR #%s is %s (%ds elapsed)\n" \
			"$pr_number" "$state" "$elapsed"
		sleep 10
	done
}

ensure_label() {
	local label="$1"
	if ! gh label create "$label" \
		--color "0e8a16" \
		--description "Release PR (auto-managed by scripts/release.sh)" \
		--force >/dev/null 2>&1; then
		fail "Failed to ensure label '${label}' exists. Check repo write permissions."
	fi
}

semver_compare() {
	local IFS=.
	local -a a=($1) b=($2)
	for i in 0 1 2; do
		if (( a[i] > b[i] )); then
			printf "gt"; return
		elif (( a[i] < b[i] )); then
			printf "lt"; return
		fi
	done
	printf "eq"
}

# ---------------------------------------------------------------------------
# Submodule helpers
# ---------------------------------------------------------------------------

resolve_submodule_ref() {
	local name="$1"
	local ref="$2"

	if ! git -C "$name" diff --quiet || ! git -C "$name" diff --cached --quiet; then
		fail "${name}: has uncommitted changes"
	fi

	git -C "$name" fetch origin --quiet --tags
	if ! git -C "$name" rev-parse --verify "${ref}^{commit}" &>/dev/null; then
		fail "${name}: ref '${ref}' not found (fetch returned no match)"
	fi

	if [[ "$ref" == releases/v* ]]; then
		local yanked_tag="yanked/${ref#releases/}"
		if git -C "$name" ls-remote --tags origin "$yanked_tag" 2>/dev/null | grep -q .; then
			fail "${name}: version ${ref#releases/} has been yanked"
		fi
	fi

	local resolved
	resolved=$(git -C "$name" rev-parse --short "${ref}^{commit}")
	git -C "$name" checkout "$ref" --quiet
	ok "${name}: pinned to ${ref} (${resolved})"
}

resolve_or_keep() {
	local name="$1"
	local ref="$2"

	if [[ -n "$ref" ]]; then
		resolve_submodule_ref "$name" "$ref"
	else
		git submodule update --init "$name"
		ok "${name}: keeping committed pointer"
	fi
}

resolve_submodules() {
	for i in "${!SUBMODULES[@]}"; do
		resolve_or_keep "${SUBMODULES[$i]}" "${SUBMODULE_REFS[$i]:-}"
	done
}

stage_submodules() {
	local staged=false

	for i in "${!SUBMODULES[@]}"; do
		if [[ -n "${SUBMODULE_REFS[$i]:-}" ]]; then
			git add "${SUBMODULES[$i]}"
			staged=true
		fi
	done

	if [[ "$staged" == true ]]; then
		ok "Submodule pointers updated"
	else
		ok "No submodule changes"
	fi
}

# ---------------------------------------------------------------------------
# Backport helpers
# ---------------------------------------------------------------------------

ensure_release_branch() {
	local branch="$1"
	local major="$2"
	local minor="$3"
	local patch="$4"

	git fetch origin --quiet --tags

	if [[ -n "$(git ls-remote --heads origin "refs/heads/${branch}" 2>/dev/null)" ]]; then
		git checkout "$branch" --quiet
		git pull origin "$branch" --quiet
		ok "Release branch ${branch} is up to date"
		return
	fi

	local base_tag=""
	if (( patch > 0 )); then
		base_tag="releases/v${major}.${minor}.0"
		if ! git rev-parse --verify "${base_tag}^{commit}" &>/dev/null; then
			fail "Base tag ${base_tag} not found - release v${major}.${minor}.0 first"
		fi
	else
		local latest_branch=""
		local candidate candidate_minor
		while IFS= read -r candidate; do
			candidate="${candidate//[[:space:]]/}"
			[[ -z "$candidate" ]] && continue
			candidate_minor="${candidate##*.}"
			[[ "$candidate_minor" =~ ^[0-9]+$ ]] || continue
			# Never fork a new minor line from a higher minor's tip
			if (( candidate_minor < minor )); then
				latest_branch="$candidate"
				break
			fi
		done < <(git branch -r --list "origin/release/v${major}.*" --sort=-v:refname 2>/dev/null)
		if [[ -n "$latest_branch" ]]; then
			base_tag="${latest_branch#origin/}"
			git checkout "$base_tag" --quiet
			git checkout -b "$branch"
			git push -u origin "$branch" --quiet
			ok "Created release branch ${branch} from ${latest_branch}"
			return
		fi

		base_tag=""
		local tag_candidate tag_minor
		while IFS= read -r tag_candidate; do
			[[ -z "$tag_candidate" ]] && continue
			tag_minor="${tag_candidate#releases/v${major}.}"
			tag_minor="${tag_minor%%.*}"
			[[ "$tag_minor" =~ ^[0-9]+$ ]] || continue
			# Never base a new minor line on a higher minor's tag
			if (( tag_minor < minor )); then
				base_tag="$tag_candidate"
				break
			fi
		done < <(git tag --list "releases/v${major}.*" --sort=-v:refname)
		if [[ -z "$base_tag" ]]; then
			# No lower minor line exists (always true for a new .0 line):
			# cut from DEFAULT_BRANCH, per the standard release-lines model
			git fetch origin "$DEFAULT_BRANCH" --quiet
			base_tag="origin/${DEFAULT_BRANCH}"
		fi
	fi

	git checkout -b "$branch" "$base_tag"
	git push -u origin "$branch" --quiet
	ok "Created release branch ${branch} from ${base_tag}"
}

interactive_cherry_pick() {
	local release_branch="$1"

	git fetch origin "$DEFAULT_BRANCH" --quiet
	local commits
	commits=$(git log --oneline --cherry-pick --right-only \
		"${release_branch}...origin/${DEFAULT_BRANCH}" --no-merges 2>/dev/null || true)

	if [[ -z "$commits" ]]; then
		info "No commits available to cherry-pick since ${release_branch}"
		return 0
	fi

	local count
	count=$(echo "$commits" | wc -l | tr -d ' ')
	if (( count > 50 )); then
		info "${count} commits available - consider narrowing your selection"
	fi

	local selected=""
	if command -v fzf &>/dev/null; then
		selected=$(echo "$commits" \
			| fzf --multi --reverse \
				--header "Select commits to cherry-pick (TAB to select, ENTER to confirm)" \
			|| true)
	else
		local -a lines=()
		while IFS= read -r line; do
			lines+=("$line")
		done <<< "$commits"

		printf "\n  Commits on %s since %s:\n\n" "$DEFAULT_BRANCH" "$release_branch"
		for i in "${!lines[@]}"; do
			printf "    %d) %s\n" "$((i + 1))" "${lines[$i]}"
		done

		printf "\n  Enter commits to include (e.g. 1,3,5): "
		read -r selection

		if [[ -z "$selection" ]]; then
			info "No commits selected"
			return 0
		fi

		IFS=',' read -ra indices <<< "$selection"
		for idx in "${indices[@]}"; do
			idx=$(( ${idx// /} - 1 ))
			if (( idx >= 0 && idx < ${#lines[@]} )); then
				selected+="${lines[$idx]}"$'\n'
			fi
		done
	fi

	if [[ -z "$selected" ]]; then
		info "No commits selected"
		return 0
	fi

	while IFS= read -r line; do
		[[ -z "$line" ]] && continue
		local sha="${line%% *}"
		if ! git cherry-pick "$sha"; then
			printf "\n"
			fail "Cherry-pick conflict on ${line}
        Resolve the conflict, then resume:
          git cherry-pick --continue
          make release version=v${VERSION}"
		fi
		ok "Cherry-picked ${line}"
	done <<< "$selected"
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
DRY_RUN=false
ALLOW_STAGED=false
YANK=false
VERSION=""
REPO_DIR=""

for arg in "$@"; do
	if [[ "$arg" == "--dry-run" ]]; then
		DRY_RUN=true
	elif [[ "$arg" == "--allow-staged" ]]; then
		ALLOW_STAGED=true
	elif [[ "$arg" == "--yank" ]]; then
		YANK=true
	else
		matched=false
		if (( ${#SUBMODULES[@]} > 0 )); then
			for submod in "${SUBMODULES[@]}"; do
				if [[ "$arg" == "--${submod}" ]]; then
					if [[ -n "$REPO_DIR" ]]; then
						fail "Only one --<submodule> flag allowed at a time"
					fi
					REPO_DIR="$submod"
					matched=true
					break
				fi
			done
		fi
		if [[ "$matched" == false && -z "$VERSION" ]]; then
			VERSION="$arg"
		fi
	fi
done

VERSION="${VERSION#v}"

# ---------------------------------------------------------------------------
# Submodule mode: cd into the submodule repo
# ---------------------------------------------------------------------------
if [[ -n "$REPO_DIR" ]]; then
	if [[ ! -d "$REPO_DIR/.git" && ! -f "$REPO_DIR/.git" ]]; then
		fail "${REPO_DIR} is not a git repository (run 'make setup' first)"
	fi
	PROJECT_NAME="$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null \
		| sed -e 's|.*/||' -e 's/\.git$//')"
	cd "$REPO_DIR"
	ok "Targeting submodule: ${PROJECT_NAME} ($(pwd))"
fi

# ---------------------------------------------------------------------------
# Version resolution
# ---------------------------------------------------------------------------
CURRENT_VERSION=""
CURRENT_VERSION=$(detect_version)

if [[ "$YANK" == true ]]; then
	if [[ "$DRY_RUN" == true ]]; then
		header "Yank (dry run) - ${PROJECT_NAME}"
	else
		header "Yank - ${PROJECT_NAME}"
	fi
else
	if [[ "$DRY_RUN" == true ]]; then
		header "Release (dry run) - ${PROJECT_NAME}"
	else
		header "Release - ${PROJECT_NAME}"
	fi
fi

if [[ -z "$VERSION" ]]; then
	if [[ "$YANK" == true ]]; then
		all_tags=$(git ls-remote --tags origin 2>/dev/null \
			| sed -n 's|.*refs/tags/\(.*\)$|\1|p' | grep -v '\^{}')
		release_vers=$(echo "$all_tags" | grep '^releases/v' | sed 's|releases/v||' || true)
		yanked_vers=$(echo "$all_tags" | grep '^yanked/v' | sed 's|yanked/v||' || true)

		yankable=""
		while IFS= read -r ver; do
			[[ -z "$ver" ]] && continue
			if ! echo "$yanked_vers" | grep -qx "$ver"; then
				yankable+="$ver"$'\n'
			fi
		done <<< "$release_vers"

		if [[ -n "$yankable" ]]; then
			printf "\n  Yankable versions:\n"
			while IFS= read -r ver; do
				[[ -z "$ver" ]] && continue
				printf "    - v%s\n" "$ver"
			done <<< "$yankable"
		else
			fail "No yankable versions found"
		fi
		printf "\n  Enter version to yank: "
	else
		printf "\n  Enter version to release (current: %s): " "${CURRENT_VERSION:-unknown}"
	fi
	read -r VERSION
	VERSION="${VERSION#v}"
fi

# ---------------------------------------------------------------------------
# Semver format validation
# ---------------------------------------------------------------------------
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	fail "Invalid semver format: '${VERSION}'. Expected X.Y.Z (e.g. 0.2.0)"
fi
ok "Semver format valid: ${VERSION}"

# ---------------------------------------------------------------------------
# Release mode detection (forward vs backport)
# ---------------------------------------------------------------------------
IFS='.' read -r SV_MAJOR SV_MINOR SV_PATCH <<< "$VERSION"
RELEASE_MODE="forward"
PR_BASE="$DEFAULT_BRANCH"
RELEASE_BRANCH=""

git fetch origin --tags --quiet 2>/dev/null || true
LATEST_TAG=$(git tag --list "releases/v*" --sort=-v:refname | head -1)
if [[ -n "$LATEST_TAG" ]]; then
	LATEST_VER="${LATEST_TAG#releases/v}"
	IFS='.' read -r LATEST_MAJOR LATEST_MINOR _ <<< "$LATEST_VER"
	if (( SV_MAJOR < LATEST_MAJOR )) || \
	   (( SV_MAJOR == LATEST_MAJOR && SV_MINOR < LATEST_MINOR )); then
		RELEASE_MODE="backport"
	fi
fi

if [[ "$RELEASE_MODE" == "backport" ]]; then
	RELEASE_BRANCH="release/v${SV_MAJOR}.${SV_MINOR}"
	PR_BASE="$RELEASE_BRANCH"
fi

ok "Release mode: ${RELEASE_MODE} (base: ${PR_BASE})"

BRANCH="process/v${VERSION}"
TAG="releases/v${VERSION}"
YANKED_TAG="yanked/v${VERSION}"

# ---------------------------------------------------------------------------
# gh CLI check (needed for yank, state detection, and PR creation)
# ---------------------------------------------------------------------------
if command -v gh &>/dev/null; then
	ok "gh CLI available"
else
	fail "gh CLI is required (https://cli.github.com)"
fi

# ---------------------------------------------------------------------------
# Yank workflow (early exit)
# ---------------------------------------------------------------------------
if [[ "$YANK" == true ]]; then
	if git ls-remote --tags origin "$YANKED_TAG" 2>/dev/null | grep -q "$YANKED_TAG"; then
		ok "Version v${VERSION} is already yanked (${YANKED_TAG} exists)"
		exit 0
	fi

	if ! git ls-remote --tags origin "$TAG" 2>/dev/null | grep -q "$TAG"; then
		fail "Release tag ${TAG} does not exist on remote - nothing to yank"
	fi

	if [[ "$DRY_RUN" == true ]]; then
		info "Would delete GitHub release for ${TAG}"
		info "Would push marker tag ${YANKED_TAG}"
		info "Dry run complete. No changes were made."
		exit 0
	fi

	step 1 "Delete GitHub release"
	if gh release view "$TAG" &>/dev/null; then
		gh release delete "$TAG" --yes
		ok "GitHub release deleted for ${TAG}"
	else
		info "No GitHub release found for ${TAG} (tag-only release)"
	fi

	step 2 "Push yanked marker tag"
	git tag -a "$YANKED_TAG" \
		-m "Yanked by $(git config user.name) on $(date +%Y-%m-%d)"
	git push origin "$YANKED_TAG"
	ok "Marker tag ${YANKED_TAG} pushed"

	header "Yank complete!"
	printf "\n"
	printf "  ${BOLD}Version:${RESET}  v%s\n" "$VERSION"
	printf "  ${BOLD}Release:${RESET}  deleted\n"
	printf "  ${BOLD}Tag:${RESET}      %s (preserved)\n" "$TAG"
	printf "  ${BOLD}Marker:${RESET}   %s\n" "$YANKED_TAG"
	printf "\n"
	exit 0
fi

# ---------------------------------------------------------------------------
# State detection and resumability
# ---------------------------------------------------------------------------
PR_NUMBER=""
PR_STATE=""
RESUME_STATE="fresh"

header "Detecting release state..."

if git ls-remote --tags origin "$TAG" 2>/dev/null | grep -q "$TAG"; then
	ok "Release v${VERSION} already complete (tag ${TAG} exists on remote)"
	exit 0
fi

PR_LINE=$(gh pr list --head "$BRANCH" --state all --json number,state \
	--jq '.[0] | "\(.number) \(.state)"' 2>/dev/null || true)
if [[ -n "$PR_LINE" ]]; then
	read -r PR_NUMBER PR_STATE <<< "$PR_LINE"
fi

if [[ -n "$PR_NUMBER" && "$PR_STATE" == "MERGED" ]]; then
	RESUME_STATE="tag"
	info "[resume] PR #${PR_NUMBER} already merged, continuing to tag..."
elif [[ -n "$PR_NUMBER" && "$PR_STATE" == "OPEN" ]]; then
	RESUME_STATE="poll"
	info "[resume] PR #${PR_NUMBER} is open, waiting for merge..."
elif [[ -n "$PR_NUMBER" && "$PR_STATE" == "CLOSED" ]]; then
	fail "Previous release PR #${PR_NUMBER} for ${BRANCH} was closed without merging. Delete the branch (git push origin --delete ${BRANCH}) or reopen PR #${PR_NUMBER}, then retry."
elif git ls-remote --heads origin "$BRANCH" 2>/dev/null | grep -q "$BRANCH"; then
	RESUME_STATE="pr"
	info "[resume] Branch ${BRANCH} exists on remote, creating PR..."
elif git branch --list "$BRANCH" | grep -q "$BRANCH"; then
	if [[ "$RELEASE_MODE" == "backport" ]]; then
		RESUME_STATE="local"
		git checkout "$BRANCH" --quiet
		info "[resume] Local branch ${BRANCH} found, resuming after cherry-pick..."
	else
		# Forward: inspect tip without checkout first.
		tip_subject=$(git log -1 --pretty=%s "$BRANCH" 2>/dev/null || true)
		tip_version=""
		if git cat-file -e "${BRANCH}:package.json" 2>/dev/null; then
			tip_version=$(git show "${BRANCH}:package.json" \
				| node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version" 2>/dev/null || true)
		elif git cat-file -e "${BRANCH}:VERSION" 2>/dev/null; then
			tip_version=$(git show "${BRANCH}:VERSION" | tr -d '\n' || true)
		fi

		# Matching tip + dirty tree must fail (not delete).
		if [[ "$tip_subject" == "chore(release):"* && "$tip_version" == "$VERSION" ]]; then
			if ! git diff --quiet --ignore-submodules \
				|| ! git diff --cached --quiet --ignore-submodules; then
				fail "Working tree has uncommitted changes; clean tree required to resume ${BRANCH}"
			fi
			if ! git checkout "$BRANCH" --quiet; then
				fail "Could not checkout ${BRANCH} to resume release"
			fi
			RESUME_STATE="local"
			info "[resume] Local branch ${BRANCH} found, resuming forward release..."
		else
			info "[cleanup] Removed stale local branch, starting fresh..."
			if [[ "$(git branch --show-current 2>/dev/null)" == "$BRANCH" ]]; then
				git checkout "$DEFAULT_BRANCH" 2>/dev/null || true
			fi
			git branch -D "$BRANCH" 2>/dev/null || true
		fi
	fi
fi

ok "Release state: ${RESUME_STATE}"

RELEASE_COMMIT_EXISTS=false
if [[ "$RESUME_STATE" == "local" ]] \
	&& [[ "$(git log -1 --pretty=%s 2>/dev/null)" == "chore(release):"* ]] \
	&& [[ "$(detect_version)" == "$VERSION" ]] \
	&& git diff --quiet --ignore-submodules \
	&& git diff --cached --quiet --ignore-submodules; then
	RELEASE_COMMIT_EXISTS=true
fi

# ---------------------------------------------------------------------------
# Semver comparison (fresh forward releases only)
# ---------------------------------------------------------------------------
if [[ "$RESUME_STATE" == "fresh" && "$RELEASE_MODE" == "forward" && -n "$CURRENT_VERSION" ]]; then
	cmp=$(semver_compare "$VERSION" "$CURRENT_VERSION")
	if [[ "$cmp" == "eq" ]]; then
		if git ls-remote --tags origin "$TAG" 2>/dev/null | grep -q "$TAG"; then
			fail "Already released v${VERSION}"
		fi
		info "Version already at ${VERSION} - resuming incomplete release"
	elif [[ "$cmp" == "lt" ]]; then
		fail "Requested version ${VERSION} is older than current ${CURRENT_VERSION}"
	fi
	ok "Version bump: ${CURRENT_VERSION} -> ${VERSION}"
fi

if [[ ( "$RESUME_STATE" == "fresh" || "$RESUME_STATE" == "local" ) && "$RELEASE_MODE" == "backport" ]]; then
	LINE_TAG=$(git tag --list "releases/v${SV_MAJOR}.${SV_MINOR}.*" --sort=-v:refname | head -1)
	if [[ -n "$LINE_TAG" ]]; then
		LINE_VER="${LINE_TAG#releases/v}"
		line_cmp=$(semver_compare "$VERSION" "$LINE_VER")
		if [[ "$line_cmp" == "eq" ]]; then
			if git ls-remote --tags origin "$TAG" 2>/dev/null | grep -q "$TAG"; then
				fail "Already released v${VERSION} on ${RELEASE_BRANCH}"
			fi
			info "Version already at ${VERSION} on ${RELEASE_BRANCH} - resuming incomplete release"
		elif [[ "$line_cmp" == "lt" ]]; then
			fail "Requested version ${VERSION} is older than latest ${LINE_VER} on ${RELEASE_BRANCH}"
		fi
		ok "Backport bump: ${LINE_VER} -> ${VERSION}"
	fi
fi

# ---------------------------------------------------------------------------
# Submodule ref resolution (fresh releases, stack mode only)
# ---------------------------------------------------------------------------
SUBMODULE_REFS=()

if [[ "$RELEASE_COMMIT_EXISTS" == false ]] \
	&& [[ "$RESUME_STATE" == "fresh" || "$RESUME_STATE" == "local" ]] \
	&& [[ -z "$REPO_DIR" && ${#SUBMODULES[@]} -gt 0 ]]; then
	prompt_suffix=""
	if [[ "$RELEASE_MODE" == "backport" ]]; then
		prompt_suffix=" for backport"
	fi
	for i in "${!SUBMODULES[@]}"; do
		printf "\n  Enter %s tag or commit hash%s (Enter to keep current): " \
			"${SUBMODULES[$i]}" "$prompt_suffix"
		read -r ref
		SUBMODULE_REFS[$i]="$ref"
	done
fi

# ---------------------------------------------------------------------------
# Full validation (fresh releases only)
# ---------------------------------------------------------------------------
if [[ "$RESUME_STATE" == "fresh" || "$RESUME_STATE" == "local" ]]; then
	header "Validating preconditions..."

	if [[ -z "$(git tag --list "$TAG")" ]]; then
		ok "Tag ${TAG} does not exist"
	else
		fail "Tag ${TAG} already exists"
	fi

	SIGNING_KEY=$(git config user.signingkey 2>/dev/null || true)
	if [[ -n "$SIGNING_KEY" ]]; then
		SIGN_FORMAT=$(git config gpg.format 2>/dev/null || echo "openpgp")
		ok "Signing configured (format: ${SIGN_FORMAT})"
	else
		cat >&2 <<-SIGNING
		
		  ${RED}No signing key configured.${RESET}
		
		  Configure GPG signing:
		    git config --global user.signingkey <GPG-KEY-ID>
		
		  Or configure SSH signing:
		    git config --global gpg.format ssh
		    git config --global user.signingkey ~/.ssh/id_ed25519.pub
		
		SIGNING
		fail "Signing key is required for releases"
	fi

	if ! git diff --quiet --ignore-submodules; then
		fail "Working tree has unstaged changes (excluding submodules)"
	fi

	if ! git diff --cached --quiet --ignore-submodules; then
		STAGED_VERSION_ONLY=true
		while IFS= read -r f; do
			case "$f" in
				package.json|package-lock.json|npm-shrinkwrap.json|VERSION) ;;
				*) STAGED_VERSION_ONLY=false; break ;;
			esac
		done < <(git diff --cached --name-only --ignore-submodules)

		if [[ "$STAGED_VERSION_ONLY" == true ]] \
			&& [[ "$(detect_version)" == "$VERSION" ]]; then
			info "Staged version bump to ${VERSION} from previous attempt"
		elif [[ "$ALLOW_STAGED" == true ]]; then
			info "Staged files will be included in the release commit:"
			git diff --cached --name-only --ignore-submodules | while IFS= read -r f; do
				printf "    %s\n" "$f"
			done
		else
			fail "Working tree has staged changes (use --allow-staged to include them)"
		fi
	else
		ok "Working tree is clean (excluding submodules)"
	fi

	# Fresh forward only: must start from up-to-date DEFAULT_BRANCH.
	# Local resume is already on process/v* with a matching release tip.
	if [[ "$RELEASE_MODE" == "forward" && "$RESUME_STATE" == "fresh" ]]; then
		CURRENT_BRANCH=$(git branch --show-current)
		if [[ "$CURRENT_BRANCH" == "$DEFAULT_BRANCH" ]]; then
			ok "On branch ${DEFAULT_BRANCH}"
		else
			fail "Must be on branch ${DEFAULT_BRANCH} (currently on ${CURRENT_BRANCH})"
		fi

		git fetch origin "$DEFAULT_BRANCH" --quiet
		LOCAL_SHA=$(git rev-parse HEAD)
		REMOTE_SHA=$(git rev-parse "origin/${DEFAULT_BRANCH}")
		if [[ "$LOCAL_SHA" == "$REMOTE_SHA" ]]; then
			ok "${DEFAULT_BRANCH} is up to date with origin/${DEFAULT_BRANCH}"
		else
			fail "${DEFAULT_BRANCH} is not up to date with origin/${DEFAULT_BRANCH} (pull or push first)"
		fi
	fi

	if [[ "$RELEASE_COMMIT_EXISTS" == false && "$DRY_RUN" != true \
		&& "$RELEASE_MODE" == "forward" && -z "$REPO_DIR" && ${#SUBMODULES[@]} -gt 0 ]]; then
		header "Resolving submodules..."
		resolve_submodules
	fi
fi

# ---------------------------------------------------------------------------
# Dry run: preview only, no mutations
# ---------------------------------------------------------------------------
if [[ "$DRY_RUN" == true ]]; then
	header "Release notes preview"
	print_release_notes
	printf "\n"
	info "Dry run complete. No changes were made."
	print_summary
	exit 0
fi

# ---------------------------------------------------------------------------
# Fresh Release
# ---------------------------------------------------------------------------
STEP=0

if [[ "$RESUME_STATE" == "fresh" || "$RESUME_STATE" == "local" ]]; then
	if [[ "$RESUME_STATE" == "fresh" ]]; then
		if [[ "$RELEASE_MODE" == "backport" ]]; then
			STEP=$((STEP + 1))
			step $STEP "Prepare release branch ${RELEASE_BRANCH}"
			ensure_release_branch "$RELEASE_BRANCH" "$SV_MAJOR" "$SV_MINOR" "$SV_PATCH"

			STEP=$((STEP + 1))
			step $STEP "Create branch ${BRANCH}"
			git checkout -b "$BRANCH"
			ok "Branch created from ${RELEASE_BRANCH}"

			STEP=$((STEP + 1))
			step $STEP "Cherry-pick commits"
			interactive_cherry_pick "$RELEASE_BRANCH"
		else
			STEP=$((STEP + 1))
			step $STEP "Create branch ${BRANCH}"
			git checkout -b "$BRANCH"
			ok "Branch created"

			if [[ -z "$REPO_DIR" && ${#SUBMODULES[@]} -gt 0 ]]; then
				STEP=$((STEP + 1))
				step $STEP "Update submodule pointers"
				stage_submodules
			fi
		fi
	fi

	if [[ "$RELEASE_COMMIT_EXISTS" == true ]]; then
		info "Release commit already present; skipping version bump and commit"
	else
		if [[ "$RELEASE_MODE" == "backport" && -z "$REPO_DIR" && ${#SUBMODULES[@]} -gt 0 ]]; then
			header "Resolving submodules..."
			resolve_submodules
			STEP=$((STEP + 1))
			step $STEP "Update submodule pointers"
			stage_submodules
		fi
		bump_version "$VERSION"

		STEP=$((STEP + 1))
		step $STEP "Preview release notes"
		print_release_notes

		STEP=$((STEP + 1))
		step $STEP "Commit release"
		if git diff --cached --quiet; then
			info "Nothing staged - creating empty release marker commit"
			git commit --allow-empty -m "chore(release): v${VERSION}"
		else
			git commit -m "chore(release): v${VERSION}"
		fi
		ok "Committed chore(release): v${VERSION}"
	fi
fi

# ---------------------------------------------------------------------------
# Push + PR (fresh or resume from "pr")
# ---------------------------------------------------------------------------
if [[ "$RESUME_STATE" == "fresh" || "$RESUME_STATE" == "local" || "$RESUME_STATE" == "pr" ]]; then
	STEP=$((STEP + 1))
	step $STEP "Push branch and create PR"

	if [[ "$RESUME_STATE" == "fresh" || "$RESUME_STATE" == "local" ]]; then
		git push -u origin "$BRANCH"
		ok "Branch pushed to origin"
	fi

	compile_changelog

	ensure_label "release"

	# Only apply labels that already exist in the repo (plus 'release')
	EXISTING_LABELS=$(gh label list --limit 200 --json name --jq '.[].name' 2>/dev/null || true)

	PR_CREATE_ARGS=(
		--title "chore(release): v${VERSION}"
		--body "$CHANGELOG"
		--base "$PR_BASE"
		--head "$BRANCH"
		--assignee "@me"
	)
	while IFS= read -r label; do
		[[ -z "$label" ]] && continue
		if [[ "$label" == "release" ]] || printf '%s\n' "$EXISTING_LABELS" | grep -qxF "$label"; then
			PR_CREATE_ARGS+=(--label "$label")
		fi
	done < <({ printf 'release\n'; printf '%s\n' "${RELEASE_LABELS:-}"; } | sort -u)

	PR_URL=$(gh pr create "${PR_CREATE_ARGS[@]}")
	PR_NUMBER="${PR_URL##*/}"
	ok "PR #${PR_NUMBER} created: ${PR_URL}"
fi

# ---------------------------------------------------------------------------
# Poll for merge
# ---------------------------------------------------------------------------
if [[ "$RESUME_STATE" == "fresh" || "$RESUME_STATE" == "local" || "$RESUME_STATE" == "pr" || "$RESUME_STATE" == "poll" ]]; then
	STEP=$((STEP + 1))
	step $STEP "Wait for PR merge"
	poll_pr "$PR_NUMBER"
fi

# ---------------------------------------------------------------------------
# Tag and push
# ---------------------------------------------------------------------------
STEP=$((STEP + 1))
step $STEP "Return to ${PR_BASE}"
git fetch origin "$PR_BASE" --quiet
git checkout "$PR_BASE"
git pull origin "$PR_BASE" --quiet
ok "On ${PR_BASE} at $(git rev-parse --short HEAD)"

STEP=$((STEP + 1))
step $STEP "Create signed tag"
if [[ -n "$(git tag --list "$TAG")" ]]; then
	ok "Tag ${TAG} already exists locally - skipping creation"
else
	compile_changelog
	git tag -s -a "$TAG" -m "$CHANGELOG"
	ok "Tag ${TAG} created (signed)"
fi

STEP=$((STEP + 1))
step $STEP "Push tag"
git push origin "$TAG"
ok "Tag pushed to origin"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
header "Release complete!"
print_summary
