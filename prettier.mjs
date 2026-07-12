/**
 * Shared Prettier configuration.
 */
export default {
	useTabs: true,
	tabWidth: 4,
	overrides: [
		{
			files: ["*.yml", "*.yaml"],
			options: {
				useTabs: false,
				tabWidth: 2,
			},
		},
	],
};
