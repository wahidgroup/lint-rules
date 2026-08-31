.PHONY: all help help-body help-ref version setup lint spellcheck build test smoke verify sbom audit ci release clean

.NOTPARALLEL: all ci

.DEFAULT_GOAL := all

PROJECT := lint-rules
PKG_VERSION := $(shell node -p "require('./package.json').version" 2>/dev/null)
GIT_COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null)
GIT_DIRTY := $(shell test -n "$$(git status --porcelain 2>/dev/null)" && echo "+dirty")

define PRINT_PAGER
@{ $(1); } | less -FRX
endef

ifneq ($(filter 1,$(fix)),)
LINT_MODE := fix
else
LINT_MODE := check
endif

AUDIT_MODE := $(LINT_MODE)

RELEASE_VERSION := $(version)

ifdef CI
NPM_INSTALL_CMD := npm ci
else
NPM_INSTALL_CMD := npm install
endif

export TMPDIR := $(CURDIR)/.tmp

.tmp:
	mkdir -p "$(TMPDIR)"

help:
	$(call PRINT_PAGER,$(MAKE) help-body)

help-body:
	@printf 'USAGE:\n'
	@printf '    make <target> [fix=1] [version=vX.Y.Z] [dry-run=1] [allow-staged=1] [yank=1]\n\n'
	@printf 'DESCRIPTION:\n'
	@printf '    Build, lint, and release %s following POSIX/GNU CLI conventions.\n\n' '$(PROJECT)'
	@printf 'TARGETS:\n'
	@printf '    all          Setup, build, test, and verify (default)\n'
	@printf '    help         Show this help and exit\n'
	@printf '    help-ref     Show reference documentation links\n'
	@printf '    version      Show project version information\n'
	@printf '    setup        Install dependencies\n'
	@printf '    lint         Run linters + spellcheck (fix mode via fix=1)\n'
	@printf '    spellcheck   Run spell checker\n'
	@printf '    build        Compile package verification tooling\n'
	@printf '    test         Run package verification tests\n'
	@printf '    smoke        Import every public export\n'
	@printf '    verify       Pack, audit exports, peers, and isolated imports\n'
	@printf '    sbom         Generate software bill of materials\n'
	@printf '    audit        Run security audit (fix mode via fix=1)\n'
	@printf '    ci           Lint + test + verify\n'
	@printf '    release      Release workflow (see OPTIONS)\n'
	@printf '    clean        Remove artifacts and node_modules\n\n'
	@printf 'OPTIONS / VARIABLES:\n'
	@printf '    fix                If set (e.g., fix=1), apply lint/audit fixes\n'
	@printf '    version            Release version (e.g., version=v0.1.0)\n'
	@printf '    dry-run            If set (e.g., dry-run=1), preview release without changes\n'
	@printf '    allow-staged       If set (e.g., allow-staged=1), include staged files in release\n'
	@printf '    yank               If set (e.g., yank=1), yank a published version\n'
	@printf '    NPM_INSTALL_FLAGS  Extra flags for npm install/ci (e.g. --ignore-scripts)\n'
	@printf '    CI                 If set (CI=true), setup.sh uses npm ci\n\n'
	@printf 'EXAMPLES:\n'
	@printf '    make\n'
	@printf '    make all\n'
	@printf '    make setup\n'
	@printf '    make lint\n'
	@printf '    make lint fix=1\n'
	@printf '    make audit fix=1\n'
	@printf '    make release version=v0.1.0\n'
	@printf '    make release version=v0.1.0 dry-run=1\n'
	@printf '    make release version=v0.1.0 allow-staged=1\n'
	@printf '    make release yank=1\n\n'
	@printf 'EXIT STATUS:\n'
	@printf '    0    Success\n'
	@printf '    >0   Error occurred\n\n'

help-ref:
	@printf 'REFERENCES:\n'
	@printf '    GNU CLI Guidelines: https://www.gnu.org/prep/standards/html_node/Command_002dLine-Interfaces.html\n'
	@printf '    POSIX Utility Syntax: https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap12.html\n'
	@printf '    GNU Make Goals: https://www.gnu.org/software/make/manual/html_node/Goals.html\n\n'

version:
	@v='$(PKG_VERSION)'; c='$(GIT_COMMIT)'; d='$(GIT_DIRTY)'; [ -n "$$v" ] || v=unknown; \
	printf '%s %s (%s%s)\n' '$(PROJECT)' "$$v" "$$c" "$$d"

setup: .tmp
	@chmod +x scripts/setup.sh
	@NPM_INSTALL_FLAGS="$(NPM_INSTALL_FLAGS)" ./scripts/setup.sh

all:
	$(MAKE) setup
	$(MAKE) build
	$(MAKE) test
	$(MAKE) verify

lint: setup .tmp
	@echo "Running linters (mode: $(LINT_MODE))..."
ifeq ($(LINT_MODE),fix)
	npm run format
	npm run lint -- --fix
else
	npm run format:check
	npm run lint
endif
	for script in .husky/pre-push scripts/*.sh; do bash -n "$$script" || exit; done
	npm run spellcheck

spellcheck: setup
	@echo "Checking spelling..."
	npm run spellcheck

smoke: build
	@echo "Smoke-loading public exports..."
	npm run smoke

build: setup
	@echo "Building package verification tooling..."
	rm -rf dist
	npm run build

test: setup .tmp
	@echo "Running package verification tests..."
	npm run test

sbom: setup
	@echo "Generating SBOM..."
	npm run sbom

verify: build sbom .tmp
	@echo "Verifying package exports, pins, and isolated imports..."
	@rm -rf .package-verification
	@trap 'rm -rf .package-verification' EXIT; \
		./node_modules/.bin/tsc --project scripts/tsconfig.json --outDir .package-verification && \
		node .package-verification/verify-package.js

audit: setup
	@echo "Running security audit (mode: $(AUDIT_MODE))..."
ifeq ($(AUDIT_MODE),fix)
	npm audit fix
else
	npm audit --audit-level=high
endif

ci:
	$(MAKE) lint
	$(MAKE) test
	$(MAKE) verify

release: setup
	@DRY_RUN="$(if $(filter 1,$(dry-run)),1,)" \
		ALLOW_STAGED="$(if $(filter 1,$(allow-staged)),1,)" \
		YANK="$(if $(filter 1,$(yank)),1,)" \
		./scripts/release.sh "$(RELEASE_VERSION)"

clean:
	rm -rf node_modules sbom.json .make dist .package-verification .tmp
