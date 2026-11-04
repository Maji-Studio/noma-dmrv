import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  });
}
it('limits the explicit Sent rewrite capability to the CLI and its three internal forwarding/guard modules', () => {
  const users = sourceFiles('src').filter(path => /\ballowSentRewrite\b/.test(readFileSync(path, 'utf8')))
    .map(path => relative('src', path)).sort();
  expect(users).toEqual([
    'data-access/feedstock-recalculation.ts',
    'data-access/feedstock-run-allocations.ts',
    'data-access/feedstock-transport-ownership-freeze.ts',
    'lib/cli/recalculate-feedstock-allocations.ts',
  ]);
});
