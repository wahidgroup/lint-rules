import assert from "node:assert/strict";

import type { PackageVerificationConfiguration } from "./configuration.js";
import type { NpmPackReport, PackageManifest } from "./package-verification-internals.js";
import { JsonValueValidator } from "./json-value-validator.js";

/**
 * Leading npm scope marker removed from deterministic archive names.
 */
const leadingScopePattern = /^@/u;

/**
 * Audits export targets, export keys, archive names, and forbidden paths.
 */
export class PackageTarballAuditor {
	/**
	 * Contains immutable archive policy.
	 */
	readonly #configuration: PackageVerificationConfiguration;

	/**
	 * Narrows untrusted export-map values.
	 */
	readonly #validator = new JsonValueValidator();

	/**
	 * Binds archive policy to immutable harness configuration.
	 */
	constructor(configuration: PackageVerificationConfiguration) {
		this.#configuration = configuration;
	}

	/**
	 * Applies every configured archive requirement.
	 */
	verify(report: NpmPackReport, manifest: PackageManifest): void {
		this.verifyFilename(report, manifest);

		const paths = this.collectPackedPaths(report);
		if (manifest.exports !== undefined) {
			const exportTargets = this.collectExportTargets(manifest.exports);
			assert.ok(exportTargets.size > 0, "package exports must contain accepted file targets");

			for (const target of exportTargets) {
				assert.ok(paths.has(target), `Missing packed export: ${target}`);
			}
		}

		this.verifyExportKeys(manifest.exports);

		for (const path of paths) {
			this.verifyPackedPath(path);
		}
	}

	/**
	 * Checks npm's deterministic archive name when configured.
	 */
	private verifyFilename(report: NpmPackReport, manifest: PackageManifest): void {
		if (!this.#configuration.verifyTarballName) {
			return;
		}

		const unscopedName = manifest.name.replace(leadingScopePattern, "").replaceAll("/", "-");
		const expectedFilename = `${unscopedName}-${manifest.version}.tgz`;
		assert.equal(report.filename, expectedFilename, "npm pack filename must be deterministic");
	}

	/**
	 * Collects immutable package-relative archive paths.
	 */
	private collectPackedPaths(report: NpmPackReport): ReadonlySet<string> {
		const paths = new Set<string>();
		for (const file of report.files) {
			paths.add(file.path);
		}

		return paths;
	}

	/**
	 * Collects every nested export target accepted by configuration.
	 */
	private collectExportTargets(packageExports: unknown): ReadonlySet<string> {
		const targets = new Set<string>();
		const pending: unknown[] = [packageExports];
		while (pending.length > 0) {
			const value = pending.pop();
			if (typeof value === "string") {
				const accepted = this.#configuration.exportTargetPrefixes.some((prefix) => value.startsWith(prefix));

				assert.ok(accepted, `Invalid export target: ${value}`);
				targets.add(value.slice(2));
				continue;
			}
			if (value === null) {
				continue;
			}
			if (Array.isArray(value)) {
				for (const child of value) {
					pending.push(child);
				}

				continue;
			}

			const record = this.#validator.optionalRecord(value);
			if (record === undefined) {
				assert.fail(`Unsupported package export target type: ${typeof value}`);
			}

			for (const child of Object.values(record)) {
				pending.push(child);
			}
		}
		return targets;
	}

	/**
	 * Requires an exact top-level export key sequence when configured.
	 */
	private verifyExportKeys(packageExports: unknown): void {
		const expected = this.#configuration.exactExportKeys;
		if (expected === undefined) {
			return;
		}

		const exportsRecord = this.#validator.record(packageExports, "package exports must be an object");
		const actual = Object.keys(exportsRecord);
		assert.deepEqual(actual, expected, "package exports must match configured keys");
	}

	/**
	 * Applies every configured packed-path prohibition.
	 */
	private verifyPackedPath(path: string): void {
		const rules = this.#configuration.forbiddenPaths;
		assert.ok(!rules.exact.includes(path), `Packed forbidden path: ${path}`);

		for (const prefix of rules.prefixes) {
			assert.ok(!path.startsWith(prefix), `Packed forbidden prefix: ${path}`);
		}
		for (const fragment of rules.fragments) {
			assert.ok(!path.includes(fragment), `Packed forbidden fragment: ${path}`);
		}
		for (const suffix of rules.suffixes) {
			assert.ok(!path.endsWith(suffix), `Packed forbidden suffix: ${path}`);
		}
	}
}
