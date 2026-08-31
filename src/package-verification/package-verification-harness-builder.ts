import assert from "node:assert/strict";
import process from "node:process";

import type { PackageVerificationConfiguration } from "./configuration.js";
import type {
	ForbiddenPathRules,
	ImportCase,
	ImportGraphPolicy,
	PackedArchiveVerificationCallback,
	PackedArchiveVerificationCase,
} from "./types.js";
import { ImportCaseBuilder } from "./import-case-builder.js";
import { packageVerificationHarnessConstructionToken } from "./package-verification-internals.js";
import { PackageVerificationHarness } from "./package-verification-harness.js";

/**
 * Exposes the protected harness constructor only to the validated builder.
 */
class BuiltPackageVerificationHarness extends PackageVerificationHarness {
	/**
	 * Creates a lifecycle owner from validated immutable configuration.
	 */
	constructor(configuration: PackageVerificationConfiguration) {
		super(configuration, packageVerificationHarnessConstructionToken);
	}
}

/**
 * Constructs validated immutable package verification configuration.
 */
export class PackageVerificationHarnessBuilder {
	/**
	 * Creates a builder rooted at the current working directory.
	 */
	static create(): PackageVerificationHarnessBuilder {
		const builder = new PackageVerificationHarnessBuilder();
		return builder;
	}

	/**
	 * Contains the exact configured export-key sequence.
	 */
	readonly #exactExportKeys: string[] = [];

	/**
	 * Contains accepted package export target prefixes.
	 */
	readonly #exportTargetPrefixes: string[] = ["./"];

	/**
	 * Contains exact forbidden archive paths.
	 */
	readonly #forbiddenExact: string[] = [];

	/**
	 * Contains forbidden archive path fragments.
	 */
	readonly #forbiddenFragments: string[] = [];

	/**
	 * Contains forbidden archive path prefixes.
	 */
	readonly #forbiddenPrefixes: string[] = [];

	/**
	 * Contains forbidden archive path suffixes.
	 */
	readonly #forbiddenSuffixes: string[] = [];

	/**
	 * Contains immutable import-graph policies.
	 */
	readonly #importGraphs: ImportGraphPolicy[] = [];

	/**
	 * Contains immutable generated import cases.
	 */
	readonly #importCases: ImportCase[] = [];

	/**
	 * Contains consumer callbacks for the extracted npm archive.
	 */
	readonly #packedArchiveCases: PackedArchiveVerificationCase[] = [];

	/**
	 * Controls project registry configuration propagation.
	 */
	#copyNpmrcToConsumers = false;

	/**
	 * Contains the expected package version when configured.
	 */
	#expectedVersion: string | undefined;

	/**
	 * Identifies the package source directory.
	 */
	#projectDirectory = process.cwd();

	/**
	 * Prefixes temporary verification workspaces.
	 */
	#temporaryDirectoryPrefix = "package-verification-";

	/**
	 * Receives the accepted archive when configured.
	 */
	#verifiedArchiveDirectory: string | undefined;

	/**
	 * Requires packed contents to match package.json files.
	 */
	#verifyFilesField = true;

	/**
	 * Requires package-lock.json root pins to match package.json.
	 */
	#verifyLockfilePins = true;

	/**
	 * Requires engines.node to cap the current major.
	 */
	#verifyNodeEngineCap = false;

	/**
	 * Requires each peer range to have a matching exact tested pin.
	 */
	#verifyPeerPins = true;

	/**
	 * Controls deterministic archive-name verification.
	 */
	#verifyTarballName = false;

	/**
	 * Restricts construction to the static factory.
	 */
	private constructor() {}

	/**
	 * Controls project registry configuration for every isolated consumer.
	 */
	copyNpmrcToConsumers(copy: boolean): PackageVerificationHarnessBuilder {
		this.#copyNpmrcToConsumers = copy;
		return this;
	}

	/**
	 * Selects the package source directory.
	 */
	projectDirectory(projectDirectory: string): PackageVerificationHarnessBuilder {
		assert.ok(projectDirectory.trim().length > 0, "Project directory must not be empty");

		this.#projectDirectory = projectDirectory;
		return this;
	}

	/**
	 * Selects the lifecycle temporary directory prefix.
	 */
	temporaryDirectoryPrefix(prefix: string): PackageVerificationHarnessBuilder {
		assert.ok(prefix.trim().length > 0, "Temporary directory prefix must not be empty");
		assert.equal(prefix, prefix.trim(), "Temporary directory prefix must not contain outer whitespace");
		assert.ok(!prefix.includes("/"), "Temporary directory prefix must not contain a slash");

		this.#temporaryDirectoryPrefix = prefix;
		return this;
	}

	/**
	 * Copies the verified archive to a persistent directory when configured.
	 */
	verifiedArchiveDirectory(directory: string | undefined): PackageVerificationHarnessBuilder {
		if (directory !== undefined) {
			assert.ok(directory.trim().length > 0, "Verified archive directory must not be empty");
		}

		this.#verifiedArchiveDirectory = directory;
		return this;
	}

	/**
	 * Checks the package version against a configured value when defined.
	 */
	expectedVersion(expectedVersion: string | undefined): PackageVerificationHarnessBuilder {
		if (expectedVersion !== undefined) {
			assert.ok(expectedVersion.trim().length > 0, "Expected version must not be empty");
		}

		this.#expectedVersion = expectedVersion;
		return this;
	}

	/**
	 * Replaces accepted export target prefixes.
	 */
	exportTargetPrefixes(...prefixes: readonly string[]): PackageVerificationHarnessBuilder {
		assert.ok(prefixes.length > 0, "At least one export target prefix is required");

		const validated: string[] = [];
		for (const prefix of prefixes) {
			assert.ok(prefix.startsWith("./"), `Export target prefix must start with ./: ${prefix}`);

			this.addUnique(validated, prefix, "export target prefix");
		}

		this.#exportTargetPrefixes.splice(0, this.#exportTargetPrefixes.length, ...validated);
		return this;
	}

	/**
	 * Requires exact public export keys.
	 */
	exactExportKeys(...keys: readonly string[]): PackageVerificationHarnessBuilder {
		assert.ok(keys.length > 0, "At least one export key is required");

		const validated: string[] = [];
		for (const key of keys) {
			assert.ok(key === "." || key.startsWith("./"), `Invalid package export key: ${key}`);

			this.addUnique(validated, key, "export key");
		}

		this.#exactExportKeys.splice(0, this.#exactExportKeys.length, ...validated);
		return this;
	}

	/**
	 * Rejects an exact packed path.
	 */
	forbidExactPath(path: string): PackageVerificationHarnessBuilder {
		this.addPathRule(this.#forbiddenExact, path, "exact forbidden path");
		return this;
	}

	/**
	 * Rejects packed paths that start with a value.
	 */
	forbidPathPrefix(prefix: string): PackageVerificationHarnessBuilder {
		this.addPathRule(this.#forbiddenPrefixes, prefix, "forbidden path prefix");
		return this;
	}

	/**
	 * Rejects packed paths that contain a value.
	 */
	forbidPathFragment(fragment: string): PackageVerificationHarnessBuilder {
		this.addPathRule(this.#forbiddenFragments, fragment, "forbidden path fragment");
		return this;
	}

	/**
	 * Rejects packed paths that end with a value.
	 */
	forbidPathSuffix(suffix: string): PackageVerificationHarnessBuilder {
		this.addPathRule(this.#forbiddenSuffixes, suffix, "forbidden path suffix");
		return this;
	}

	/**
	 * Requires packed contents to match package.json files.
	 */
	verifyFilesField(verifyFilesField: boolean): PackageVerificationHarnessBuilder {
		this.#verifyFilesField = verifyFilesField;
		return this;
	}

	/**
	 * Requires package-lock.json root pins to match package.json.
	 */
	verifyLockfilePins(verifyLockfilePins: boolean): PackageVerificationHarnessBuilder {
		this.#verifyLockfilePins = verifyLockfilePins;
		return this;
	}

	/**
	 * Requires engines.node to cap the current major.
	 */
	verifyNodeEngineCap(verifyNodeEngineCap: boolean): PackageVerificationHarnessBuilder {
		this.#verifyNodeEngineCap = verifyNodeEngineCap;
		return this;
	}

	/**
	 * Requires each peer range to have a matching exact tested pin.
	 */
	verifyPeerPins(verifyPeerPins: boolean): PackageVerificationHarnessBuilder {
		this.#verifyPeerPins = verifyPeerPins;
		return this;
	}

	/**
	 * Requires npm's deterministic tarball filename.
	 */
	verifyTarballName(verifyTarballName: boolean): PackageVerificationHarnessBuilder {
		this.#verifyTarballName = verifyTarballName;
		return this;
	}

	/**
	 * Adds one immutable TypeScript import-graph policy.
	 */
	importGraph(policy: ImportGraphPolicy): PackageVerificationHarnessBuilder {
		assert.ok(policy.name.trim().length > 0, "Import graph name must not be empty");
		assert.ok(policy.entry.trim().length > 0, "Import graph entry must not be empty");

		const duplicate = this.#importGraphs.some((graph) => graph.name === policy.name);

		assert.ok(!duplicate, `Duplicate import graph policy: ${policy.name}`);

		const graph: ImportGraphPolicy = Object.freeze({
			directories: this.freezeUniqueStrings(policy.directories, "import graph directory"),
			dynamicDependencies: this.freezeUniqueStrings(policy.dynamicDependencies, "dynamic dependency"),
			entry: policy.entry,
			files: this.freezeUniqueStrings(policy.files, "import graph file"),
			name: policy.name,
			staticDependencies: this.freezeUniqueStrings(policy.staticDependencies, "static dependency"),
		});

		this.#importGraphs.push(graph);
		return this;
	}

	/**
	 * Adds one validated immutable generated import case.
	 */
	importCase(importCase: ImportCase): PackageVerificationHarnessBuilder {
		const validated = this.copyImportCase(importCase);
		const duplicate = this.#importCases.some((candidate) => candidate.name === validated.name);
		assert.ok(!duplicate, `Duplicate import case: ${validated.name}`);

		this.#importCases.push(validated);
		return this;
	}

	/**
	 * Adds one synchronous consumer callback for the extracted npm archive.
	 */
	packedArchiveCase(name: string, verify: PackedArchiveVerificationCallback): PackageVerificationHarnessBuilder {
		assert.ok(name.trim().length > 0, "Packed archive case name must not be empty");
		assert.equal(name, name.trim(), "Packed archive case name must not contain outer whitespace");
		assert.equal(typeof verify, "function", "Packed archive case callback must be a function");

		const duplicate = this.#packedArchiveCases.some((candidate) => candidate.name === name);
		assert.ok(!duplicate, `Duplicate packed archive case: ${name}`);

		const verificationCase: PackedArchiveVerificationCase = Object.freeze({
			name,
			verify,
		});

		this.#packedArchiveCases.push(verificationCase);
		return this;
	}

	/**
	 * Creates the lifecycle owner from immutable configuration.
	 */
	build(): PackageVerificationHarness {
		const forbiddenPaths: ForbiddenPathRules = Object.freeze({
			exact: Object.freeze([...this.#forbiddenExact]),
			fragments: Object.freeze([...this.#forbiddenFragments]),
			prefixes: Object.freeze([...this.#forbiddenPrefixes]),
			suffixes: Object.freeze([...this.#forbiddenSuffixes]),
		});
		const configuration: PackageVerificationConfiguration = Object.freeze({
			copyNpmrcToConsumers: this.#copyNpmrcToConsumers,
			exactExportKeys: this.freezeExactExportKeys(),
			expectedVersion: this.#expectedVersion,
			exportTargetPrefixes: Object.freeze([...this.#exportTargetPrefixes]),
			forbiddenPaths,
			importCases: Object.freeze([...this.#importCases]),
			importGraphs: Object.freeze([...this.#importGraphs]),
			packedArchiveCases: Object.freeze([...this.#packedArchiveCases]),
			projectDirectory: this.#projectDirectory,
			temporaryDirectoryPrefix: this.#temporaryDirectoryPrefix,
			verifiedArchiveDirectory: this.#verifiedArchiveDirectory,
			verifyFilesField: this.#verifyFilesField,
			verifyLockfilePins: this.#verifyLockfilePins,
			verifyNodeEngineCap: this.#verifyNodeEngineCap,
			verifyPeerPins: this.#verifyPeerPins,
			verifyTarballName: this.#verifyTarballName,
		});

		const harness = new BuiltPackageVerificationHarness(configuration);
		return harness;
	}

	/**
	 * Freezes exact export keys only when configured.
	 */
	private freezeExactExportKeys(): readonly string[] | undefined {
		let keys: readonly string[] | undefined;
		if (this.#exactExportKeys.length > 0) {
			keys = Object.freeze([...this.#exactExportKeys]);
		}

		return keys;
	}

	/**
	 * Adds one unique path rule.
	 */
	private addPathRule(target: string[], value: string, label: string): void {
		assert.ok(value.trim().length > 0, `${label} must not be empty`);
		this.addUnique(target, value, label);
	}

	/**
	 * Adds one unique string to a builder collection.
	 */
	private addUnique(target: string[], value: string, label: string): void {
		assert.ok(!target.includes(value), `Duplicate ${label}: ${value}`);
		target.push(value);
	}

	/**
	 * Rebuilds structural input through the public import-case builder.
	 */
	private copyImportCase(importCase: ImportCase): ImportCase {
		const knownEnvironment =
			importCase.environment === "browser" ||
			importCase.environment === "node" ||
			importCase.environment === "react";
		assert.ok(knownEnvironment, "Import case environment is invalid");

		const knownPeerSelection =
			importCase.peerSelection === "all" ||
			importCase.peerSelection === "explicit" ||
			importCase.peerSelection === "none" ||
			importCase.peerSelection === "optional" ||
			importCase.peerSelection === "required";
		assert.ok(knownPeerSelection, "Import case peer selection is invalid");

		const builder = ImportCaseBuilder.create(importCase.name);
		builder.exports(...importCase.exportKeys);

		if (importCase.environment === "browser") {
			assert.equal(
				importCase.reactTypePackages.length,
				0,
				"Browser import cases must not contain React type packages",
			);

			builder.browser();
		} else if (importCase.environment === "node") {
			assert.equal(
				importCase.reactTypePackages.length,
				0,
				"Node import cases must not contain React type packages",
			);

			builder.node();
		} else {
			builder.react(...importCase.reactTypePackages);
		}

		if (importCase.peerSelection === "all") {
			assert.equal(importCase.peers.length, 0, "All-peer selection must not contain explicit peers");
			builder.allPeers();
		} else if (importCase.peerSelection === "explicit") {
			builder.explicitPeers(...importCase.peers);
		} else if (importCase.peerSelection === "none") {
			assert.equal(importCase.peers.length, 0, "No-peer selection must not contain explicit peers");
			builder.noPeers();
		} else if (importCase.peerSelection === "optional") {
			assert.equal(importCase.peers.length, 0, "Optional-peer selection must not contain explicit peers");
			builder.optionalPeers();
		} else {
			assert.equal(importCase.peers.length, 0, "Required-peer selection must not contain explicit peers");
			builder.requiredPeers();
		}

		const validated = builder.build();
		return validated;
	}

	/**
	 * Validates, deduplicates, and freezes one string collection.
	 */
	private freezeUniqueStrings(values: readonly string[], label: string): readonly string[] {
		const validated: string[] = [];
		for (const value of values) {
			assert.ok(value.trim().length > 0, `${label} must not be empty`);
			this.addUnique(validated, value, label);
		}

		const frozen = Object.freeze(validated);
		return frozen;
	}
}
