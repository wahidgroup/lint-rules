# @wahidgroup/lint-rules

Shared ESLint flat configs, Prettier, TypeScript, EditorConfig, and CSpell for TypeScript projects.

## Install

GitHub Packages (scoped). In project `.npmrc`:

```ini
@wahidgroup:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```bash
npm install --save-dev @wahidgroup/lint-rules
```

**Required peers:** `eslint` (>=9), `typescript` (>=5).  
**Optional peer:** `prettier` (>=3) — only if you use the Prettier export.

Framework exports need matching **optional peers** (not installed by default). Ranges allow compatible minors; this repo pins the tested floors in `devDependencies`:

| Export              | Also install                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `eslint/react`      | `eslint-plugin-react-hooks@^7.1.1` `eslint-plugin-jsx-a11y@^6.10.2` |
| `eslint/nestjs`     | `@darraghor/eslint-plugin-nestjs-typed@^7.2.4`                      |
| `eslint/playwright` | `eslint-plugin-playwright@^2.10.4`                                  |

```bash
# React
npm install --save-dev eslint-plugin-react-hooks@^7.1.1 eslint-plugin-jsx-a11y@^6.10.2

# NestJS
npm install --save-dev @darraghor/eslint-plugin-nestjs-typed@^7.2.4

# Playwright
npm install --save-dev eslint-plugin-playwright@^2.10.4
```

## Quick start

| Project type     | Compose                                   |
| ---------------- | ----------------------------------------- |
| TypeScript only  | `...base`                                 |
| React            | `...base, ...react`                       |
| NestJS           | `...base, ...nestjs` (+ `projectService`) |
| Playwright       | `...base, ...playwright`                  |
| Typed lint (any) | `...base, ...strict` (+ `projectService`) |

## ESLint

Composable flat-config arrays. Spread into `eslint.config.mjs`.

### Base

`@eslint/js` recommended, `typescript-eslint` recommended + stylistic, `eslint-config-prettier`, `eslint-plugin-import`.

```javascript
import { defineConfig } from "eslint/config";
import base from "@wahidgroup/lint-rules/eslint/base";

export default defineConfig(...base);
```

**House rules (on top of presets):**

| Rule                                     | Effect                                  |
| ---------------------------------------- | --------------------------------------- |
| `consistent-type-assertions`             | Disallows `as` assertions               |
| `consistent-type-imports`                | Requires separate `import type`         |
| `no-import-type-side-effects`            | Type imports must be erasable           |
| `no-non-null-assertion`                  | Disallows `!`                           |
| `no-unused-vars`                         | Errors unused vars (ignores `_` prefix) |
| `import/consistent-type-specifier-style` | Prefer top-level type specifiers        |
| `curly`                                  | Braces on all `if`/`else`               |
| `eqeqeq`                                 | Always `===` / `!==`                    |
| `no-var`                                 | Ban `var`                               |
| `prefer-const`                           | Prefer `const`                          |
| `object-shorthand`                       | Prefer `{ x }` over `{ x: x }`          |
| `no-restricted-syntax`                   | Ban `.then()`, `.forEach()`, ternaries  |

### Strict (typed linting)

`recommendedTypeChecked` + `stylisticTypeChecked`. Opt-in: slower, catches floating promises, unsafe any flow, misused promises, and related type-aware bugs.

Requires `parserOptions.projectService` and `tsconfigRootDir`:

```javascript
import { defineConfig } from "eslint/config";
import base from "@wahidgroup/lint-rules/eslint/base";
import strict from "@wahidgroup/lint-rules/eslint/strict";

export default defineConfig(...base, ...strict, {
	languageOptions: {
		parserOptions: {
			projectService: true,
			tsconfigRootDir: import.meta.dirname,
		},
	},
});
```

Notable typed rules from the presets: `no-floating-promises`, `no-misused-promises`, `await-thenable`, `only-throw-error`, `no-unsafe-*`, `require-await`, `restrict-template-expressions`, `unbound-method`.

### React

Requires optional peers (see [Install](#install)). `eslint-plugin-jsx-a11y` recommended and `eslint-plugin-react-hooks` flat recommended (hooks + React Compiler rules). Ignores `*.d.ts` for these React rules only.

```javascript
import { defineConfig } from "eslint/config";
import base from "@wahidgroup/lint-rules/eslint/base";
import react from "@wahidgroup/lint-rules/eslint/react";

export default defineConfig(...base, ...react);
```

### NestJS

Requires optional peer `@darraghor/eslint-plugin-nestjs-typed` (see [Install](#install)). Recommended preset with overrides: one false-positive fix (`injectable-should-be-provided` for dynamic modules) plus two policy offs (array `isArray` style, mandatory `@ApiResponse`). Typed plugin needs `projectService`. Optionally also spread `...strict`.

```javascript
import { defineConfig } from "eslint/config";
import base from "@wahidgroup/lint-rules/eslint/base";
import nestjs from "@wahidgroup/lint-rules/eslint/nestjs";

export default defineConfig(...base, ...nestjs, {
	languageOptions: {
		parserOptions: {
			projectService: {
				allowDefaultProject: ["eslint.config.mjs"],
			},
			tsconfigRootDir: import.meta.dirname,
		},
	},
});
```

### Playwright

Requires optional peer `eslint-plugin-playwright` (see [Install](#install)). Recommended preset plus stricter test-quality rules.

```javascript
import { defineConfig } from "eslint/config";
import base from "@wahidgroup/lint-rules/eslint/base";
import playwright from "@wahidgroup/lint-rules/eslint/playwright";

export default defineConfig(...base, ...playwright, {
	ignores: ["test-results/", "playwright-report/", "blob-report/"],
});
```

| Rule                          | Level |
| ----------------------------- | ----- |
| `no-conditional-in-test`      | error |
| `no-force-option`             | error |
| `no-page-pause`               | error |
| `no-wait-for-timeout`         | warn  |
| `prefer-to-have-count`        | error |
| `prefer-to-have-length`       | error |
| `prefer-web-first-assertions` | error |

## Prettier

Hard tabs, tab width 4. Other options use Prettier defaults (double quotes, semicolons, trailing commas `"all"`, print width 80). YAML overrides: spaces, width 2.

```javascript
export { default } from "@wahidgroup/lint-rules/prettier";
```

## TypeScript

Shared `compilerOptions`: ES2024, `strict`, bundler resolution, React JSX. Extra flags beyond `strict`:

| Option                       | Effect                                 |
| ---------------------------- | -------------------------------------- |
| `noImplicitOverride`         | Require `override` on subclass methods |
| `noFallthroughCasesInSwitch` | Ban switch fallthrough                 |
| `noUncheckedIndexedAccess`   | Index access includes `undefined`      |

```json
{
	"extends": "@wahidgroup/lint-rules/tsconfig",
	"compilerOptions": {
		"paths": { "@/*": ["./src/*"] }
	},
	"include": ["src"],
	"exclude": ["node_modules", "dist"]
}
```

## EditorConfig

Shipped as `.editorconfig`. Copy into project root, or pull from the package:

```bash
cp node_modules/@wahidgroup/lint-rules/.editorconfig .editorconfig
```

Enforces:

- UTF-8, LF, final newline, trim trailing whitespace
- Hard tabs, indent size 4
- YAML: spaces, indent size 2
- Markdown: keep trailing whitespace

## CSpell

```json
{
	"import": ["@wahidgroup/lint-rules/cspell"],
	"words": ["project-specific-words"],
	"ignorePaths": ["project-specific-paths"]
}
```

## Development

```bash
make help              # Usage (default)
make version           # Package version + git commit
make setup             # Install dependencies
make lint              # Format check, ESLint, spellcheck
make lint fix=1        # Auto-fix format + ESLint
make spellcheck        # CSpell only
make smoke             # Import every public export
make pack              # Assert npm pack matches files (+ SBOM)
make sbom              # Generate CycloneDX SBOM
make audit             # Security audit
make audit fix=1       # npm audit fix
make ci                # lint + smoke + pack
make clean             # Remove artifacts + node_modules
```

## Releasing

Publish to **GitHub Packages** (`npm.pkg.github.com`) via `GITHUB_TOKEN`. Tag `releases/v*` runs CI, publishes, and attaches `sbom.json` to the GitHub Release.

```bash
make release version=v0.1.0                  # Full release workflow
make release version=v0.1.0 dry-run=1        # Preview without changes
make release version=v0.1.0 allow-staged=1   # Include staged files
make release yank=1                          # Yank a published version
```
