/**
 * Restricts harness construction to the package-internal builder.
 */
export const packageVerificationHarnessConstructionToken = Symbol("package-verification-harness-construction");

/**
 * Package fields used by internal verification phases.
 */
export interface PackageManifest {
	/**
	 * Contains installed runtime package versions.
	 */
	readonly dependencies: Readonly<Record<string, string>>;

	/**
	 * Contains generated compiler package versions.
	 */
	readonly devDependencies: Readonly<Record<string, string>>;

	/**
	 * Contains package engine constraints.
	 */
	readonly engines: Readonly<Record<string, string>>;

	/**
	 * Contains the public package export map.
	 */
	readonly exports: unknown;

	/**
	 * Contains the npm pack allowlist when declared.
	 */
	readonly files: readonly string[] | undefined;

	/**
	 * Identifies the packed package.
	 */
	readonly name: string;

	/**
	 * Contains peer package version ranges.
	 */
	readonly peerDependencies: Readonly<Record<string, string>>;

	/**
	 * Contains peer optionality metadata.
	 */
	readonly peerDependenciesMeta: Readonly<Record<string, Readonly<Record<string, unknown>>>>;

	/**
	 * Identifies the packed release.
	 */
	readonly version: string;
}

/**
 * One file emitted by npm's pack report.
 */
export interface NpmPackFile {
	/**
	 * Identifies the package-relative path.
	 */
	readonly path: string;
}

/**
 * Validated npm pack report.
 */
export interface NpmPackReport {
	/**
	 * Identifies the generated archive.
	 */
	readonly filename: string;

	/**
	 * Lists archive contents.
	 */
	readonly files: readonly NpmPackFile[];
}
