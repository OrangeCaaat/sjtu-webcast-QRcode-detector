import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('public/wasm', { recursive: true });
await copyFile('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', 'public/wasm/zxing_reader.wasm');
await mkdir('public/licenses', { recursive: true });
await copyFile('node_modules/zxing-wasm/LICENSE', 'public/licenses/zxing-wasm-LICENSE.txt');
await copyFile('node_modules/vite/LICENSE.md', 'public/licenses/vite-LICENSE.txt');
await copyFile('third-party/ZXing-Cpp-LICENSE.txt', 'public/licenses/ZXing-Cpp-LICENSE.txt');
