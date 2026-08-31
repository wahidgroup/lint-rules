import { PackageVerificationError } from "./package-verification-error.js";

/**
 * Narrows untrusted JSON values without type assertions.
 */
export class JsonValueValidator {
	/**
	 * Requires a non-null object with string keys.
	 */
	record(value: unknown, message: string): Record<string, unknown> {
		PackageVerificationError.that(this.isRecord(value), "invalid-json", message);
		return value;
	}

	/**
	 * Requires a string value.
	 */
	string(value: unknown, message: string): string {
		PackageVerificationError.that(typeof value === "string", "invalid-json", message);
		return value;
	}

	/**
	 * Returns an object record only when the value has that shape.
	 */
	optionalRecord(value: unknown): Record<string, unknown> | undefined {
		let record: Record<string, unknown> | undefined;
		if (this.isRecord(value)) {
			record = value;
		}
		return record;
	}

	/**
	 * Reports whether a value is a non-null object with string keys.
	 */
	private isRecord(value: unknown): value is Record<string, unknown> {
		const result = typeof value === "object" && value !== null && !Array.isArray(value);
		return result;
	}
}
