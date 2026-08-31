import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { basename, join } from "node:path";

import type { PackedArchiveCleanup, PackedArchiveVerificationCase, PackedArchiveVerificationContext } from "./types.js";

/**
 * Owns consumer cleanup for one extracted archive.
 */
class PackedArchiveContext implements PackedArchiveVerificationContext {
	/**
	 * Releases acquired resources in reverse order.
	 */
	readonly #cleanups: PackedArchiveCleanup[] = [];

	/**
	 * Identifies the npm archive produced by the current run.
	 */
	readonly archivePath: string;

	/**
	 * Identifies the extracted package root.
	 */
	readonly packageDirectory: string;

	/**
	 * Identifies the package source directory.
	 */
	readonly projectDirectory: string;

	/**
	 * Binds callback-visible paths to one harness lifecycle.
	 */
	constructor(archivePath: string, packageDirectory: string, projectDirectory: string) {
		this.archivePath = archivePath;
		this.packageDirectory = packageDirectory;
		this.projectDirectory = projectDirectory;
	}

	/**
	 * Registers cleanup after its resource acquisition succeeds.
	 */
	registerCleanup(cleanup: PackedArchiveCleanup): void {
		assert.equal(typeof cleanup, "function", "Packed archive cleanup must be a function");
		this.#cleanups.push(cleanup);
	}

	/**
	 * Runs every registered cleanup and returns all failures.
	 */
	cleanup(): readonly unknown[] {
		const failures: unknown[] = [];
		for (let index = this.#cleanups.length - 1; index >= 0; index -= 1) {
			const cleanup = this.#cleanups[index];
			assert.ok(cleanup !== undefined, "Packed archive cleanup is missing");

			try {
				const cleanupResult: unknown = cleanup();
				assert.equal(cleanupResult, undefined, "Packed archive cleanup must return undefined");
			} catch (cause) {
				failures.push(cause);
			}
		}

		const result = Object.freeze(failures);
		return result;
	}
}

/**
 * Extracts an npm archive and runs consumer-owned verification callbacks.
 */
export class PackedArchiveVerifier {
	/**
	 * Identifies the package source directory.
	 */
	readonly #projectDirectory: string;

	/**
	 * Binds extraction and callbacks to one package source directory.
	 */
	constructor(projectDirectory: string) {
		this.#projectDirectory = projectDirectory;
	}

	/**
	 * Runs configured cases against files from the npm archive.
	 */
	verify(cases: readonly PackedArchiveVerificationCase[], archiveFilename: string, temporaryDirectory: string): void {
		if (cases.length === 0) {
			return;
		}

		const archiveBasename = basename(archiveFilename);
		assert.equal(archiveBasename, archiveFilename, "Packed archive filename must contain one path segment");

		const archivePath = join(temporaryDirectory, archiveBasename);
		const extractionDirectory = mkdtempSync(join(temporaryDirectory, "packed-archive-"));

		execFileSync("tar", ["-xzf", archivePath, "-C", extractionDirectory], {
			stdio: "inherit",
		});

		const packageDirectory = join(extractionDirectory, "package");
		const context = new PackedArchiveContext(archivePath, packageDirectory, this.#projectDirectory);

		let callbackFailed = false;
		let callbackFailure: unknown;
		for (const verificationCase of cases) {
			try {
				const callbackResult: unknown = verificationCase.verify(context);
				this.assertCallbackResult(callbackResult, verificationCase.name);
			} catch (cause) {
				callbackFailed = true;
				callbackFailure = new AggregateError([cause], `Packed archive case failed: ${verificationCase.name}`);
				break;
			}
		}

		const cleanupFailures = context.cleanup();
		if (cleanupFailures.length > 0) {
			const failures: unknown[] = [...cleanupFailures];
			if (callbackFailed) {
				failures.unshift(callbackFailure);
			}

			throw new AggregateError(failures, "Packed archive cleanup failed");
		}

		if (callbackFailed) {
			throw callbackFailure;
		}
	}

	/**
	 * Requires synchronous callbacks without result values.
	 */
	private assertCallbackResult(result: unknown, name: string): void {
		if (result !== null && typeof result === "object" && "then" in result) {
			assert.fail(`Packed archive case must be synchronous: ${name}`);
		}

		assert.equal(result, undefined, `Packed archive case must return undefined: ${name}`);
	}
}
