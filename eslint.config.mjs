import { defineConfig } from "eslint/config";
import base from "./eslint/base.mjs";

export default defineConfig(
	...base,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["vitest.config.ts"],
				},
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-empty-function": ["error", { allow: ["private-constructors"] }],
		},
	},
	{
		files: ["scripts/**/*.mjs"],
		languageOptions: {
			globals: {
				console: "readonly",
				process: "readonly",
			},
		},
	},
);
