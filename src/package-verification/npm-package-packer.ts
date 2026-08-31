import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import type { NpmPackFile, NpmPackReport } from "./package-verification-internals.js";
import { JsonValueValidator } from "./json-value-validator.js";
import { NpmCommandEnvironment } from "./npm-command-environment.js";

/**
 * Creates one npm archive and validates npm's JSON report.
 */
export class NpmPackagePacker {
	/**
	 * Identifies the package source directory.
	 */
	readonly #projectDirectory: string;

	/**
	 * Narrows untrusted npm report values.
	 */
	readonly #validator = new JsonValueValidator();

	/**
	 * Binds packing to one package source directory.
	 */
	constructor(projectDirectory: string) {
		this.#projectDirectory = projectDirectory;
	}

	/**
	 * Packs without lifecycle scripts into the supplied directory.
	 */
	pack(destination: string): NpmPackReport {
		const output = execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", destination], {
			cwd: this.#projectDirectory,
			encoding: "utf8",
			env: NpmCommandEnvironment.forWorkspace(destination),
		});

		const parsed: unknown = JSON.parse(output);
		const report = this.parseReport(parsed);
		return report;
	}

	/**
	 * Requires one archive report with validated file entries.
	 */
	private parseReport(input: unknown): NpmPackReport {
		const value = this.singleArchive(input);
		const reportInput = this.#validator.record(value, "npm pack report must contain an object");
		const filename = this.#validator.string(reportInput.filename, "packed filename must be a string");
		assert.ok(Array.isArray(reportInput.files), "packed files must be an array");

		const files: NpmPackFile[] = [];
		for (const file of reportInput.files) {
			const fileInput = this.#validator.record(file, "packed file must be an object");
			const path = this.#validator.string(fileInput.path, "packed path must be a string");
			files.push(Object.freeze({ path }));
		}

		const report: NpmPackReport = Object.freeze({
			filename,
			files: Object.freeze(files),
		});
		return report;
	}

	/**
	 * Accepts npm 11's one-element array and npm 12's package-keyed object.
	 *
	 * npm 12 keys `pack --json` by package name (npm/cli#9247).
	 */
	private singleArchive(input: unknown): unknown {
		if (Array.isArray(input)) {
			assert.equal(input.length, 1, "npm pack must produce one archive");
			return input[0];
		}

		const record = this.#validator.record(input, "npm pack report must be an array or a package-keyed object");
		const values = Object.values(record);
		assert.equal(values.length, 1, "npm pack must produce one archive");

		return values[0];
	}
}
