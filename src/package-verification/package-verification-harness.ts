import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import type { PackageVerificationConfiguration } from "./configuration.js";
import type { NpmPackReport, PackageManifest } from "./package-verification-internals.js";
import { FilesFieldAuditor } from "./files-field-auditor.js";
import { ImportGraphAuditor } from "./import-graph-auditor.js";
import { IsolatedImportCaseVerifier } from "./isolated-import-case-verifier.js";
import { LockfilePinAuditor } from "./lockfile-pin-auditor.js";
import { NodeEngineAuditor } from "./node-engine-auditor.js";
import { NpmCommandEnvironment } from "./npm-command-environment.js";
import { NpmPackagePacker } from "./npm-package-packer.js";
import { PackageManifestReader } from "./package-manifest-reader.js";
import { packageVerificationHarnessConstructionToken } from "./package-verification-internals.js";
import { PackageTarballAuditor } from "./package-tarball-auditor.js";
import { PackedArchiveVerifier } from "./packed-archive-verifier.js";
import { PeerPinAuditor } from "./peer-pin-auditor.js";

// cspell:ignore nosec

/**
 * Runs the fixed package verification pipeline and owns temporary resources.
 */
export class PackageVerificationHarness {
	/**
	 * Contains the immutable verification policy.
	 */
	readonly #configuration: PackageVerificationConfiguration;

	/**
	 * Requires packed contents to match package.json files.
	 */
	readonly #filesFieldAuditor = new FilesFieldAuditor();

	/**
	 * Audits configured built-module dependency boundaries.
	 */
	readonly #graphAuditor: ImportGraphAuditor;

	/**
	 * Verifies generated consumers in isolated installations.
	 */
	readonly #importCaseVerifier: IsolatedImportCaseVerifier;

	/**
	 * Requires lockfile root pins to match package.json.
	 */
	readonly #lockfilePinAuditor: LockfilePinAuditor;

	/**
	 * Reads validated package metadata.
	 */
	readonly #manifestReader: PackageManifestReader;

	/**
	 * Requires engines.node to cap the current major.
	 */
	readonly #nodeEngineAuditor = new NodeEngineAuditor();

	/**
	 * Creates the archive consumed by verification.
	 */
	readonly #packer: NpmPackagePacker;

	/**
	 * Runs consumer callbacks against the extracted npm archive.
	 */
	readonly #packedArchiveVerifier: PackedArchiveVerifier;

	/**
	 * Requires peer ranges to match exact tested pins.
	 */
	readonly #peerPinAuditor = new PeerPinAuditor();

	/**
	 * Audits archive exports and path policy.
	 */
	readonly #tarballAuditor: PackageTarballAuditor;

	/**
	 * Composes validated immutable builder output into fixed verification phases.
	 */
	protected constructor(configuration: PackageVerificationConfiguration, constructionToken?: symbol) {
		assert.equal(
			constructionToken,
			packageVerificationHarnessConstructionToken,
			"PackageVerificationHarness must be constructed by PackageVerificationHarnessBuilder",
		);

		this.#configuration = configuration;
		this.#importCaseVerifier = new IsolatedImportCaseVerifier(
			configuration.projectDirectory,
			configuration.copyNpmrcToConsumers,
		);
		this.#graphAuditor = new ImportGraphAuditor(configuration.projectDirectory);
		this.#lockfilePinAuditor = new LockfilePinAuditor(configuration.projectDirectory);
		this.#manifestReader = new PackageManifestReader(configuration.projectDirectory);
		this.#packer = new NpmPackagePacker(configuration.projectDirectory);
		this.#packedArchiveVerifier = new PackedArchiveVerifier(configuration.projectDirectory);
		this.#tarballAuditor = new PackageTarballAuditor(configuration);
	}

	/**
	 * Reads, packs, audits, consumes, and cleans one package.
	 */
	verify(): void {
		const manifest = this.#manifestReader.read();
		this.verifyExpectedVersion(manifest);
		if (this.#configuration.verifyNodeEngineCap) {
			this.#nodeEngineAuditor.verify(manifest);
		}
		if (this.#configuration.verifyLockfilePins) {
			this.#lockfilePinAuditor.verify(manifest);
		}
		if (this.#configuration.verifyPeerPins) {
			this.#peerPinAuditor.verify(manifest);
		}

		const temporaryDirectory = NpmCommandEnvironment.createLifecycleDirectory(
			this.#configuration.projectDirectory,
			this.#configuration.temporaryDirectoryPrefix,
		);
		try {
			const report = this.#packer.pack(temporaryDirectory);
			this.#tarballAuditor.verify(report, manifest);

			if (this.#configuration.verifyFilesField) {
				this.#filesFieldAuditor.verify(report, manifest);
			}

			this.#graphAuditor.verify(this.#configuration.importGraphs);

			for (const importCase of this.#configuration.importCases) {
				this.#importCaseVerifier.verify(importCase, manifest, report, temporaryDirectory);
			}

			this.#packedArchiveVerifier.verify(
				this.#configuration.packedArchiveCases,
				report.filename,
				temporaryDirectory,
			);
			this.persistVerifiedArchive(report, temporaryDirectory);
		} finally {
			rmSync(temporaryDirectory, { force: true, recursive: true });
		}
	}

	/**
	 * Copies the accepted archive outside the temporary lifecycle when configured.
	 */
	private persistVerifiedArchive(report: NpmPackReport, temporaryDirectory: string): void {
		const configuredDirectory = this.#configuration.verifiedArchiveDirectory;
		if (configuredDirectory === undefined) {
			return;
		}

		const filename = basename(report.filename);
		assert.equal(filename, report.filename, "Verified archive filename must contain one path segment");

		const destinationDirectory = resolve(configuredDirectory);
		mkdirSync(destinationDirectory, { recursive: true });
		copyFileSync(join(temporaryDirectory, filename), join(destinationDirectory, filename));
	}

	/**
	 * Checks the release version when configuration supplies one.
	 */
	private verifyExpectedVersion(manifest: PackageManifest): void {
		const expectedVersion = this.#configuration.expectedVersion;
		if (expectedVersion === undefined) {
			return;
		}

		assert.equal(
			manifest.version,
			expectedVersion,
			`Expected version ${expectedVersion} does not match package version ${manifest.version}`,
		);
	}
}
