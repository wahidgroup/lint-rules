import { defineConfig } from "vitest/config";

export default defineConfig({
	cacheDir: ".vitest-cache",
	test: {
		include: ["src/**/*.test.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "cobertura"],
			reportsDirectory: "coverage",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts"],
		},
	},
});
