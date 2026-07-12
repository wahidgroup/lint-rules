/**
 * NestJS ESLint presets. Spread after base.
 * Requires optional peer @darraghor/eslint-plugin-nestjs-typed and
 * languageOptions.parserOptions.projectService.
 */
import nestjsTyped from "@darraghor/eslint-plugin-nestjs-typed";

const nestjs = [
	nestjsTyped.configs.flatRecommended,
	{
		rules: {
			// Opinion: allow ApiProperty({ type: [T] }) shorthand
			"@darraghor/nestjs-typed/api-property-returning-array-should-set-array":
				"off",
			// Opt-in per app if Swagger response decorators are mandatory
			"@darraghor/nestjs-typed/api-method-should-specify-api-response":
				"off",
			// False positives with dynamic modules (forRoot), useFactory, useExisting, and global modules
			"@darraghor/nestjs-typed/injectable-should-be-provided": "off",
		},
	},
];

export default nestjs;
