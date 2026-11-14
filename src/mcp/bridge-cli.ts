import { runBridge } from './bridge';
const directory = process.argv[2];
if (!directory) { process.stderr.write('Usage: node dist/bridge.cjs <app-data-directory>\n'); process.exitCode = 1; }
else runBridge(directory).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
