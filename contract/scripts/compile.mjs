// Compiles src/zkclaim.compact. Compact has no Windows build, so on Windows it runs inside WSL.
// Extra args pass through, e.g. `npm run compile -- --skip-zk`.
import { execFileSync } from 'node:child_process';

const args = ['compile', ...process.argv.slice(2), 'src/zkclaim.compact', 'src/managed/zkclaim'];
if (process.platform === 'win32') {
  execFileSync('wsl', ['--', 'bash', '-lc', `compact ${args.join(' ')}`], { stdio: 'inherit' });
} else {
  execFileSync('compact', args, { stdio: 'inherit' });
}
