/**
 * Selects declared peers for an isolated import case.
 */
export type PeerSelection = "all" | "explicit" | "none" | "optional" | "required";

/**
 * Selects generated runtime and compiler settings.
 */
export type ImportEnvironment = "browser" | "node" | "react";

/**
 * Immutable generated import-case configuration.
 */
export interface ImportCase {
	/**
	 * Selects generated runtime and compiler behavior.
	 */
	readonly environment: ImportEnvironment;

	/**
	 * Lists public export keys imported by the generated consumer.
	 */
	readonly exportKeys: readonly string[];

	/**
	 * Identifies the case and its temporary directory.
	 */
	readonly name: string;

	/**
	 * Contains peer names when selection is `explicit`.
	 */
	readonly peers: readonly string[];

	/**
	 * Selects peers from the verified manifest.
	 */
	readonly peerSelection: PeerSelection;

	/**
	 * Installs React ambient type packages for React compilation.
	 */
	readonly reactTypePackages: readonly string[];
}

/**
 * Releases a resource created by packed-archive verification.
 */
export type PackedArchiveCleanup = () => undefined;

/**
 * Exposes the verified archive while the harness owns its temporary workspace.
 */
export interface PackedArchiveVerificationContext {
	/**
	 * Identifies the npm archive produced by the current verification run.
	 */
	readonly archivePath: string;

	/**
	 * Identifies the extracted package root without npm's `package/` prefix.
	 */
	readonly packageDirectory: string;

	/**
	 * Identifies the source directory supplied to `npm pack`.
	 */
	readonly projectDirectory: string;

	/**
	 * Registers cleanup in reverse resource-acquisition order.
	 */
	registerCleanup(cleanup: PackedArchiveCleanup): void;
}

/**
 * Runs consumer-owned verification against one extracted npm archive.
 */
export type PackedArchiveVerificationCallback = (context: PackedArchiveVerificationContext) => undefined;

/**
 * Associates one consumer callback with a diagnostic name.
 */
export interface PackedArchiveVerificationCase {
	/**
	 * Identifies callback failures.
	 */
	readonly name: string;

	/**
	 * Verifies consumer-specific behavior against packed files.
	 */
	readonly verify: PackedArchiveVerificationCallback;
}

/**
 * Rejects packed paths through four matching strategies.
 */
export interface ForbiddenPathRules {
	/**
	 * Rejects paths equal to one of these values.
	 */
	readonly exact: readonly string[];

	/**
	 * Rejects paths containing one of these values.
	 */
	readonly fragments: readonly string[];

	/**
	 * Rejects paths that start with one of these values.
	 */
	readonly prefixes: readonly string[];

	/**
	 * Rejects paths that end with one of these values.
	 */
	readonly suffixes: readonly string[];
}

/**
 * Constrains the built import graph for one public entry.
 */
export interface ImportGraphPolicy {
	/**
	 * Allows dynamic external imports by package specifier.
	 */
	readonly dynamicDependencies: readonly string[];

	/**
	 * Allows all built JavaScript below these project-relative directories.
	 */
	readonly directories: readonly string[];

	/**
	 * Identifies the project-relative built JavaScript entry.
	 */
	readonly entry: string;

	/**
	 * Allows these project-relative built JavaScript files.
	 */
	readonly files: readonly string[];

	/**
	 * Identifies the policy in failures.
	 */
	readonly name: string;

	/**
	 * Allows static external imports by package specifier.
	 */
	readonly staticDependencies: readonly string[];
}
