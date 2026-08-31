import type { PackageManifest } from "./package-verification-internals.js";
import { PackageVerificationError } from "./package-verification-error.js";

/**
 * Caret range with an exact x.y.z floor.
 */
const caretExactPattern = /^\^(\d+\.\d+\.\d+)$/u;

/**
 * Lower-bound range such as >=9 or >=7.3.4.
 */
const gtePattern = /^>=(\d+)(?:\.(\d+))?(?:\.(\d+))?$/u;

/**
 * Capped range such as >=6 <6.1.0 or >=24 <25.
 */
const cappedGtePattern = /^>=(\d+)(?:\.(\d+))?(?:\.(\d+))?\s+<(\d+)(?:\.(\d+))?(?:\.(\d+))?$/u;

/**
 * Exact x.y.z pin.
 */
const exactVersionPattern = /^(\d+)\.(\d+)\.(\d+)$/u;

/**
 * Requires each peer range to have a matching exact tested pin.
 */
export class PeerPinAuditor {
	/**
	 * Checks optional caret floors and required lower bounds against exact pins.
	 */
	verify(manifest: PackageManifest): void {
		for (const [name, range] of Object.entries(manifest.peerDependencies)) {
			const tested = this.testedExact(name, manifest);
			PackageVerificationError.that(
				tested !== undefined,
				"peer-pin",
				`peer ${name} has no exact pin in dependencies or devDependencies`,
			);

			const optional = this.isOptional(name, manifest);
			this.verifyRange(name, range, tested, optional);
		}
	}

	/**
	 * Returns the exact tested version for one package name.
	 */
	private testedExact(name: string, manifest: PackageManifest): string | undefined {
		const fromDependencies = manifest.dependencies[name];
		if (fromDependencies !== undefined) {
			return fromDependencies;
		}

		return manifest.devDependencies[name];
	}

	/**
	 * Reports whether peerDependenciesMeta marks the peer optional.
	 */
	private isOptional(name: string, manifest: PackageManifest): boolean {
		const metadata = manifest.peerDependenciesMeta[name];
		if (metadata === undefined) {
			return false;
		}

		return metadata.optional === true;
	}

	/**
	 * Applies caret-floor equality or >= satisfaction.
	 */
	private verifyRange(name: string, range: string, tested: string, optional: boolean): void {
		const caret = caretExactPattern.exec(range);
		if (caret !== null) {
			const floor = caret[1];
			PackageVerificationError.that(
				tested === floor,
				"peer-pin",
				`peer ${name} range ${range} requires exact tested pin ${floor}, found ${tested}`,
			);
			return;
		}

		const gte = gtePattern.exec(range);
		if (gte !== null) {
			PackageVerificationError.that(
				this.satisfiesGte(tested, gte),
				"peer-pin",
				`peer ${name} tested pin ${tested} does not satisfy ${range}`,
			);
			return;
		}

		const capped = cappedGtePattern.exec(range);
		if (capped !== null) {
			PackageVerificationError.that(
				this.satisfiesCappedGte(tested, capped),
				"peer-pin",
				`peer ${name} tested pin ${tested} does not satisfy ${range}`,
			);
			return;
		}

		PackageVerificationError.that(
			!optional,
			"peer-pin",
			`optional peer ${name} must use a ^x.y.z or >= range, found ${range}`,
		);
		PackageVerificationError.that(false, "peer-pin", `peer ${name} range is unsupported: ${range}`);
	}

	/**
	 * Reports whether an exact version meets a >= lower bound.
	 */
	private satisfiesGte(tested: string, match: RegExpExecArray): boolean {
		const testedMatch = exactVersionPattern.exec(tested);
		if (testedMatch === null) {
			return false;
		}

		const testedParts = [Number(testedMatch[1]), Number(testedMatch[2]), Number(testedMatch[3])];
		const boundParts = [Number(match[1]), Number(match[2] ?? "0"), Number(match[3] ?? "0")];
		for (let index = 0; index < 3; index += 1) {
			const testedPart = testedParts[index];
			const boundPart = boundParts[index];
			if (testedPart === undefined || boundPart === undefined) {
				return false;
			}
			if (testedPart > boundPart) {
				return true;
			}
			if (testedPart < boundPart) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Reports whether an exact version sits in a >= lower and < upper range.
	 */
	private satisfiesCappedGte(tested: string, match: RegExpExecArray): boolean {
		const lower = this.parseVersionParts([match[1], match[2], match[3]]);
		const upper = this.parseVersionParts([match[4], match[5], match[6]]);
		const current = this.parseVersionParts(this.exactVersionCaptures(tested));
		if (lower === undefined || upper === undefined || current === undefined) {
			return false;
		}

		const atOrAboveLower = this.compareVersionParts(current, lower) >= 0;
		const belowUpper = this.compareVersionParts(current, upper) < 0;
		return atOrAboveLower && belowUpper;
	}

	/**
	 * Parses three numeric version captures.
	 */
	private parseVersionParts(
		captures: readonly (string | undefined)[],
	): readonly [number, number, number] | undefined {
		const major = Number(captures[0] ?? "0");
		const minor = Number(captures[1] ?? "0");
		const patch = Number(captures[2] ?? "0");
		if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) {
			return undefined;
		}

		return [major, minor, patch];
	}

	/**
	 * Splits an exact x.y.z pin into capture strings.
	 */
	private exactVersionCaptures(tested: string): readonly (string | undefined)[] {
		const testedMatch = exactVersionPattern.exec(tested);
		if (testedMatch === null) {
			return [];
		}

		return [testedMatch[1], testedMatch[2], testedMatch[3]];
	}

	/**
	 * Compares two x.y.z tuples.
	 */
	private compareVersionParts(
		left: readonly [number, number, number],
		right: readonly [number, number, number],
	): number {
		for (let index = 0; index < 3; index += 1) {
			const leftPart = left[index];
			const rightPart = right[index];
			if (leftPart === undefined || rightPart === undefined) {
				return 0;
			}
			if (leftPart > rightPart) {
				return 1;
			}
			if (leftPart < rightPart) {
				return -1;
			}
		}

		return 0;
	}
}
