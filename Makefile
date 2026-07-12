.PHONY: help help-body help-ref version setup lint spellcheck smoke audit ci release clean

.DEFAULT_GOAL := help

PROJECT := lint-rules
PKG_VERSION := $(shell node -p "require('./package.json').version" 2>/dev/null)
GIT_COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null)
GIT_DIRTY := $(shell test -n "$$(git status --porcelain 2>/dev/null)" && echo "+dirty")

# Print wrapper (pager for long help)
define PRINT_PAGER
@{ $(1); } | less -FRX
endef

# lint / audit: enable fix mode with fix=1
ifneq ($(strip $(fix)),)
LINT_MODE := fix
else
LINT_MODE := check
endif

AUDIT_MODE := $(LINT_MODE)

# release: make release VERSION=v0.1.0 dry-run=1 allow-staged=1
#          make release yank=1
RELEASE_FLAGS :=
ifneq ($(filter 1,$(dry-run)),)
RELEASE_FLAGS += --dry-run
endif
ifneq ($(filter 1,$(allow-staged)),)
RELEASE_FLAGS += --allow-staged
endif
ifneq ($(filter 1,$(yank)),)
RELEASE_FLAGS += --yank
endif

# CI uses npm ci (lockfile-strict); local uses npm install
ifdef CI
NPM_INSTALL_CMD := npm ci
else
NPM_INSTALL_CMD := npm install
endif

help:
	$(call PRINT_PAGER,$(MAKE) help-body)

help-body:
	@printf 'USAGE:\n'
	@printf '    make <target> [fix=1] [VERSION=vX.Y.Z] [dry-run=1] [allow-staged=1] [yank=1]\n\n'
	@printf 'DESCRIPTION:\n'
	@printf '    Build, lint, and release %s following POSIX/GNU CLI conventions.\n\n' '$(PROJECT)'
	@printf 'TARGETS:\n'
	@printf '    help         Show this help and exit\n'
	@printf '    help-ref     Show reference documentation links\n'
	@printf '    version      Show project version information\n'
	@printf '    setup        Install dependencies\n'
	@printf '    lint         Run linters + spellcheck (fix mode via fix=1)\n'
	@printf '    spellcheck   Run spell checker\n'
	@printf '    smoke        Import every public export\n'
	@printf '    audit        Run security audit (fix mode via fix=1)\n'
	@printf '    ci           Lint + smoke\n'
	@printf '    release      Release workflow (see OPTIONS)\n'
	@printf '    clean        Remove build artifacts\n\n'
	@printf 'OPTIONS / VARIABLES:\n'
	@printf '    fix            If set (e.g., fix=1), apply lint/audit fixes\n'
	@printf '    VERSION        Release version (e.g., VERSION=v0.1.0)\n'
	@printf '    dry-run        If set (e.g., dry-run=1), preview release without changes\n'
	@printf '    allow-staged   If set (e.g., allow-staged=1), include staged files in release\n'
	@printf '    yank           If set (e.g., yank=1), yank a published version\n'
	@printf '    NPM_INSTALL_FLAGS  Extra flags for npm install/ci (e.g. --ignore-scripts)\n\n'
	@printf 'EXAMPLES:\n'
	@printf '    make setup\n'
	@printf '    make lint\n'
	@printf '    make lint fix=1\n'
	@printf '    make audit fix=1\n'
	@printf '    make release VERSION=v0.1.0\n'
	@printf '    make release VERSION=v0.1.0 dry-run=1\n'
	@printf '    make release VERSION=v0.1.0 allow-staged=1\n'
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

node_modules: package.json package-lock.json
	$(NPM_INSTALL_CMD) $(NPM_INSTALL_FLAGS)
	@touch $@

setup: node_modules

lint: node_modules
	@echo "Running linters (mode: $(LINT_MODE))..."
ifeq ($(LINT_MODE),fix)
	npm run format
	npm run lint -- --fix
else
	npm run format:check
	npm run lint
endif
	npm run spellcheck

spellcheck: node_modules
	@echo "Checking spelling..."
	npm run spellcheck

smoke: node_modules
	@echo "Smoke-loading public exports..."
	npm run smoke

audit: node_modules
	@echo "Running security audit (mode: $(AUDIT_MODE))..."
ifeq ($(AUDIT_MODE),fix)
	npm audit fix
else
	npm audit --audit-level=high
endif

ci: lint smoke

release: node_modules
	@./scripts/release.sh "$(VERSION)" $(RELEASE_FLAGS)

clean:
	rm -rf node_modules
