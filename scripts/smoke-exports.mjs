#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import path from "node:path";

/**
 * Smoke-load every public export. Fails CI if an export cannot be imported.
 */
const root = path.resolve(import.meta.dirname, "..");

const exportsToLoad = [
	"eslint/base.mjs",
	"eslint/strict.mjs",
	"eslint/react.mjs",
	"eslint/nestjs.mjs",
	"eslint/playwright.mjs",
	"prettier.mjs",
];

for (const rel of exportsToLoad) {
	const fileUrl = pathToFileURL(path.join(root, rel)).href;
	await import(fileUrl);
	console.log(`ok ${rel}`);
}

console.log("smoke exports: all loaded");
