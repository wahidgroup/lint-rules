import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import type { PackageManifest } from "./package-verification-internals.js";
import { PackageVerificationError } from "./package-verification-error.js";

/**
 * Node major range with a lower bound and exclusive upper bound.
 */
const nodeMajorCapPattern = /^>=(\d+)(?:\.\d+)* <(\d+)$/u;

/**
 * Requires engines.node, .nvmrc, and the running Node major to describe one capped line.
 */
export class NodeEngineAuditor {
	/**
	 * Identifies the package that owns `.nvmrc`.
	 */
	readonly #projectDirectory: string;

	/**
	 * Binds the auditor to one package source directory.
	 */
	constructor(projectDirectory: string) {
		this.#projectDirectory = projectDirectory;
	}

	/**
	 * Checks engines.node when the builder enabled the cap.
	 */
	verify(manifest: PackageManifest): void {
		const nodeEngine = manifest.engines.node;
		PackageVerificationError.that(
			nodeEngine !== undefined && nodeEngine.length > 0,
			"node-engine",
			"package.json engines.node is required",
		);

		const match = nodeMajorCapPattern.exec(nodeEngine.trim());
		PackageVerificationError.that(
			match !== null,
			"node-engine",
			`engines.node must be a capped major range such as >=24 <25, found ${nodeEngine}`,
		);

		const floor = Number(match[1]);
		const exclusiveUpper = Number(match[2]);
		PackageVerificationError.that(
			exclusiveUpper === floor + 1,
			"node-engine",
			`engines.node exclusive upper bound must be ${floor + 1}, found ${exclusiveUpper}`,
		);

		const nvmrcMajor = this.readNvmrcMajor();
		PackageVerificationError.that(
			nvmrcMajor === floor,
			"node-engine",
			`.nvmrc major ${nvmrcMajor} does not match engines.node floor ${floor}`,
		);

		const runningMajor = Number.parseInt(process.versions.node, 10);
		PackageVerificationError.that(
			runningMajor === floor,
			"node-engine",
			`running Node major ${runningMajor} does not match engines.node floor ${floor}`,
		);
	}

	/**
	 * Reads the Node major declared by `.nvmrc`.
	 */
	private readNvmrcMajor(): number {
		const nvmrcPath = join(this.#projectDirectory, ".nvmrc");
		PackageVerificationError.that(
			existsSync(nvmrcPath),
			"node-engine",
			".nvmrc is required when verifying the Node engine cap",
		);

		const nvmrcMajor = this.parseNvmrcMajor(readFileSync(nvmrcPath, "utf8"));
		PackageVerificationError.that(nvmrcMajor !== undefined, "node-engine", ".nvmrc must declare a Node major");

		return nvmrcMajor;
	}

	/**
	 * Parses the first non-comment `.nvmrc` token as a Node major.
	 */
	private parseNvmrcMajor(contents: string): number | undefined {
		const lines = contents.split(/\r?\n/u);
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.length === 0) {
				continue;
			}
			if (trimmed.startsWith("#")) {
				continue;
			}

			const token = trimmed.split(/\s+/u)[0];
			if (token === undefined) {
				continue;
			}

			let version = token;
			if (version.startsWith("v") || version.startsWith("V")) {
				version = version.slice(1);
			}

			const majorPart = version.split(".")[0];
			if (majorPart === undefined) {
				return undefined;
			}

			const major = Number(majorPart);
			if (Number.isInteger(major) && major > 0) {
				return major;
			}

			return undefined;
		}

		return undefined;
	}
}
