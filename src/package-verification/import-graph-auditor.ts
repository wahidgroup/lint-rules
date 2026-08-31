import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { PackageVerificationError } from "./package-verification-error.js";
import type { ImportGraphPolicy } from "./types.js";

/**
 * Matches a static import or export module specifier on one statement line.
 */
const staticSpecifierPattern =
	/^[ \t]*(?:import|export)\b[^\n]*?\bfrom\s*["']([^"'\n]+)["']|^[ \t]*import\s+["']([^"'\n]+)["']/gm;

/**
 * Matches a dynamic import with one string literal argument.
 */
const dynamicSpecifierPattern = /\bimport\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g;

/**
 * Matches a dynamic import call that is not a single string literal.
 */
const dynamicCallPattern = /\bimport\s*\(/g;

/**
 * Audits built JavaScript module graphs against declarative allowlists.
 */
export class ImportGraphAuditor {
	/**
	 * Anchors every configured graph path to the verified package.
	 */
	readonly #projectDirectory: string;

	/**
	 * Resolves every graph path from one package source directory.
	 */
	constructor(projectDirectory: string) {
		this.#projectDirectory = projectDirectory;
	}

	/**
	 * Audits configured graphs in declaration order.
	 */
	verify(policies: readonly ImportGraphPolicy[]): void {
		for (const policy of policies) {
			this.verifyPolicy(policy);
		}
	}

	/**
	 * Walks one entry and every relative JavaScript edge it reaches.
	 */
	private verifyPolicy(policy: ImportGraphPolicy): void {
		const entry = resolve(this.#projectDirectory, policy.entry);
		const directories = this.resolveDirectories(policy);
		const allowedFiles = this.resolveFiles(policy);
		let source: string;
		try {
			source = readFileSync(entry, "utf8");
		} catch {
			throw new PackageVerificationError("invalid-export", `Missing ${policy.name} entrypoint: ${policy.entry}`);
		}

		const pending: string[] = [entry];
		const visited = new Set<string>();
		while (pending.length > 0) {
			const file = pending.pop();
			PackageVerificationError.that(file !== undefined, "invalid-export", `Missing ${policy.name} graph file`);
			if (visited.has(file)) {
				continue;
			}

			visited.add(file);

			PackageVerificationError.that(
				this.isAllowedInternal(file, directories, allowedFiles),
				"invalid-export",
				`Forbidden ${policy.name} internal module: ${file}`,
			);

			let contents = source;
			if (file !== entry) {
				contents = readFileSync(file, "utf8");
			}

			const nextFiles = this.verifySourceImports(contents, file, policy);
			for (const nextFile of nextFiles) {
				pending.push(nextFile);
			}
		}
	}

	/**
	 * Resolves configured internal directories.
	 */
	private resolveDirectories(policy: ImportGraphPolicy): string[] {
		const directories: string[] = [];
		for (const directory of policy.directories) {
			directories.push(resolve(this.#projectDirectory, directory));
		}

		return directories;
	}

	/**
	 * Resolves configured internal files.
	 */
	private resolveFiles(policy: ImportGraphPolicy): ReadonlySet<string> {
		const files = new Set<string>();
		for (const file of policy.files) {
			files.add(resolve(this.#projectDirectory, file));
		}

		return files;
	}

	/**
	 * Reports whether a module belongs to an allowed graph root.
	 */
	private isAllowedInternal(
		file: string,
		directories: readonly string[],
		allowedFiles: ReadonlySet<string>,
	): boolean {
		if (allowedFiles.has(file)) {
			return true;
		}

		for (const directory of directories) {
			if (this.isPathInside(directory, file)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Checks canonical path containment without prefix matching.
	 */
	private isPathInside(directory: string, file: string): boolean {
		const pathFromDirectory = relative(directory, file);
		const outside =
			pathFromDirectory === ".." || pathFromDirectory.startsWith(`..${sep}`) || isAbsolute(pathFromDirectory);
		const inside = !outside;
		return inside;
	}

	/**
	 * Audits static and dynamic specifiers in one built module.
	 */
	private verifySourceImports(contents: string, file: string, policy: ImportGraphPolicy): readonly string[] {
		this.verifyDynamicCalls(contents, file, policy);

		const nextFiles: string[] = [];
		for (const specifier of this.collectStaticSpecifiers(contents)) {
			const resolved = this.verifySpecifier(
				specifier,
				file,
				policy,
				"static import or export",
				policy.staticDependencies,
			);
			if (resolved !== undefined) {
				nextFiles.push(resolved);
			}
		}

		for (const specifier of this.collectDynamicSpecifiers(contents)) {
			const resolved = this.verifySpecifier(
				specifier,
				file,
				policy,
				"dynamic import",
				policy.dynamicDependencies,
			);
			if (resolved !== undefined) {
				nextFiles.push(resolved);
			}
		}

		return nextFiles;
	}

	/**
	 * Rejects dynamic imports that are not a single string literal.
	 */
	private verifyDynamicCalls(contents: string, file: string, policy: ImportGraphPolicy): void {
		const projectPath = this.projectPath(file);
		const literalStarts = new Set<number>();
		for (const match of contents.matchAll(dynamicSpecifierPattern)) {
			if (match.index !== undefined) {
				literalStarts.add(match.index);
			}
		}

		for (const match of contents.matchAll(dynamicCallPattern)) {
			if (match.index === undefined) {
				continue;
			}

			PackageVerificationError.that(
				literalStarts.has(match.index),
				"invalid-export",
				`Dynamic ${policy.name} import must have exactly one argument in ${projectPath}`,
			);
		}
	}

	/**
	 * Collects static import and export specifiers.
	 */
	private collectStaticSpecifiers(contents: string): readonly string[] {
		const specifiers: string[] = [];
		for (const match of contents.matchAll(staticSpecifierPattern)) {
			const specifier = match[1] ?? match[2];
			if (specifier !== undefined) {
				specifiers.push(specifier);
			}
		}

		return specifiers;
	}

	/**
	 * Collects dynamic import string literals.
	 */
	private collectDynamicSpecifiers(contents: string): readonly string[] {
		const specifiers: string[] = [];
		for (const match of contents.matchAll(dynamicSpecifierPattern)) {
			const specifier = match[2];
			if (specifier !== undefined) {
				specifiers.push(specifier);
			}
		}

		return specifiers;
	}

	/**
	 * Allows a package specifier or resolves a relative JavaScript edge.
	 */
	private verifySpecifier(
		specifier: string,
		file: string,
		policy: ImportGraphPolicy,
		edge: string,
		allowedPackages: readonly string[],
	): string | undefined {
		if (!specifier.startsWith(".")) {
			PackageVerificationError.that(
				allowedPackages.includes(specifier),
				"invalid-export",
				`Forbidden ${policy.name} dependency: ${specifier}`,
			);
			return undefined;
		}

		const resolved = resolve(dirname(file), specifier);
		try {
			readFileSync(resolved);
		} catch {
			throw new PackageVerificationError(
				"invalid-export",
				`Unresolved ${policy.name} relative ${edge} ${JSON.stringify(specifier)} from ${this.projectPath(file)}`,
			);
		}

		return resolved;
	}

	/**
	 * Formats one project-relative path for graph failures.
	 */
	private projectPath(file: string): string {
		const projectPath = relative(this.#projectDirectory, file);
		return projectPath;
	}
}
