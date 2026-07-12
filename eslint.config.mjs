import { defineConfig } from "eslint/config";
import base from "./eslint/base.mjs";

export default defineConfig(...base, {
	files: ["scripts/**/*.mjs"],
	languageOptions: {
		globals: {
			console: "readonly",
			process: "readonly",
		},
	},
});
