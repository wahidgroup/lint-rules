#!/usr/bin/env node

/**
 * Smoke-load every public export. Fails CI if an export cannot be resolved.
 */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const pkgPath = path.join(root, "package.json");

const pkgRaw = await readFile(pkgPath, "utf8");
const pkg = JSON.parse(pkgRaw);
if (typeof pkg !== "object" || pkg === null) {
	console.error("package.json is not an object");
	process.exit(1);
}

const exportsField = Reflect.get(pkg, "exports");
if (typeof exportsField !== "object" || exportsField === null) {
	console.error("package.json missing exports");
	process.exit(1);
}

/**
 * Resolves an export target to a filesystem path under the package root.
 */
function resolveExportTarget(target) {
	if (typeof target === "string") {
		return path.resolve(root, target);
	}
	if (typeof target !== "object" || target === null) {
		return undefined;
	}

	const defaultTarget = Reflect.get(target, "default");
	if (typeof defaultTarget === "string") {
		return path.resolve(root, defaultTarget);
	}

	const typesTarget = Reflect.get(target, "types");
	if (typeof typesTarget === "string") {
		return path.resolve(root, typesTarget);
	}

	return undefined;
}

let failed = false;

for (const [exportKey, target] of Object.entries(exportsField)) {
	const filePath = resolveExportTarget(target);
	if (filePath === undefined) {
		console.error(`unresolved export: ${exportKey}`);
		failed = true;
		continue;
	}

	const rel = path.relative(root, filePath);

	try {
		if (filePath.endsWith(".mjs") || filePath.endsWith(".js")) {
			await import(pathToFileURL(filePath).href);
		} else if (filePath.endsWith(".json")) {
			JSON.parse(await readFile(filePath, "utf8"));
		} else {
			const content = await readFile(filePath, "utf8");
			if (content.length === 0) {
				console.error(`empty export target: ${exportKey} -> ${rel}`);
				failed = true;
				continue;
			}
		}
	} catch (err) {
		console.error(`failed ${exportKey} -> ${rel}: ${err}`);
		failed = true;
		continue;
	}

	console.log(`ok ${exportKey} -> ${rel}`);
}

if (failed) {
	process.exit(1);
}

console.log("smoke exports: all loaded");
