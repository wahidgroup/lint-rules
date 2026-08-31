import { readFileSync } from "node:fs";
import { join } from "node:path";

import { JsonValueValidator } from "./json-value-validator.js";
import { PackageVerificationError } from "./package-verification-error.js";
import type { PackageManifest } from "./package-verification-internals.js";

/**
 * Requires package-lock.json root pins to match package.json.
 */
export class LockfilePinAuditor {
	/**
	 * Identifies the package source directory.
	 */
	readonly #projectDirectory: string;

	/**
	 * Narrows untrusted lockfile JSON.
	 */
	readonly #validator = new JsonValueValidator();

	/**
	 * Binds lockfile reads to one package source directory.
	 */
	constructor(projectDirectory: string) {
		this.#projectDirectory = projectDirectory;
	}

	/**
	 * Compares declared pins to lockfile packages[""] when a lockfile exists.
	 */
	verify(manifest: PackageManifest): void {
		const lockPath = join(this.#projectDirectory, "package-lock.json");
		let raw: string;
		try {
			raw = readFileSync(lockPath, "utf8");
		} catch {
			return;
		}

		const parsed: unknown = JSON.parse(raw);
		const lock = this.#validator.record(parsed, "package-lock.json must contain an object");
		const packagesValue = this.#validator.record(lock.packages, "package-lock.json packages must be an object");
		const root = this.#validator.record(packagesValue[""], 'package-lock.json packages[""] must be an object');

		this.verifyRecord("dependencies", manifest.dependencies, this.optionalStringRecord(root.dependencies));
		this.verifyRecord("devDependencies", manifest.devDependencies, this.optionalStringRecord(root.devDependencies));
		this.verifyRecord(
			"peerDependencies",
			manifest.peerDependencies,
			this.optionalStringRecord(root.peerDependencies),
		);
		this.verifyRecord("engines", manifest.engines, this.optionalStringRecord(root.engines));
	}

	/**
	 * Compares one dependency map to the lockfile snapshot.
	 */
	private verifyRecord(
		label: string,
		declared: Readonly<Record<string, string>>,
		locked: Readonly<Record<string, string>>,
	): void {
		const names = new Set([...Object.keys(declared), ...Object.keys(locked)]);
		for (const name of names) {
			const fromManifest = declared[name];
			const fromLock = locked[name];
			PackageVerificationError.that(
				fromManifest === fromLock,
				"lockfile-drift",
				`${label}.${name} package.json=${String(fromManifest)} lockfile=${String(fromLock)}`,
			);
		}
	}

	/**
	 * Parses a string record or supplies an empty map.
	 */
	private optionalStringRecord(input: unknown): Readonly<Record<string, string>> {
		const record: Record<string, string> = {};
		if (input === undefined) {
			return record;
		}

		const values = this.#validator.record(input, "lockfile dependency map must be an object");
		for (const [name, value] of Object.entries(values)) {
			record[name] = this.#validator.string(value, `lockfile pin for ${name} must be a string`);
		}

		return record;
	}
}
