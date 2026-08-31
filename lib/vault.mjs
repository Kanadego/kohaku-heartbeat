// 琥珀的心跳 · 透明加解密读写层
// 用法（供 bin/ 下各脚本 import）：
//   import { loadJson, saveJson } from '../lib/vault.mjs'
//   const db = loadJson(SEEDS_FILE)          // 自动识别密文(KHBV1)或明文
//   saveJson(SEEDS_FILE, obj)                // 恒以 DPAPI 密文落盘
//
// 机制：Node 与 vault.ps1 之间只通过临时文件交接(绕开沙箱管道限制)，
// 明文窗口 = 单次读写的毫秒级瞬间。加密失败时 fail-closed 抛错。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const VAULT_PS1 = path.join(ROOT, 'bin', 'vault.ps1');
const MAGIC = Buffer.from('KHBV1', 'ascii');

/** 唯一临时文件名：固定名并发会互踩（tamako 评审隐患），加随机后缀隔离 */
const tmpName = (file, kind) =>
  path.join(path.dirname(file), `.khv-${path.basename(file)}-${kind}-${crypto.randomUUID().slice(0, 8)}.tmp`);

const runVault = (args) => {
  // stdio:'ignore' —— 不捕获管道，规避沙箱 EPERM；错误靠退出码与产物存在性判断
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', VAULT_PS1, ...args],
    { stdio: 'ignore', timeout: 30000 });
  if (r.status !== 0) throw new Error(`vault ${args[0]} failed (exit ${r.status})`);
};

export const isEncrypted = (file) => {
  if (!fs.existsSync(file)) return false;
  const fd = fs.openSync(file, 'r');
  const hdr = Buffer.alloc(MAGIC.length);
  fs.readSync(fd, hdr, 0, hdr.length, 0);
  fs.closeSync(fd);
  return hdr.equals(MAGIC);
};

/** 读 JSON：密文自动解密（临时明文用后即焚），明文直接兼容读取 */
export function loadJson(file) {
  if (!fs.existsSync(file)) return null;
  if (!isEncrypted(file)) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return null; }
  }
  const tmp = tmpName(file, 'plain');
  runVault(['unprotect', '-in', file, '-out', tmp]);
  const data = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.rmSync(tmp, { force: true });
  return data;
}

/** 写 JSON：先写临时明文 -> DPAPI 加密成正式文件(原子替换) -> 删临时 */
export function saveJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = tmpName(file, 'plain');
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  const encTmp = tmpName(file, 'enc');
  runVault(['protect', '-in', tmp, '-out', encTmp]);
  fs.renameSync(encTmp, file);
  fs.rmSync(tmp, { force: true });
}

/** 读文本文件：账本等需要人肉可读的文件走这里——不加密，保持透明 */
export function readText(file, fallback = '') {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}

/** 加密任意二进制文件（如截图）：inFile -> 加密后的 outFile */
export function encryptFile(inFile, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const encTmp = tmpName(outFile, 'enc');
  runVault(['protect', '-in', inFile, '-out', encTmp]);
  fs.renameSync(encTmp, outFile);
}

/** 解密任意二进制文件：加密的 inFile -> 明文 outFile（调用方负责用后即焚） */
export function decryptFile(inFile, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  runVault(['unprotect', '-in', inFile, '-out', outFile]);
}
