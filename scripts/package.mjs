import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { join } from 'node:path';
const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(data) { let crc = 0xffffffff; for (const byte of data) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
const files = [];
async function walk(dir, prefix = '') { for (const item of await readdir(dir, { withFileTypes: true })) { const name = prefix + item.name; if (item.isDirectory()) await walk(join(dir, item.name), name + '/'); else files.push({ name, data: await readFile(join(dir, item.name)) }); } }
await walk(process.argv[2] ?? 'dist');
// Ship only the user-facing portion of the README. Developer and test guides
// remain in the source repository, outside the installation ZIP.
const readme = await readFile('README.md', 'utf8');
const userGuide = readme.split(/^## 可选：手动测试工具\s*$/m)[0].trimEnd() + '\n';
if (userGuide.includes('readme-dev.md') || userGuide.includes('实机验收操作指南.md')) throw new Error('User guide includes developer/test links');
await writeFile('课堂哨-使用指南.md', userGuide);
files.push({ name: '使用指南.md', data: Buffer.from(userGuide) });
const local = [], central = []; let offset = 0;
const stamp = new Date();
const dosTime = (stamp.getUTCHours() << 11) | (stamp.getUTCMinutes() << 5) | Math.floor(stamp.getUTCSeconds() / 2);
const dosDate = ((stamp.getUTCFullYear() - 1980) << 9) | ((stamp.getUTCMonth() + 1) << 5) | stamp.getUTCDate();
for (const file of files) {
  const name = Buffer.from(file.name), compressed = deflateRawSync(file.data), crc = crc32(file.data);
  const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8);
  header.writeUInt16LE(dosTime, 10); header.writeUInt16LE(dosDate, 12);
  header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(file.data.length, 22); header.writeUInt16LE(name.length, 26);
  const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10);
  directory.writeUInt16LE(dosTime, 12); directory.writeUInt16LE(dosDate, 14);
  directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(file.data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
  local.push(header, name, compressed); central.push(directory, name); offset += header.length + name.length + compressed.length;
}
const directories = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directories.length, 12); end.writeUInt32LE(offset, 16);
await mkdir('temp', { recursive: true });
await writeFile('课堂哨-Edge-Chrome-0.1.1.zip', Buffer.concat([...local, directories, end]));
console.log(`已打包 ${files.length} 个插件文件：课堂哨-Edge-Chrome-0.1.1.zip`);
