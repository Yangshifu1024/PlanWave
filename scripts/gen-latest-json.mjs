//! 生成 Tauri updater 的 latest.json 静态清单（release.yml 的「生成 latest.json」步骤调用）。
//!
//! 结构：
//! - `version` / `notes` / `pub_date`：全平台共用；
//! - `platforms`：按可用签名生成条目（windows-x86_64 / darwin-aarch64 /
//!   darwin-x86_64 / linux-x86_64），signature 为 minisign 签名文件内容，
//!   url 为 Release 资产直链；
//! - `android`：自定义段（Tauri 忽略未知键），供 Android 端应用内更新读取。
//!
//! 用法见 release.yml 的调用示例；未提供 URL+签名的平台不会出现在清单里。

import { readFileSync, writeFileSync } from "node:fs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) {
    console.error(`缺少参数 --${name}`);
    process.exit(1);
  }
  return process.argv[i + 1];
}

/** 可选参数：未提供返回 undefined（对应平台不进清单）。 */
function opt(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i + 1 >= process.argv.length ? undefined : process.argv[i + 1];
}

const version = arg("version");
const out = arg("out");
const notesFile = arg("notes-file");
const apk = arg("apk");
const apkSha256 = arg("apk-sha256");
const notes = readFileSync(notesFile, "utf-8").trim();

if (!/^[0-9a-f]{64}$/.test(apkSha256.toLowerCase())) {
  console.error(`--apk-sha256 必须是 64 位十六进制 sha256，收到: ${apkSha256}`);
  process.exit(1);
}

const platforms = {};
function addPlatform(key, urlName, sigName) {
  const url = opt(urlName);
  const sigFile = opt(sigName);
  if (!url || !sigFile) return;
  const signature = readFileSync(sigFile, "utf-8").trim();
  if (!signature) {
    console.error(`签名文件为空: ${sigFile}`);
    process.exit(1);
  }
  platforms[key] = { signature, url };
}

addPlatform("windows-x86_64", "win", "win-sig");
addPlatform("linux-x86_64", "linux", "linux-sig");
addPlatform("darwin-aarch64", "mac", "mac-sig");
// universal 构建：aarch64 产物同时覆盖 x86_64
if (platforms["darwin-aarch64"]) {
  platforms["darwin-x86_64"] = platforms["darwin-aarch64"];
}

if (Object.keys(platforms).length === 0) {
  console.error("没有任何平台的签名产物，拒绝生成空清单");
  process.exit(1);
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  platforms,
  android: {
    version,
    url: apk,
    sha256: apkSha256.toLowerCase(),
    notes,
  },
};

writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `latest.json 已生成（v${version}，平台: ${Object.keys(manifest.platforms).join(", ")}）`,
);
