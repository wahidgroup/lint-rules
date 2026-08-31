import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
	ImportCaseBuilder,
	PackageVerificationError,
	PackageVerificationHarness,
	PackageVerificationHarnessBuilder,
} from "./index.js";
import { NpmCommandEnvironment } from "./npm-command-environment.js";

interface FixtureFile {
	readonly content: string;
	readonly path: string;
}

interface FixturePackage {
	readonly devDependencies?: Readonly<Record<string, string>>;
	readonly engines?: Readonly<Record<string, string>>;
	readonly extraPackFiles?: readonly string[];
	readonly files: readonly FixtureFile[];
	readonly lockfile?: unknown;
	readonly name: string;
	readonly packageExports: unknown;
	readonly peerDependencies?: Readonly<Record<string, string>>;
	readonly peerDependenciesMeta?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/**
 * Owns real package fixtures and temporary workspace cleanup.
 */
class PackageVerificationRegressionHarness {
	/**
	 * Contains every package fixture for one test.
	 */
	readonly #rootDirectory = NpmCommandEnvironment.createLifecycleDirectory(process.cwd(), "ts-lint-verification-");

	/**
	 * Identifies the locally installed TypeScript package.
	 */
	readonly #typescriptDirectory = resolve("node_modules/typescript");

	/**
	 * Removes every fixture created by the current test.
	 */
	dispose(): void {
		rmSync(this.#rootDirectory, { force: true, recursive: true });
	}

	/**
	 * Creates one real package directory consumed by npm pack.
	 */
	createPackage(fixture: FixturePackage): string {
		const projectDirectory = join(this.#rootDirectory, fixture.name);
		mkdirSync(projectDirectory);

		const filePaths: string[] = [];
		for (const file of fixture.files) {
			const destination = join(projectDirectory, file.path);
			mkdirSync(dirname(destination), { recursive: true });
			writeFileSync(destination, file.content);
			filePaths.push(file.path);
		}

		const packFiles = [...filePaths, ...(fixture.extraPackFiles ?? [])];
		const manifest = {
			devDependencies: fixture.devDependencies,
			engines: fixture.engines,
			exports: fixture.packageExports,
			files: packFiles,
			name: fixture.name,
			peerDependencies: fixture.peerDependencies,
			peerDependenciesMeta: fixture.peerDependenciesMeta,
			type: "module",
			version: "1.0.0",
		};

		writeFileSync(join(projectDirectory, "package.json"), JSON.stringify(manifest));
		if (fixture.lockfile !== undefined) {
			writeFileSync(join(projectDirectory, "package-lock.json"), JSON.stringify(fixture.lockfile));
		}

		return projectDirectory;
	}

	/**
	 * Creates a verifier for one real package fixture.
	 */
	createVerifier(projectDirectory: string): PackageVerificationHarness {
		const verifier = PackageVerificationHarnessBuilder.create().projectDirectory(projectDirectory).build();
		return verifier;
	}

	/**
	 * Returns a collision-resistant temporary lifecycle prefix.
	 */
	createTemporaryPrefix(label: string): string {
		const prefix = `ts-lint-${process.pid}-${Date.now()}-${label}-`;
		return prefix;
	}

	/**
	 * Lists lifecycle directories matching one test prefix under a package.
	 */
	findTemporaryDirectories(projectDirectory: string, prefix: string): readonly string[] {
		const root = join(projectDirectory, ".tmp");
		const matches: string[] = [];
		if (!existsSync(root)) {
			return matches;
		}

		for (const entry of readdirSync(root)) {
			if (entry.startsWith(prefix)) {
				matches.push(entry);
			}
		}

		return matches;
	}

	/**
	 * Returns a local file dependency for generated TypeScript compilation.
	 */
	typescriptDependency(): string {
		const dependency = `file:${this.#typescriptDirectory}`;
		return dependency;
	}
}

describe("package verification public API", () => {
	let regression: PackageVerificationRegressionHarness;

	beforeEach(() => {
		regression = new PackageVerificationRegressionHarness();
	});

	afterEach(() => {
		regression.dispose();
	});

	test("audits every target in nested export arrays", () => {
		const projectDirectory = regression.createPackage({
			files: [
				{
					content: "export const primary = true;\n",
					path: "primary.js",
				},
				{
					content: "export const fallback = true;\n",
					path: "fallback.js",
				},
			],
			name: "export-array-fixture",
			packageExports: {
				".": ["./primary.js", { default: "./fallback.js" }],
			},
		});

		const verifier = regression.createVerifier(projectDirectory);
		expect(() => verifier.verify()).not.toThrow();
	});

	test("rejects a missing target in an export array", () => {
		const projectDirectory = regression.createPackage({
			files: [
				{
					content: "export const primary = true;\n",
					path: "primary.js",
				},
			],
			name: "missing-export-fixture",
			packageExports: {
				".": ["./primary.js", "./missing.js"],
			},
		});

		const verifier = regression.createVerifier(projectDirectory);
		expect(() => verifier.verify()).toThrow("Missing packed export: missing.js");
	});

	test("rejects unsupported export target types", () => {
		const projectDirectory = regression.createPackage({
			files: [{ content: "export const value = true;\n", path: "index.js" }],
			name: "unsupported-export-fixture",
			packageExports: {
				".": ["./index.js", true],
			},
		});

		const verifier = regression.createVerifier(projectDirectory);
		expect(() => verifier.verify()).toThrow("Unsupported package export target type: boolean");
	});

	test("preserves package builder state after a failed replacement", () => {
		const projectDirectory = regression.createPackage({
			files: [{ content: "export const value = true;\n", path: "index.js" }],
			name: "atomic-harness-builder-fixture",
			packageExports: {
				".": "./index.js",
			},
		});

		const builder = PackageVerificationHarnessBuilder.create()
			.projectDirectory(projectDirectory)
			.exportTargetPrefixes("./");

		expect(() => builder.exportTargetPrefixes("./dist/", "invalid")).toThrow(
			"Export target prefix must start with ./: invalid",
		);

		const verifier = builder.build();
		expect(() => verifier.verify()).not.toThrow();
	});

	test("preserves import case state after failed updates", () => {
		const importCaseBuilder = ImportCaseBuilder.create("atomic-import").exports("./entry").allPeers();
		expect(() => importCaseBuilder.exports(".", "invalid")).toThrow("Invalid package export key: invalid");
		expect(() => importCaseBuilder.explicitPeers("typescript", "")).toThrow("Peer must not be empty");

		const importCase = importCaseBuilder.browser().build();
		expect(importCase.exportKeys).toEqual(["./entry"]);
		expect(importCase.peerSelection).toBe("all");
		expect(importCase.peers).toEqual([]);

		const environmentBuilder = ImportCaseBuilder.create("atomic-environment");
		expect(() => environmentBuilder.react("@types/react", "")).toThrow("React type package must not be empty");

		const browserCase = environmentBuilder.browser().exports(".").build();
		expect(browserCase.environment).toBe("browser");
		expect(browserCase.reactTypePackages).toEqual([]);
	});

	test("uses browser conditions for generated TypeScript consumers", () => {
		const projectDirectory = regression.createPackage({
			devDependencies: {
				typescript: regression.typescriptDependency(),
			},
			files: [
				{ content: "export const value = true;\n", path: "index.js" },
				{
					content: "export declare const value: boolean;\n",
					path: "browser.d.ts",
				},
				{
					content: "export declare const value: MissingDefaultType;\n",
					path: "invalid.d.ts",
				},
			],
			name: "browser-condition-fixture",
			packageExports: {
				".": {
					import: "./index.js",
					types: {
						browser: "./browser.d.ts",
						default: "./invalid.d.ts",
					},
				},
			},
		});

		const importCase = ImportCaseBuilder.create("browser-condition").exports(".").browser().noPeers().build();
		const verifier = PackageVerificationHarnessBuilder.create()
			.projectDirectory(projectDirectory)
			.importCase(importCase)
			.build();

		expect(() => verifier.verify()).not.toThrow();
	});

	test("audits an allowed import graph from its configured entry", () => {
		const projectDirectory = regression.createPackage({
			files: [
				{
					content: 'import { value } from "./dependency.js";\nexport { value };\n',
					path: "dist/index.js",
				},
				{
					content: "export const value = true;\n",
					path: "dist/dependency.js",
				},
			],
			name: "allowed-import-graph-fixture",
			packageExports: {
				".": "./dist/index.js",
			},
		});
		const verifier = PackageVerificationHarnessBuilder.create()
			.projectDirectory(projectDirectory)
			.importGraph({
				directories: ["dist"],
				dynamicDependencies: [],
				entry: "dist/index.js",
				files: [],
				name: "allowed",
				staticDependencies: [],
			})
			.build();

		expect(() => verifier.verify()).not.toThrow();
	});

	test("rejects unresolved relative import graph edges", () => {
		const projectDirectory = regression.createPackage({
			files: [
				{
					content: 'export { missing } from "./missing.js";\n',
					path: "dist/index.js",
				},
			],
			name: "unresolved-import-graph-fixture",
			packageExports: {
				".": "./dist/index.js",
			},
		});
		const verifier = PackageVerificationHarnessBuilder.create()
			.projectDirectory(projectDirectory)
			.importGraph({
				directories: ["dist"],
				dynamicDependencies: [],
				entry: "dist/index.js",
				files: [],
				name: "unresolved",
				staticDependencies: [],
			})
			.build();

		expect(() => verifier.verify()).toThrow(
			'Unresolved unresolved relative static import or export "./missing.js" from dist/index.js',
		);
	});

	test("rejects dynamic imports with multiple arguments", () => {
		const projectDirectory = regression.createPackage({
			files: [
				{
					content: 'void import("./dependency.js", { with: { type: "json" } });\n',
					path: "dist/index.js",
				},
				{
					content: "export const value = true;\n",
					path: "dist/dependency.js",
				},
			],
			name: "multi-argument-import-graph-fixture",
			packageExports: {
				".": "./dist/index.js",
			},
		});
		const verifier = PackageVerificationHarnessBuilder.create()
			.projectDirectory(projectDirectory)
			.importGraph({
				directories: ["dist"],
				dynamicDependencies: [],
				entry: "dist/index.js",
				files: [],
				name: "multi-argument",
				staticDependencies: [],
			})
			.build();

		expect(() => verifier.verify()).toThrow(
			"Dynamic multi-argument import must have exactly one argument in dist/index.js",
		);
	});

	test("rejects forbidden static import graph dependencies", () => {
		const projectDirectory = regression.createPackage({
			files: [
				{
					content: 'import "forbidden-dependency";\n',
					path: "dist/index.js",
				},
			],
			name: "forbidden-import-graph-fixture",
			packageExports: {
				".": "./dist/index.js",
			},
		});
		const verifier = PackageVerificationHarnessBuilder.create()
			.projectDirectory(projectDirectory)
			.importGraph({
				directories: ["dist"],
				dynamicDependencies: [],
				entry: "dist/index.js",
				files: [],
				name: "forbidden",
				staticDependencies: [],
			})
			.build();

		expect(() => verifier.verify()).toThrow("Forbidden forbidden dependency: forbidden-dependency");
	});

	test("cleans temporary workspaces after failed verification", () => {
		const projectDirectory = regression.createPackage({
			files: [{ content: "export const value = true;\n", path: "index.js" }],
			name: "cleanup-fixture",
			packageExports: {
				".": "./missing.js",
			},
		});

		const prefix = regression.createTemporaryPrefix("cleanup");
		const verifier = PackageVerificationHarnessBuilder.create()
			.projectDirectory(projectDirectory)
			.temporaryDirectoryPrefix(prefix)
			.build();

		expect(regression.findTemporaryDirectories(projectDirectory, prefix)).toEqual([]);
		expect(() => verifier.verify()).toThrow("Missing packed export: missing.js");
		expect(regression.findTemporaryDirectories(projectDirectory, prefix)).toEqual([]);
	});

	test("rejects explicitly selected undeclared peers", () => {
		const projectDirectory = regression.createPackage({
			files: [{ content: "export const value = true;\n", path: "index.js" }],
			name: "undeclared-peer-fixture",
			packageExports: {
				".": "./index.js",
			},
		});
		const importCase = ImportCaseBuilder.create("undeclared-peer")
			.exports(".")
			.browser()
			.explicitPeers("undeclared-package")
			.build();
		const verifier = PackageVerificationHarnessBuilder.create()
			.projectDirectory(projectDirectory)
			.importCase(importCase)
			.build();

		expect(() => verifier.verify()).toThrow("Selected peer is not declared: undeclared-package");
	});

	test("runs packed archive cases in order and cleans resources in reverse", () => {
		const projectDirectory = regression.createPackage({
			files: [{ content: "export const value = true;\n", path: "index.js" }],
			name: "packed-archive-order-fixture",
			packageExports: undefined,
		});

		const events: string[] = [];
		const verifier = PackageVerificationHarnessBuilder.create()
			.projectDirectory(projectDirectory)
			.packedArchiveCase("first", (context) => {
				const packedSource = readFileSync(join(context.packageDirectory, "index.js"), "utf8");
				expect(packedSource).toBe("export const value = true;\n");
				expect(context.projectDirectory).toBe(projectDirectory);
				expect(context.archivePath.endsWith(".tgz")).toBe(true);
				events.push("first");
				context.registerCleanup(() => {
					events.push("cleanup-first");
				});
			})
			.packedArchiveCase("second", (context) => {
				events.push("second");
				context.registerCleanup(() => {
					events.push("cleanup-second");
				});
			})
			.build();

		verifier.verify();

		expect(events).toEqual(["first", "second", "cleanup-second", "cleanup-first"]);
	});

	test("isolates packed archive extraction from import case directories", () => {
		const projectDirectory = regression.createPackage({
			devDependencies: {
				typescript: regression.typescriptDependency(),
			},
			files: [
				{ content: "export const value = true;\n", path: "index.js" },
				{
					content: "export declare const value: boolean;\n",
					path: "index.d.ts",
				},
			],
			name: "packed-archive-collision-fixture",
			packageExports: {
				".": {
					import: "./index.js",
					types: "./index.d.ts",
				},
			},
		});

		const importCase = ImportCaseBuilder.create("packed-archive").exports(".").browser().noPeers().build();
		const verifier = PackageVerificationHarnessBuilder.create()
			.projectDirectory(projectDirectory)
			.importCase(importCase)
			.packedArchiveCase("archive-callback", (context) => {
				const packedSource = readFileSync(join(context.packageDirectory, "index.js"), "utf8");
				expect(packedSource).toBe("export const value = true;\n");
			})
			.build();

		expect(() => verifier.verify()).not.toThrow();
	});

	test("cleans resources after packed archive case failure", () => {
		const projectDirectory = regression.createPackage({
			files: [{ content: "export const value = true;\n", path: "index.js" }],
			name: "packed-archive-failure-fixture",
			packageExports: {
				".": "./index.js",
			},
		});

		const events: string[] = [];
		const verifier = PackageVerificationHarnessBuilder.create()
			.projectDirectory(projectDirectory)
			.packedArchiveCase("failure", (context) => {
				context.registerCleanup(() => {
					events.push("cleanup");
				});
				expect.fail("callback failure");
			})
			.build();

		expect(() => verifier.verify()).toThrow("Packed archive case failed: failure");
		expect(events).toEqual(["cleanup"]);
	});

	test("continues cleanup after one packed archive cleanup fails", () => {
		const projectDirectory = regression.createPackage({
			files: [{ content: "export const value = true;\n", path: "index.js" }],
			name: "packed-archive-cleanup-failure-fixture",
			packageExports: {
				".": "./index.js",
			},
		});

		const events: string[] = [];
		const verifier = PackageVerificationHarnessBuilder.create()
			.projectDirectory(projectDirectory)
			.packedArchiveCase("cleanup-failure", (context) => {
				context.registerCleanup(() => {
					events.push("older");
					return undefined;
				});
				context.registerCleanup(() => {
					events.push("newer");
					expect.fail("cleanup failure");
				});
			})
			.build();

		expect(() => verifier.verify()).toThrow("Packed archive cleanup failed");
		expect(events).toEqual(["newer", "older"]);
	});

	test("rejects asynchronous and duplicate packed archive cases", () => {
		const projectDirectory = regression.createPackage({
			files: [{ content: "export const value = true;\n", path: "index.js" }],
			name: "packed-archive-validation-fixture",
			packageExports: {
				".": "./index.js",
			},
		});

		const builder = PackageVerificationHarnessBuilder.create()
			.projectDirectory(projectDirectory)
			.packedArchiveCase("duplicate", () => undefined);
		expect(() => builder.packedArchiveCase(" duplicate", () => undefined)).toThrow(
			"Packed archive case name must not contain outer whitespace",
		);
		expect(() => builder.packedArchiveCase("duplicate", () => undefined)).toThrow(
			"Duplicate packed archive case: duplicate",
		);

		Reflect.apply(builder.packedArchiveCase, builder, ["asynchronous", () => Promise.resolve()]);

		const verifier = builder.build();
		expect(() => verifier.verify()).toThrow("Packed archive case failed: asynchronous");
	});

	test("rejects direct harness construction at runtime", () => {
		expect(() => Reflect.construct(PackageVerificationHarness, [Object.freeze({})])).toThrow(
			"PackageVerificationHarness must be constructed by PackageVerificationHarnessBuilder",
		);
	});

	test("rejects a files entry missing from the packed archive", () => {
		const projectDirectory = regression.createPackage({
			extraPackFiles: ["missing.js"],
			files: [{ content: "export const value = true;\n", path: "index.js" }],
			name: "missing-files-entry-fixture",
			packageExports: {
				".": "./index.js",
			},
		});

		const verifier = regression.createVerifier(projectDirectory);
		expect(() => verifier.verify()).toThrow("files entry not in pack: missing.js");
	});

	test("rejects lockfile pins that drift from package.json", () => {
		const projectDirectory = regression.createPackage({
			devDependencies: {
				typescript: "7.0.2",
			},
			files: [{ content: "export const value = true;\n", path: "index.js" }],
			lockfile: {
				lockfileVersion: 3,
				name: "lockfile-drift-fixture",
				packages: {
					"": {
						devDependencies: {
							typescript: "5.9.3",
						},
					},
				},
			},
			name: "lockfile-drift-fixture",
			packageExports: {
				".": "./index.js",
			},
		});

		const verifier = regression.createVerifier(projectDirectory);
		expect(() => verifier.verify()).toThrow(PackageVerificationError);
		expect(() => verifier.verify()).toThrow("devDependencies.typescript package.json=7.0.2 lockfile=5.9.3");
	});

	test("rejects an optional peer whose exact pin does not match the caret floor", () => {
		const projectDirectory = regression.createPackage({
			devDependencies: {
				prettier: "3.9.2",
			},
			files: [{ content: "export const value = true;\n", path: "index.js" }],
			name: "peer-pin-fixture",
			packageExports: {
				".": "./index.js",
			},
			peerDependencies: {
				prettier: "^3.9.6",
			},
			peerDependenciesMeta: {
				prettier: { optional: true },
			},
		});

		const verifier = regression.createVerifier(projectDirectory);
		expect(() => verifier.verify()).toThrow(PackageVerificationError);
		expect(() => verifier.verify()).toThrow(
			"peer prettier range ^3.9.6 requires exact tested pin 3.9.6, found 3.9.2",
		);
	});

	test("rejects engines.node without a major cap", () => {
		const projectDirectory = regression.createPackage({
			engines: {
				node: ">=24",
			},
			files: [{ content: "export const value = true;\n", path: "index.js" }],
			name: "node-engine-fixture",
			packageExports: {
				".": "./index.js",
			},
		});

		const verifier = PackageVerificationHarnessBuilder.create()
			.projectDirectory(projectDirectory)
			.verifyNodeEngineCap(true)
			.build();
		expect(() => verifier.verify()).toThrow(PackageVerificationError);
		expect(() => verifier.verify()).toThrow(
			"engines.node must be a capped major range such as >=24 <25, found >=24",
		);
	});
});
