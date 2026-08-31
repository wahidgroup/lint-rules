import type { ImportEnvironment } from "./types.js";
import { JsonValueValidator } from "./json-value-validator.js";
import { PackageVerificationError } from "./package-verification-error.js";

/**
 * Node ESM runtime conditions from most specific to least specific.
 *
 * Node documents this order as the authoring order for `exports` keys. This
 * resolver applies that priority even when a map lists `default` before
 * `import` or `node`, so JSON `default` targets cannot steal the import
 * attribute from a JavaScript `import` or `node` target.
 */
const nodeRuntimeConditions = ["node", "import", "default"] as const;

/**
 * Browser and React consumers prefer `browser` before the shared ESM fallbacks.
 */
const browserRuntimeConditions = ["browser", "import", "default"] as const;

/**
 * Resolves one `exports` target the way a Node ESM or browser import loads it.
 *
 * `types` is skipped because TypeScript owns that condition. Runtime loaders
 * never select it, so a JSON import attribute must follow the JavaScript or
 * JSON file those loaders actually open.
 */
export class ExportConditionResolver {
	/**
	 * Narrows untrusted export-map values.
	 */
	readonly #validator = new JsonValueValidator();

	/**
	 * Selects Node or browser runtime conditions.
	 */
	readonly #environment: ImportEnvironment;

	/**
	 * Binds one generated import environment to Node's runtime condition order.
	 */
	constructor(environment: ImportEnvironment) {
		this.#environment = environment;
	}

	/**
	 * Returns the package-relative file a runtime import of `exportKey` loads.
	 */
	target(packageExports: unknown, exportKey: string): string {
		const exportValue = this.selectExportValue(packageExports, exportKey);
		const target = this.resolveValue(exportValue);
		PackageVerificationError.that(
			target !== undefined,
			"invalid-export",
			`No import target for package export ${exportKey}`,
		);

		return target;
	}

	/**
	 * Walks strings, export arrays, and nested condition maps.
	 */
	private resolveValue(value: unknown): string | undefined {
		if (typeof value === "string") {
			return value;
		}
		if (Array.isArray(value)) {
			return this.resolveArray(value);
		}

		const conditions = this.#validator.optionalRecord(value);
		if (conditions === undefined) {
			return undefined;
		}

		return this.resolveConditionMap(conditions);
	}

	/**
	 * Uses the first array candidate that resolves to a file.
	 */
	private resolveArray(value: readonly unknown[]): string | undefined {
		for (const candidate of value) {
			const resolved = this.resolveValue(candidate);
			if (resolved !== undefined) {
				return resolved;
			}
		}

		return undefined;
	}

	/**
	 * Selects the first present runtime condition in Node's specificity order.
	 */
	private resolveConditionMap(conditions: Record<string, unknown>): string | undefined {
		for (const condition of this.runtimeConditions()) {
			if (!Object.hasOwn(conditions, condition)) {
				continue;
			}

			const resolved = this.resolveValue(conditions[condition]);
			if (resolved !== undefined) {
				return resolved;
			}
		}

		return undefined;
	}

	/**
	 * Returns Node or browser runtime conditions for this environment.
	 */
	private runtimeConditions(): readonly string[] {
		if (this.#environment === "node") {
			return nodeRuntimeConditions;
		}

		return browserRuntimeConditions;
	}

	/**
	 * Selects one top-level package export value.
	 */
	private selectExportValue(packageExports: unknown, exportKey: string): unknown {
		const exportsRecord = this.#validator.optionalRecord(packageExports);
		if (exportsRecord === undefined) {
			PackageVerificationError.that(exportKey === ".", "invalid-export", "Root export value requires key .");

			return packageExports;
		}

		const subpathExports = Object.keys(exportsRecord).some((key) => key.startsWith("."));
		if (!subpathExports) {
			PackageVerificationError.that(
				exportKey === ".",
				"invalid-export",
				"Conditional root export requires key .",
			);

			return packageExports;
		}

		const exportValue = exportsRecord[exportKey];
		PackageVerificationError.that(
			exportValue !== undefined,
			"invalid-export",
			`Missing package export ${exportKey}`,
		);

		return exportValue;
	}
}
