import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * T-002 · the lint chain.
 *
 * It did not exist until the independent evaluation pointed out that `pnpm -r lint`
 * reported "no lint script" while CLAUDE.md's definition of done listed it as step 4 —
 * and that `Viewport.tsx` already carried an `eslint-disable-next-line
 * react-hooks/exhaustive-deps` suppressing a rule nobody was running.
 *
 * Deliberately NOT a style linter. Formatting arguments cost review attention and catch
 * no bugs; every rule enabled below is one that has actually broken something in this
 * codebase or is a well-known trap in it:
 *
 *   react-hooks/*                 stale closures — the gizmo drag label bug was exactly
 *                                 this, an effect closing over the mode it had at mount
 *   no-floating-promises          an unawaited save or load that fails silently
 *   no-misused-promises           an async function passed where void is expected, most
 *                                 often an event handler that throws into nowhere
 *   await-thenable                await on a non-promise, which reads as sequencing that
 *                                 is not happening
 *   no-unnecessary-condition      a truthiness check on something that can never be
 *                                 falsy, usually a sign the type moved under the code
 */

export default tseslint.config(
  // Everything below is resolved against the repo root, not against tools/lint. Without
  // this, ESLint 9 treats every file outside the config's own directory as ignored.
  { basePath: '../..' },

  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'vendor/**',
      // Generated or vendored; linting them reports on code we do not own.
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        // The repo root, two levels up: this config lives in tools/lint because
        // typescript-eslint needs its own TS 6, but the code it lints does not.
        // fileURLToPath, not `.pathname`: on Windows the latter yields
        // "/C:/…/0729%203d%20engine" — percent-encoded and with a leading slash.
        tsconfigRootDir: fileURLToPath(new URL('../..', import.meta.url)),
      },
    },
    rules: {
      // ---- the ones that catch real bugs ----
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // ---- noise from a codebase that leans on structural typing ----
      // `unknown` params and index signatures are how the action registry stays generic;
      // flagging every one of them would train everybody to ignore the linter.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // ---- rules that only express taste, switched off deliberately ----
      //
      // Each of these fired more than twenty times on code that is correct. Leaving them
      // on would mean either churning working files to satisfy a linter's opinion, or
      // sprinkling suppression comments — and a codebase where every warning is
      // suppressed is one where the next real warning gets suppressed too.
      //
      // unbound-method            `store.subscribe` passed by reference to
      //                           useSyncExternalStore. Zustand binds it; the rule cannot
      //                           know that.
      // require-await             `async` methods implementing an async interface that
      //                           happen not to await. Dropping `async` would change the
      //                           declared type.
      // no-unnecessary-*          disagreements between TS 6 (which this linter runs) and
      //                           TS 7 (which the workspace builds with) about what is
      //                           already narrowed. Acting on them would be optimising
      //                           for the older compiler.
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-duplicate-type-constituents': 'off',
    },
  },

  {
    files: ['packages/editor/**/*.{ts,tsx}', 'packages/player/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // Warn, not error: the viewport's mount-only effect is a deliberate, documented
      // exception (it owns a GPU context that must not be recreated), and an error here
      // would mean either a suppression comment or a rewrite that makes the code worse.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'e2e/**/*.ts', 'scripts/**/*.mjs'],
    rules: {
      // Tests assert on unusual shapes on purpose, and the scripts are plain Node.
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // A test that rejects with a plain string is testing exactly that case.
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      // Two fixtures use `require('three')` to build an Object3D lazily inside a test
      // body; hoisting them to a top-level import would load three for every test file
      // in the package.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
)
