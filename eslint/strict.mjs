import tseslint from "typescript-eslint";

/**
 * Typed linting presets. Spread after base. Consumer MUST set
 * languageOptions.parserOptions.projectService and tsconfigRootDir.
 */
const strict = [
	...tseslint.configs.recommendedTypeChecked,
	...tseslint.configs.stylisticTypeChecked,
];

export default strict;
