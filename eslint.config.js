// Style rules only: braces on every if/else, blank lines between steps.
// Layout (tabs, line width) is Prettier's job, see .prettierrc.json.
export default [
	{
		files: ["**/*.js", "**/*.mjs"],
		languageOptions: {
			ecmaVersion: 2024,
			sourceType: "module",
		},
		linterOptions: { reportUnusedDisableDirectives: "off" },
		rules: {
			curly: ["error", "all"],
			"padding-line-between-statements": [
				"error",
				{ blankLine: "always", prev: "*", next: "return" },
				{ blankLine: "always", prev: ["const", "let"], next: "*" },
				{ blankLine: "any", prev: ["const", "let"], next: ["const", "let"] },
				{ blankLine: "always", prev: "*", next: ["if", "for", "while", "try", "switch"] },
				{ blankLine: "always", prev: ["if", "for", "while", "try", "switch"], next: "*" },
				{ blankLine: "always", prev: "*", next: "function" },
			],
		},
	},
	{
		// The page script runs in the browser as a classic script.
		files: ["public/**/*.js"],
		languageOptions: { sourceType: "script" },
	},
	{ ignores: ["node_modules/", "traces/", "test-results/", ".vercel/"] },
];
