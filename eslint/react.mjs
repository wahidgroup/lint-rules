/**
 * React ESLint presets (jsx-a11y + react-hooks flat recommended).
 * Spread after base. Requires optional peers listed in package.json.
 * *.d.ts ignored only for these React rules (not a global ignore).
 */
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";

const react = [
	{
		...jsxA11y.flatConfigs.recommended,
		ignores: ["**/*.d.ts"],
	},
	{
		...reactHooks.configs.flat.recommended,
		ignores: ["**/*.d.ts"],
	},
];

export default react;
