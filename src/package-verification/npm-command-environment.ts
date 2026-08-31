import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

/**
 * Directory name that holds verification lifecycle work inside a package.
 */
const lifecycleRootName = ".tmp";

/**
 * Builds a hermetic npm environment rooted in one workspace directory.
 */
export class NpmCommandEnvironment {
	/**
	 * Creates one lifecycle directory on the verified package filesystem.
	 *
	 * npm pack write to os.tmpdir fails with errno -122 on overlay and quota-limited hosts.
	 */
	static createLifecycleDirectory(projectDirectory: string, prefix: string): string {
		const root = join(projectDirectory, lifecycleRootName);
		mkdirSync(root, { recursive: true });

		const directory = mkdtempSync(join(root, prefix));
		return directory;
	}

	/**
	 * Copies process.env and points npm cache, logs, and temp at the workspace.
	 */
	static forWorkspace(directory: string): NodeJS.ProcessEnv {
		const cacheDirectory = join(directory, ".npm-cache");
		const logsDirectory = join(directory, ".npm-logs");
		mkdirSync(cacheDirectory, { recursive: true });
		mkdirSync(logsDirectory, { recursive: true });

		const env: NodeJS.ProcessEnv = { ...process.env };
		env.npm_config_cache = cacheDirectory;
		env.NPM_CONFIG_CACHE = cacheDirectory;
		env.npm_config_logs_dir = logsDirectory;
		env.NPM_CONFIG_LOGS_DIR = logsDirectory;
		env.TMPDIR = directory;
		return env;
	}
}
