import { PackageVerificationError } from "./package-verification-error.js";
import type { PackageManifest } from "./package-verification-internals.js";

/**
 * Node major range with a lower bound and exclusive upper bound.
 */
const nodeMajorCapPattern = /^>=(\d+)(?:\.\d+)* <(\d+)$/u;

/**
 * Requires engines.node to cap the current major, matching .nvmrc house policy.
 */
export class NodeEngineAuditor {
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
	}
}
