/**
 * Shared ESLint base for TypeScript projects.
 * Spread into eslint.config.mjs: defineConfig(...base).
 */
import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";

const base = [
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	...tseslint.configs.stylistic,
	prettier,
	{
		ignores: ["**/dist/", "**/node_modules/"],
	},
	{
		plugins: {
			import: importPlugin,
		},
		rules: {
			"@typescript-eslint/consistent-type-assertions": [
				"error",
				{ assertionStyle: "never" },
			],
			"@typescript-eslint/consistent-type-imports": [
				"error",
				{ prefer: "type-imports", fixStyle: "separate-type-imports" },
			],
			"@typescript-eslint/no-import-type-side-effects": "error",
			"@typescript-eslint/no-non-null-assertion": "error",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],
			"import/consistent-type-specifier-style": [
				"error",
				"prefer-top-level",
			],
			curly: ["error", "all"],
			eqeqeq: ["error", "always"],
			"no-var": "error",
			"object-shorthand": "error",
			"prefer-const": "error",
			"no-restricted-syntax": [
				"error",
				{
					selector: "CallExpression[callee.property.name='then']",
					message: "Prefer async/await over .then() chains.",
				},
				{
					selector: "CallExpression[callee.property.name='forEach']",
					message: "Prefer for...of over .forEach().",
				},
				{
					selector: "ConditionalExpression",
					message: "Prefer if/else over ternary expressions.",
				},
			],
		},
	},
];

export default base;
