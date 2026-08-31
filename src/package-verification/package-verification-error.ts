/**
 * Coded failure from package verification.
 */
export type PackageVerificationErrorCode =
	| "forbidden-path"
	| "invalid-configuration"
	| "invalid-export"
	| "invalid-json"
	| "invalid-manifest"
	| "invalid-pack"
	| "lockfile-drift"
	| "missing-export"
	| "node-engine"
	| "pack-files"
	| "peer-pin";

/**
 * Typed verification failure with a stable code for consumers and tests.
 */
export class PackageVerificationError extends Error {
	/**
	 * Identifies the failed verification rule.
	 */
	readonly code: PackageVerificationErrorCode;

	/**
	 * Creates one coded verification failure.
	 */
	constructor(code: PackageVerificationErrorCode, message: string) {
		super(message);
		this.name = "PackageVerificationError";
		this.code = code;
	}

	/**
	 * Throws when a required condition is false.
	 */
	static that(condition: unknown, code: PackageVerificationErrorCode, message: string): asserts condition {
		if (condition) {
			return;
		}

		throw new PackageVerificationError(code, message);
	}
}
