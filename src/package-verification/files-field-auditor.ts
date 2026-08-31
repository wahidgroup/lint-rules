import { PackageVerificationError } from "./package-verification-error.js";
import type { NpmPackReport, PackageManifest } from "./package-verification-internals.js";

/**
 * Names npm always adds to a packed archive.
 */
const alwaysPackedNames = new Set([
	"package.json",
	"readme",
	"readme.md",
	"readme.txt",
	"license",
	"licence",
	"changelog",
	"changelog.md",
	"changes",
	"history",
]);

/**
 * Requires packed contents to match the manifest `files` allowlist.
 */
export class FilesFieldAuditor {
	/**
	 * Applies the allowlist to one npm pack report.
	 */
	verify(report: NpmPackReport, manifest: PackageManifest): void {
		const filesField = manifest.files;
		PackageVerificationError.that(
			filesField !== undefined && filesField.length > 0,
			"pack-files",
			"package.json files must be a non-empty array",
		);

		const packed = this.collectPackedPaths(report);
		for (const path of packed) {
			PackageVerificationError.that(
				this.isAllowed(path, filesField),
				"pack-files",
				`unexpected pack path: ${path}`,
			);
		}

		for (const entry of filesField) {
			PackageVerificationError.that(
				this.isPresent(entry, packed),
				"pack-files",
				`files entry not in pack: ${entry}`,
			);
		}

		PackageVerificationError.that(packed.has("package.json"), "pack-files", "package.json missing from pack");
	}

	/**
	 * Collects unique packed paths.
	 */
	private collectPackedPaths(report: NpmPackReport): ReadonlySet<string> {
		const paths = new Set<string>();
		for (const file of report.files) {
			paths.add(file.path);
		}

		return paths;
	}

	/**
	 * Reports whether a packed path is covered by `files` or npm always-packed names.
	 */
	private isAllowed(file: string, filesField: readonly string[]): boolean {
		const packedPath = this.packPath(file);
		if (alwaysPackedNames.has(packedPath.toLowerCase())) {
			return true;
		}

		for (const entry of filesField) {
			const allowlist = this.packPath(entry);
			if (allowlist.length === 0) {
				continue;
			}
			if (packedPath === allowlist) {
				return true;
			}
			if (packedPath.startsWith(`${allowlist}/`)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Reports whether a `files` entry appears as a packed file or directory prefix.
	 */
	private isPresent(entry: string, packed: ReadonlySet<string>): boolean {
		const allowlist = this.packPath(entry);
		if (allowlist.length === 0) {
			return false;
		}
		if (packed.has(allowlist)) {
			return true;
		}

		const prefix = `${allowlist}/`;
		for (const file of packed) {
			if (this.packPath(file).startsWith(prefix)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Strips a leading `./` so npm `files` entries match packed paths.
	 */
	private packPath(path: string): string {
		let normalized = path;
		if (normalized.startsWith("./")) {
			normalized = normalized.slice(2);
		}

		return normalized;
	}
}
