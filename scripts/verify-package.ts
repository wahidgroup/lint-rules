import process from "node:process";

import { ImportCaseBuilder, PackageVerificationHarnessBuilder } from "../dist/package-verification/index.js";

const configurationImports = ImportCaseBuilder.create("configuration-imports")
	.exports("./package.json", "./cspell", "./prettier", "./tsconfig", "./eslint/base", "./eslint/strict")
	.node()
	.requiredPeers()
	.build();

const reactImports = ImportCaseBuilder.create("react-imports")
	.exports("./eslint/react")
	.node()
	.explicitPeers("eslint", "typescript", "eslint-plugin-react-hooks", "eslint-plugin-jsx-a11y")
	.build();

const nestjsImports = ImportCaseBuilder.create("nestjs-imports")
	.exports("./eslint/nestjs")
	.node()
	.explicitPeers("eslint", "typescript", "@darraghor/eslint-plugin-nestjs-typed")
	.build();

const playwrightImports = ImportCaseBuilder.create("playwright-imports")
	.exports("./eslint/playwright")
	.node()
	.explicitPeers("eslint", "typescript", "eslint-plugin-playwright")
	.build();

const verificationImports = ImportCaseBuilder.create("verification-imports")
	.exports("./package-verification")
	.node()
	.requiredPeers()
	.build();

const harness = PackageVerificationHarnessBuilder.create()
	.projectDirectory(process.cwd())
	.temporaryDirectoryPrefix("lint-rules-package-")
	.verifiedArchiveDirectory(process.env.VERIFIED_ARCHIVE_DIRECTORY)
	.expectedVersion(process.env.EXPECTED_VERSION)
	.exportTargetPrefixes("./", "./dist/")
	.verifyTarballName(true)
	.verifyNodeEngineCap(true)
	.exactExportKeys(
		"./package.json",
		"./eslint/base",
		"./eslint/react",
		"./eslint/nestjs",
		"./eslint/playwright",
		"./eslint/strict",
		"./prettier",
		"./tsconfig",
		"./cspell",
		"./editorconfig",
		"./package-verification",
	)
	.forbidPathPrefix(".package-verification/")
	.forbidPathPrefix(".tmp/")
	.forbidPathPrefix(".cursor/")
	.forbidPathPrefix(".github/")
	.forbidPathPrefix(".husky/")
	.forbidPathPrefix("docs/")
	.forbidPathPrefix("scripts/")
	.forbidPathPrefix("src/")
	.forbidPathPrefix("tests/")
	.forbidExactPath(".gitattributes")
	.forbidExactPath(".gitignore")
	.forbidExactPath(".npmrc")
	.forbidExactPath(".nvmrc")
	.forbidExactPath(".prettierignore")
	.forbidExactPath("Makefile")
	.forbidExactPath("eslint.config.mjs")
	.forbidExactPath("package-lock.json")
	.forbidExactPath("prettier.config.mjs")
	.forbidExactPath("tsconfig.build.json")
	.forbidExactPath("tsconfig.json")
	.forbidExactPath("vitest.config.ts")
	.importGraph({
		directories: ["dist/package-verification"],
		dynamicDependencies: [],
		entry: "dist/package-verification/index.js",
		files: [],
		name: "package-verification",
		staticDependencies: ["node:assert/strict", "node:child_process", "node:fs", "node:path", "node:process"],
	})
	.importCase(configurationImports)
	.importCase(reactImports)
	.importCase(nestjsImports)
	.importCase(playwrightImports)
	.importCase(verificationImports)
	.build();

harness.verify();
process.stdout.write("Package verification passed.\n");
