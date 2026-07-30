/**
 * @w3/editor — the editor shell.
 *
 * NOT IMPLEMENTED YET. Task cards T-060 … T-072 and T-090 … T-093 cover this package,
 * and none of them has been started. The file exists so that `pnpm -r typecheck` has
 * something to check and the package boundary guards have a package to scan.
 *
 * Do not add feature code here: T-060 owns `src/App.tsx` and `src/layout/**`,
 * T-061 owns `src/store/document-store.ts`. Starting elsewhere makes the parallel-wave
 * table in TASK_BACKLOG §并行波次 wrong.
 */
export const NOT_IMPLEMENTED = 'T-060..T-072, T-090..T-093' as const
