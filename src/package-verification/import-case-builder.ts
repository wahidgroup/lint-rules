import assert from "node:assert/strict";

import type { ImportCase, ImportEnvironment, PeerSelection } from "./types.js";

/**
 * Portable names accepted for generated import-case directories.
 */
const importCaseNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Constructs one immutable generated import case.
 */
export class ImportCaseBuilder {
	/**
	 * Creates a named import-case builder.
	 */
	static create(name: string): ImportCaseBuilder {
		const builder = new ImportCaseBuilder(name);
		return builder;
	}

	/**
	 * Contains validated public export keys.
	 */
	readonly #exportKeys: string[] = [];

	/**
	 * Identifies the generated consumer.
	 */
	readonly #name: string;

	/**
	 * Contains explicitly selected peer names.
	 */
	readonly #peers: string[] = [];

	/**
	 * Contains React ambient type package names.
	 */
	readonly #reactTypePackages: string[] = [];

	/**
	 * Selects generated compiler and runtime behavior.
	 */
	#environment: ImportEnvironment | undefined;

	/**
	 * Selects declared package peers.
	 */
	#peerSelection: PeerSelection = "none";

	/**
	 * Validates the case identity.
	 */
	private constructor(name: string) {
		ImportCaseBuilder.assertName(name);
		this.#name = name;
	}

	/**
	 * Imports public package export keys.
	 */
	exports(...exportKeys: readonly string[]): ImportCaseBuilder {
		assert.ok(exportKeys.length > 0, "At least one package export key is required");

		const validated = [...this.#exportKeys];
		for (const exportKey of exportKeys) {
			assert.ok(exportKey === "." || exportKey.startsWith("./"), `Invalid package export key: ${exportKey}`);
			assert.ok(!validated.includes(exportKey), `Duplicate package export key: ${exportKey}`);

			validated.push(exportKey);
		}

		this.#exportKeys.splice(0, this.#exportKeys.length, ...validated);

		return this;
	}

	/**
	 * Generates a strict Node import consumer.
	 */
	node(): ImportCaseBuilder {
		this.selectEnvironment("node");
		return this;
	}

	/**
	 * Generates a strict ES and DOM import consumer.
	 */
	browser(): ImportCaseBuilder {
		this.selectEnvironment("browser");
		return this;
	}

	/**
	 * Generates a strict React import consumer.
	 */
	react(...typePackages: readonly string[]): ImportCaseBuilder {
		assert.ok(typePackages.length > 0, "At least one React type package is required");

		const validated = this.validatePackageNames(this.#reactTypePackages, typePackages, "React type package");

		this.selectEnvironment("react");
		this.#reactTypePackages.splice(0, this.#reactTypePackages.length, ...validated);
		return this;
	}

	/**
	 * Selects no declared peers.
	 */
	noPeers(): ImportCaseBuilder {
		this.selectPeers("none", []);
		return this;
	}

	/**
	 * Selects every declared peer.
	 */
	allPeers(): ImportCaseBuilder {
		this.selectPeers("all", []);
		return this;
	}

	/**
	 * Selects required declared peers.
	 */
	requiredPeers(): ImportCaseBuilder {
		this.selectPeers("required", []);
		return this;
	}

	/**
	 * Selects optional declared peers.
	 */
	optionalPeers(): ImportCaseBuilder {
		this.selectPeers("optional", []);
		return this;
	}

	/**
	 * Selects named declared peers.
	 */
	explicitPeers(...peers: readonly string[]): ImportCaseBuilder {
		assert.ok(peers.length > 0, "At least one peer name is required");
		this.selectPeers("explicit", peers);
		return this;
	}

	/**
	 * Creates one validated immutable import case.
	 */
	build(): ImportCase {
		assert.ok(this.#environment !== undefined, "Import environment must be selected");
		assert.ok(this.#exportKeys.length > 0, "At least one package export key is required");

		const importCase: ImportCase = Object.freeze({
			environment: this.#environment,
			exportKeys: Object.freeze([...this.#exportKeys]),
			name: this.#name,
			peers: Object.freeze([...this.#peers]),
			peerSelection: this.#peerSelection,
			reactTypePackages: Object.freeze([...this.#reactTypePackages]),
		});
		return importCase;
	}

	/**
	 * Selects one generated environment.
	 */
	private selectEnvironment(environment: ImportEnvironment): void {
		assert.ok(this.#environment === undefined, "Import environment is already selected");

		this.#environment = environment;
	}

	/**
	 * Replaces the peer selection.
	 */
	private selectPeers(selection: PeerSelection, peers: readonly string[]): void {
		const validated = this.validatePackageNames([], peers, "Peer");
		this.#peerSelection = selection;
		this.#peers.splice(0, this.#peers.length, ...validated);
	}

	/**
	 * Returns validated unique package names without mutating builder state.
	 */
	private validatePackageNames(current: readonly string[], incoming: readonly string[], label: string): string[] {
		const validated = [...current];
		for (const packageName of incoming) {
			assert.ok(packageName.trim().length > 0, `${label} must not be empty`);
			assert.ok(!validated.includes(packageName), `Duplicate ${label.toLowerCase()}: ${packageName}`);

			validated.push(packageName);
		}

		return validated;
	}

	/**
	 * Requires a lowercase kebab-case import-case name.
	 */
	private static assertName(name: string): void {
		assert.ok(importCaseNamePattern.test(name), "Import case name must use lowercase kebab-case");
	}
}
