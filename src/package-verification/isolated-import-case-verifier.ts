import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

import type { NpmPackReport, PackageManifest } from "./package-verification-internals.js";
import type { ImportCase, ImportEnvironment, PeerSelection } from "./types.js";
import { JsonValueValidator } from "./json-value-validator.js";
import { NpmCommandEnvironment } from "./npm-command-environment.js";
import { PackageVerificationError } from "./package-verification-error.js";

// cspell:ignore nosec

/**
 * Prefix used by ambient type packages.
 */
const ambientTypePackagePrefix = "@types/";

/**
 * Leading npm scope marker removed from generated case names.
 */
const leadingScopePattern = /^@/u;

/**
 * Import attribute required for JSON modules.
 */
const jsonImportAttribute = ' with { type: "json" }';

/**
 * Verifies generated import-only consumers in isolated installations.
 */
export class IsolatedImportCaseVerifier {
	/**
	 * Controls registry configuration propagation.
	 */
	readonly #copyNpmrcToConsumers: boolean;

	/**
	 * Identifies the verified package source.
	 */
	readonly #projectDirectory: string;

	/**
	 * Narrows untrusted export-map values.
	 */
	readonly #validator = new JsonValueValidator();

	/**
	 * Configures generated workspaces for one package source directory.
	 */
	constructor(projectDirectory: string, copyNpmrcToConsumers: boolean) {
		this.#copyNpmrcToConsumers = copyNpmrcToConsumers;
		this.#projectDirectory = projectDirectory;
	}

	/**
	 * Runs the fixed generated import-case pipeline.
	 */
	verify(importCase: ImportCase, manifest: PackageManifest, report: NpmPackReport, temporaryDirectory: string): void {
		const consumerDirectory = this.resolveConsumerDirectory(temporaryDirectory, importCase.name);
		mkdirSync(consumerDirectory);
		const selectedPeers = this.selectPeers(importCase, manifest);
		this.writeWorkspace(consumerDirectory, importCase, manifest, report.filename, selectedPeers);

		this.install(consumerDirectory, manifest, selectedPeers);
		this.verifyPeerIsolation(consumerDirectory, manifest, selectedPeers);
		if (importCase.environment === "node") {
			this.executeNode(consumerDirectory);
		}
		this.compileTypeScript(consumerDirectory);
	}

	/**
	 * Resolves one validated direct child of the lifecycle directory.
	 */
	private resolveConsumerDirectory(temporaryDirectory: string, importCaseName: string): string {
		const root = resolve(temporaryDirectory);
		const safeName = basename(importCaseName);
		assert.equal(safeName, importCaseName, "Import case name must contain one path segment");

		const consumerDirectory = resolve(root, safeName);
		const rootPrefix = `${root}${sep}`;
		const insideRoot = consumerDirectory.startsWith(rootPrefix);
		const directChild = dirname(consumerDirectory) === root;
		if (!insideRoot || !directChild) {
			assert.fail("Import case directory must be a direct child of its root");
		}

		return consumerDirectory;
	}

	/**
	 * Writes one generated import workspace.
	 */
	private writeWorkspace(
		consumerDirectory: string,
		importCase: ImportCase,
		manifest: PackageManifest,
		tarballName: string,
		selectedPeers: readonly string[],
	): void {
		this.writePackageManifest(consumerDirectory, importCase, manifest, tarballName, selectedPeers);
		this.copyNpmrc(consumerDirectory);
		this.writeImportSources(consumerDirectory, importCase, manifest.name, manifest.exports);
		this.writeTypeScriptConfig(consumerDirectory, importCase);
	}

	/**
	 * Writes package and compiler dependencies for one import case.
	 */
	private writePackageManifest(
		consumerDirectory: string,
		importCase: ImportCase,
		manifest: PackageManifest,
		tarballName: string,
		selectedPeers: readonly string[],
	): void {
		const dependencies: Record<string, string> = { [manifest.name]: `file:../${tarballName}` };
		for (const peer of selectedPeers) {
			dependencies[peer] = this.resolvePeerVersion(peer, manifest);
		}

		const devDependencies = this.createCompilerDependencies(importCase, manifest, selectedPeers);
		const packageManifest = {
			dependencies,
			devDependencies,
			name: `${this.sanitizePackageName(manifest.name)}-${importCase.name}`,
			private: true,
			type: "module",
		};

		writeFileSync(join(consumerDirectory, "package.json"), JSON.stringify(packageManifest));
	}

	/**
	 * Creates only the dependencies required by the generated compiler profile.
	 */
	private createCompilerDependencies(
		importCase: ImportCase,
		manifest: PackageManifest,
		selectedPeers: readonly string[],
	): Record<string, string> {
		const devDependencies: Record<string, string> = {};
		if (!selectedPeers.includes("typescript")) {
			devDependencies.typescript = this.resolveDevelopmentVersion("typescript", manifest);
		}
		if (importCase.environment === "node" && !selectedPeers.includes("@types/node")) {
			devDependencies["@types/node"] = this.resolveDevelopmentVersion("@types/node", manifest);
		}

		for (const typePackage of importCase.reactTypePackages) {
			if (!selectedPeers.includes(typePackage)) {
				devDependencies[typePackage] = this.resolveDevelopmentVersion(typePackage, manifest);
			}
		}

		return devDependencies;
	}

	/**
	 * Copies package-wide registry configuration when enabled.
	 */
	private copyNpmrc(consumerDirectory: string): void {
		if (!this.#copyNpmrcToConsumers) {
			return;
		}

		const npmrcSource = join(this.#projectDirectory, ".npmrc");
		assert.ok(existsSync(npmrcSource), "Configured .npmrc does not exist");
		copyFileSync(npmrcSource, join(consumerDirectory, ".npmrc"));
	}

	/**
	 * Writes generated static imports for runtime and compilation.
	 */
	private writeImportSources(
		consumerDirectory: string,
		importCase: ImportCase,
		packageName: string,
		packageExports: unknown,
	): void {
		const source = this.createImportSource(importCase, packageName, packageExports);
		writeFileSync(join(consumerDirectory, "consumer.ts"), source);
		if (importCase.environment === "node") {
			writeFileSync(join(consumerDirectory, "consumer.mjs"), source);
		}
	}

	/**
	 * Generates import-only source from package export keys.
	 */
	private createImportSource(importCase: ImportCase, packageName: string, packageExports: unknown): string {
		const imports: string[] = [];
		for (const exportKey of importCase.exportKeys) {
			const specifier = this.createPackageSpecifier(packageName, exportKey);
			const target = this.resolveExportTarget(packageExports, exportKey, importCase.environment);

			let attribute = "";
			if (target.endsWith(".json")) {
				attribute = jsonImportAttribute;
			}

			imports.push(`import ${JSON.stringify(specifier)}${attribute};`);
		}

		const source = `${imports.join("\n")}\n`;
		return source;
	}

	/**
	 * Selects the first target available to the generated import environment.
	 */
	private resolveExportTarget(packageExports: unknown, exportKey: string, environment: ImportEnvironment): string {
		const exportValue = this.selectExportValue(packageExports, exportKey);
		const pending: unknown[] = [exportValue];
		let target: string | undefined;
		while (pending.length > 0) {
			const value = pending.pop();
			if (typeof value === "string") {
				target = value;
				break;
			}
			if (Array.isArray(value)) {
				const candidates = [...value].reverse();
				for (const candidate of candidates) {
					pending.push(candidate);
				}
				continue;
			}

			const conditions = this.#validator.optionalRecord(value);
			if (conditions === undefined) {
				continue;
			}

			const entries = Object.entries(conditions).reverse();
			for (const [condition, candidate] of entries) {
				if (this.isActiveImportCondition(condition, environment)) {
					pending.push(candidate);
				}
			}
		}

		assert.ok(target !== undefined, `No import target for package export ${exportKey}`);

		return target;
	}

	/**
	 * Selects one top-level package export value.
	 */
	private selectExportValue(packageExports: unknown, exportKey: string): unknown {
		const exportsRecord = this.#validator.optionalRecord(packageExports);
		let exportValue: unknown;
		if (exportsRecord === undefined) {
			assert.equal(exportKey, ".", "Root export value requires key .");
			exportValue = packageExports;
		} else {
			const subpathExports = Object.keys(exportsRecord).some((key) => key.startsWith("."));
			if (!subpathExports) {
				assert.equal(exportKey, ".", "Conditional root export requires key .");
				exportValue = packageExports;
			} else {
				exportValue = exportsRecord[exportKey];
				assert.notEqual(exportValue, undefined, `Missing package export ${exportKey}`);
			}
		}
		return exportValue;
	}

	/**
	 * Reports whether one package condition applies to the generated environment.
	 */
	private isActiveImportCondition(condition: string, environment: ImportEnvironment): boolean {
		let active = false;
		if (condition === "default" || condition === "import") {
			active = true;
		} else if (condition === "node") {
			active = environment === "node";
		} else if (condition === "browser") {
			active = environment !== "node";
		}

		return active;
	}

	/**
	 * Converts one export key to its package specifier.
	 */
	private createPackageSpecifier(packageName: string, exportKey: string): string {
		let specifier = packageName;
		if (exportKey !== ".") {
			specifier += exportKey.slice(1);
		}

		return specifier;
	}

	/**
	 * Writes strict settings for the selected generated environment.
	 */
	private writeTypeScriptConfig(consumerDirectory: string, importCase: ImportCase): void {
		const compilerOptions = this.createCompilerOptions(importCase);
		const config = {
			compilerOptions,
			files: ["consumer.ts"],
		};

		writeFileSync(join(consumerDirectory, "tsconfig.json"), JSON.stringify(config));
	}

	/**
	 * Creates strict compiler settings without cross-environment ambient types.
	 */
	private createCompilerOptions(importCase: ImportCase): Record<string, unknown> {
		let compilerOptions: Record<string, unknown>;
		if (importCase.environment === "node") {
			compilerOptions = {
				lib: ["ES2022"],
				module: "NodeNext",
				moduleResolution: "NodeNext",
				noEmit: true,
				resolveJsonModule: true,
				strict: true,
				target: "ES2022",
				types: ["node"],
			};
		} else {
			const types: string[] = [];
			if (importCase.environment === "react") {
				for (const typePackage of importCase.reactTypePackages) {
					types.push(this.createAmbientTypeName(typePackage));
				}
			}

			compilerOptions = {
				customConditions: ["browser"],
				lib: ["ES2022", "DOM", "DOM.Iterable"],
				module: "ESNext",
				moduleResolution: "Bundler",
				noEmit: true,
				resolveJsonModule: true,
				strict: true,
				target: "ES2022",
				types,
			};

			if (importCase.environment === "react") {
				compilerOptions.jsx = "react-jsx";
			}
		}

		return compilerOptions;
	}

	/**
	 * Converts an ambient package name to a TypeScript type library name.
	 */
	private createAmbientTypeName(typePackage: string): string {
		assert.ok(
			typePackage.startsWith(ambientTypePackagePrefix),
			`React type package must start with ${ambientTypePackagePrefix}: ${typePackage}`,
		);

		const typeName = typePackage.slice(ambientTypePackagePrefix.length);
		return typeName;
	}

	/**
	 * Installs the package and selected peer set without scripts.
	 */
	private install(consumerDirectory: string, manifest: PackageManifest, selectedPeers: readonly string[]): void {
		const installArguments = ["install", "--ignore-scripts", "--no-audit", "--no-fund"];

		if (this.requiresOmittedPeers(manifest, selectedPeers)) {
			installArguments.push("--omit=peer");
		}

		execFileSync("npm", installArguments, {
			cwd: consumerDirectory,
			env: NpmCommandEnvironment.forWorkspace(consumerDirectory),
			stdio: "inherit",
		});
	}

	/**
	 * Omits automatic peers when any package peer is unselected.
	 */
	private requiresOmittedPeers(manifest: PackageManifest, selectedPeers: readonly string[]): boolean {
		let omitPeers = false;
		for (const peer of Object.keys(manifest.peerDependencies)) {
			const selected = selectedPeers.includes(peer);
			if (!selected) {
				omitPeers = true;
				break;
			}
		}

		return omitPeers;
	}

	/**
	 * Executes generated static imports for Node cases.
	 */
	private executeNode(consumerDirectory: string): void {
		execFileSync("node", ["consumer.mjs"], {
			cwd: consumerDirectory,
			stdio: "inherit",
		});
	}

	/**
	 * Compiles generated imports under the selected strict profile.
	 */
	private compileTypeScript(consumerDirectory: string): void {
		execFileSync(join(consumerDirectory, "node_modules", ".bin", "tsc"), ["--project", "tsconfig.json"], {
			cwd: consumerDirectory,
			stdio: "inherit",
		});
	}

	/**
	 * Resolves a selected peer from the verified manifest.
	 */
	private resolvePeerVersion(packageName: string, manifest: PackageManifest): string {
		let version = manifest.devDependencies[packageName];
		if (version === undefined) {
			version = manifest.peerDependencies[packageName];
		}

		PackageVerificationError.that(
			typeof version === "string",
			"invalid-manifest",
			`Missing manifest version for selected peer ${packageName}`,
		);

		return version;
	}

	/**
	 * Resolves a compiler dependency from package development metadata.
	 */
	private resolveDevelopmentVersion(packageName: string, manifest: PackageManifest): string {
		const version = manifest.devDependencies[packageName];
		if (version !== undefined) {
			return version;
		}

		const fromDependencies = manifest.dependencies[packageName];
		PackageVerificationError.that(
			typeof fromDependencies === "string",
			"invalid-manifest",
			`Missing dependencies or devDependencies version for ${packageName}`,
		);

		return fromDependencies;
	}

	/**
	 * Selects peers from manifest optionality and case configuration.
	 */
	private selectPeers(importCase: ImportCase, manifest: PackageManifest): readonly string[] {
		const peers: string[] = [];
		const declared = Object.keys(manifest.peerDependencies);
		if (importCase.peerSelection === "explicit") {
			for (const peer of importCase.peers) {
				assert.ok(Object.hasOwn(manifest.peerDependencies, peer), `Selected peer is not declared: ${peer}`);

				peers.push(peer);
			}
		} else {
			for (const peer of declared) {
				const optional = this.isOptionalPeer(peer, manifest);
				if (this.selectPeer(importCase.peerSelection, optional)) {
					peers.push(peer);
				}
			}
		}
		return peers;
	}

	/**
	 * Reports whether a selection mode includes one declared peer.
	 */
	private selectPeer(selection: PeerSelection, optional: boolean): boolean {
		if (selection === "all") {
			return true;
		}
		if (selection === "required") {
			return !optional;
		}
		if (selection === "optional") {
			return optional;
		}

		return false;
	}

	/**
	 * Reports whether the manifest marks one peer as optional.
	 */
	private isOptionalPeer(peer: string, manifest: PackageManifest): boolean {
		const metadata = manifest.peerDependenciesMeta[peer];
		if (metadata === undefined) {
			return false;
		}

		const optional = metadata.optional === true;
		return optional;
	}

	/**
	 * Requires selected peers and rejects every unselected declared peer.
	 */
	private verifyPeerIsolation(
		consumerDirectory: string,
		manifest: PackageManifest,
		selectedPeers: readonly string[],
	): void {
		for (const peer of Object.keys(manifest.peerDependencies)) {
			const peerPath = join(consumerDirectory, "node_modules", peer);
			const selected = selectedPeers.includes(peer);
			assert.equal(existsSync(peerPath), selected, `Peer isolation mismatch for ${peer}`);
		}
	}

	/**
	 * Converts a package name into a valid consumer package segment.
	 */
	private sanitizePackageName(packageName: string): string {
		const sanitized = packageName.replace(leadingScopePattern, "").replaceAll("/", "-");
		return sanitized;
	}
}
