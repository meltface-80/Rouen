"use strict";
// ---------------------------------------------------------------------------
// ESLint for Rouen (dev/quality.md, "Lint").
//
// A curated set, not a style guide: every rule here names a class of bug this
// project has shipped or is plainly likely to. Formatting is not checked.
//
// Run from the repository root:  npm run lint
// Existing violations are recorded in tools/lint/eslint-suppressions.json, so
// only NEW ones fail. That file may only shrink: fix a suppressed violation and
// `npm run lint:prune` takes it out for good.
// ---------------------------------------------------------------------------

const globals = require("globals");

// The bug classes CLAUDE.md used to police with greps and checklists.
const BUG_RULES = {
  // The renamed-variable class (DISCOGS_TOKEN vs discogsToken): a name nobody
  // declares throws at runtime, on whatever path reaches it first.
  "no-undef": "error",
  // The v1.5.66 startup crash: `x = …` on line N while `let x` sits on line
  // N+500 is a temporal-dead-zone ReferenceError. Functions are hoisted, so
  // they are allowed; variables and classes are not.
  "no-use-before-define": ["error", { functions: false, classes: true, variables: true }],
  // "No silent catch": an empty block is an error; a block holding a comment
  // explaining why silence is safe is not empty, so it passes.
  "no-empty": ["error", { allowEmptyCatch: false }],
  "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
  "no-redeclare": "error",
  "no-const-assign": "error",
  "no-dupe-keys": "error",
  "no-dupe-else-if": "error",
  "no-duplicate-case": "error",
  "no-self-assign": "error",
  "no-self-compare": "error",
  "no-unreachable": "error",
  "no-unsafe-finally": "error",
  "no-unsafe-negation": "error",
  "no-fallthrough": "error",
  "no-cond-assign": ["error", "except-parens"],
  "no-constant-binary-expression": "error",
  "no-loss-of-precision": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
  "no-async-promise-executor": "error",
  "no-promise-executor-return": "error",
  "no-import-assign": "error",
  "no-shadow-restricted-names": "error",
  "no-sparse-arrays": "error",
  "no-new-func": "error",
};

// Pre-flight step 4 as a rule (the v1.6.52 "albums untappable after Back"
// bug): a screen must never be saved or restored by READING .innerHTML —
// re-parsing the markup builds fresh nodes and drops every listener. Writing
// it is fine; reading it is not.
const NO_INNERHTML_READ = {
  "no-restricted-syntax": ["error", {
    selector: "MemberExpression[property.name='innerHTML']:not(AssignmentExpression > MemberExpression.left)",
    message: "Don't read .innerHTML to save or restore a screen — move the live nodes into a DocumentFragment (CLAUDE.md pre-flight 4).",
  }],
};

module.exports = [
  {
    ignores: [
      "**/node_modules/**",
      "docs/**",
      "old/**",
      "data/**",
      "public/fonts/**",
      "lib/hqp/profiles/**",
    ],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: BUG_RULES,
  },
  {
    // Classic browser scripts: each <script> shares one global scope, so a
    // name declared in sharecard.js is in scope in app.js.
    files: ["public/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser },
    },
    rules: { ...BUG_RULES, ...NO_INNERHTML_READ },
  },
  {
    // sharecard.js declares ShareCard, and format.js (v1.9.70-t1) its five helpers; index.html loads both before app.js.
    files: ["public/app.js"],
    languageOptions: { globals: { ShareCard: "readonly", fmtDuration: "readonly", escapeHtml: "readonly", fmtTime: "readonly", fmtDate: "readonly", fmtSize: "readonly" } },
  },
  {
    files: ["tools/lint/eslint.config.js"],
    languageOptions: { sourceType: "commonjs" },
  },
];
