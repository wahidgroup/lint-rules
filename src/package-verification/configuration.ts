import type { ForbiddenPathRules, ImportCase, ImportGraphPolicy, PackedArchiveVerificationCase } from "./types.js";

/**
 * Immutable inputs consumed by the package verification lifecycle.
 */
export interface PackageVerificationConfiguration {
	/**
	 * Copies project registry configuration into every isolated consumer.
	 */
	readonly copyNpmrcToConsumers: boolean;

	/**
	 * Runs generated import cases in declaration order.
	 */
	readonly importCases: readonly ImportCase[];

	/**
	 * Requires exact public export keys when present.
	 */
	readonly exactExportKeys?: readonly string[];

	/**
	 * Checks the manifest version when present.
	 */
	readonly expectedVersion?: string;

	/**
	 * Rejects packed paths through declarative rules.
	 */
	readonly forbiddenPaths: ForbiddenPathRules;

	/**
	 * Audits built TypeScript import graphs before consumer installation.
	 */
	readonly importGraphs: readonly ImportGraphPolicy[];

	/**
	 * Runs consumer callbacks against the extracted npm archive.
	 */
	readonly packedArchiveCases: readonly PackedArchiveVerificationCase[];

	/**
	 * Identifies the package source directory.
	 */
	readonly projectDirectory: string;

	/**
	 * Prefixes the lifecycle temporary directory.
	 */
	readonly temporaryDirectoryPrefix: string;

	/**
	 * Receives the verified package archive when present.
	 */
	readonly verifiedArchiveDirectory?: string;

	/**
	 * Accepts export targets that begin with one of these values.
	 */
	readonly exportTargetPrefixes: readonly string[];

	/**
	 * Requires packed contents to match package.json files.
	 */
	readonly verifyFilesField: boolean;

	/**
	 * Requires package-lock.json root pins to match package.json.
	 */
	readonly verifyLockfilePins: boolean;

	/**
	 * Requires engines.node to cap the current major.
	 */
	readonly verifyNodeEngineCap: boolean;

	/**
	 * Requires each peer range to have a matching exact tested pin.
	 */
	readonly verifyPeerPins: boolean;

	/**
	 * Requires npm's deterministic tarball filename.
	 */
	readonly verifyTarballName: boolean;
}
