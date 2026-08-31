import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PackageManifest } from "./package-verification-internals.js";
import { JsonValueValidator } from "./json-value-validator.js";

/**
 * Package names accepted by npm for registry publication.
 */
const npmPackageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;

/**
 * Maximum package-name length accepted by npm.
 */
const npmPackageNameMaximumLength = 214;

/**
 * Reads and validates package fields shared by verification phases.
 */
export class PackageManifestReader {
	/**
	 * Identifies the package source directory.
	 */
	readonly #projectDirectory: string;

	/**
	 * Narrows untrusted manifest values.
	 */
	readonly #validator = new JsonValueValidator();

	/**
	 * Binds manifest reads to one package source directory.
	 */
	constructor(projectDirectory: string) {
		this.#projectDirectory = projectDirectory;
	}

	/**
	 * Returns validated immutable package metadata.
	 */
	read(): PackageManifest {
		const manifestPath = join(this.#projectDirectory, "package.json");
		const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
		const input = this.#validator.record(parsed, "package.json must contain an object");
		const packageName = this.#validator.string(input.name, "package name must be a string");

		this.assertPackageName(packageName, "package name");

		const packageVersion = this.#validator.string(input.version, "package version must be a string");
		assert.ok(packageVersion.length > 0, "package version must not be empty");

		const dependencies = this.parseOptionalStringRecord(input.dependencies, "dependencies");
		const devDependencies = this.parseOptionalStringRecord(input.devDependencies, "devDependencies");
		const peerDependencies = this.parseOptionalStringRecord(input.peerDependencies, "peerDependencies");
		const peerDependenciesMeta = this.parsePeerMetadata(input.peerDependenciesMeta);
		const engines = this.parseEngineRecord(input.engines);
		const files = this.parseFilesField(input.files);
		const manifest: PackageManifest = Object.freeze({
			dependencies,
			devDependencies,
			engines,
			exports: input.exports,
			files,
			name: packageName,
			peerDependencies,
			peerDependenciesMeta,
			version: packageVersion,
		});
		return manifest;
	}

	/**
	 * Parses a string record or supplies an empty immutable record.
	 */
	private parseOptionalStringRecord(input: unknown, label: string): Readonly<Record<string, string>> {
		const record: Record<string, string> = {};
		if (input === undefined) {
			return Object.freeze(record);
		}

		const values = this.#validator.record(input, `${label} must be an object`);
		for (const [name, value] of Object.entries(values)) {
			this.assertPackageName(name, `${label} package name`);

			record[name] = this.#validator.string(value, `${label}.${name} must be a string`);
		}

		return Object.freeze(record);
	}

	/**
	 * Parses peer metadata needed to select optional peers.
	 */
	private parsePeerMetadata(input: unknown): Readonly<Record<string, Readonly<Record<string, unknown>>>> {
		const metadata: Record<string, Readonly<Record<string, unknown>>> = {};
		if (input === undefined) {
			return Object.freeze(metadata);
		}

		const values = this.#validator.record(input, "peerDependenciesMeta must be an object");
		for (const [name, value] of Object.entries(values)) {
			this.assertPackageName(name, "peer metadata package name");

			metadata[name] = Object.freeze({
				...this.#validator.record(value, `peerDependenciesMeta.${name} must be an object`),
			});
		}

		return Object.freeze(metadata);
	}

	/**
	 * Parses engines constraints without npm package-name rules.
	 */
	private parseEngineRecord(input: unknown): Readonly<Record<string, string>> {
		const record: Record<string, string> = {};
		if (input === undefined) {
			return Object.freeze(record);
		}

		const values = this.#validator.record(input, "engines must be an object");
		for (const [name, value] of Object.entries(values)) {
			assert.ok(name.trim().length > 0, "engines key must not be empty");
			record[name] = this.#validator.string(value, `engines.${name} must be a string`);
		}

		return Object.freeze(record);
	}

	/**
	 * Parses the npm files allowlist when declared.
	 */
	private parseFilesField(input: unknown): readonly string[] | undefined {
		if (input === undefined) {
			return undefined;
		}

		assert.ok(Array.isArray(input), "package.json files must be an array");

		const files: string[] = [];
		for (const entry of input) {
			const value = this.#validator.string(entry, "package.json files entry must be a string");
			assert.ok(value.trim().length > 0, "package.json files entry must not be empty");

			let normalized = value;
			while (normalized.endsWith("/")) {
				normalized = normalized.slice(0, -1);
			}

			assert.ok(normalized.length > 0, "package.json files entry must not be empty");

			this.addUnique(files, normalized, "files entry");
		}

		return Object.freeze(files);
	}

	/**
	 * Adds one unique files entry.
	 */
	private addUnique(target: string[], value: string, label: string): void {
		assert.ok(!target.includes(value), `Duplicate ${label}: ${value}`);
		target.push(value);
	}

	/**
	 * Requires one registry-safe npm package name.
	 */
	private assertPackageName(packageName: string, label: string): void {
		assert.ok(
			packageName.length <= npmPackageNameMaximumLength,
			`${label} exceeds ${npmPackageNameMaximumLength} characters`,
		);
		assert.ok(npmPackageNamePattern.test(packageName), `${label} must use npm package-name syntax: ${packageName}`);
	}
}
