//! 生成 Tauri updater 的 latest.json 静态清单（release.yml 的「生成 latest.json」步骤调用）。
//!
//! 结构：
//! - `version` / `notes` / `pub_date`：全平台共用；
//! - `platforms`：windows-x86_64 / darwin-aarch64 / darwin-x86_64 / linux-x86_64，
//!   signature 为 minisign 签名文件内容，url 为 Release 资产直链；
//! - `android`：自定义段（Tauri 忽略未知键），供 Android 端应用内更新读取。
//!
//! 用法见 release.yml 的调用示例（--win/--mac/--linux/--apk 为对应 Release 资产 URL）。

import { readFileSync, writeFileSync } from "node:fs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) {
    console.error(`缺少参数 --${name}`);
    process.exit(1);
  }
  return process.argv[i + 1];
}

const version = arg("version");
const out = arg("out");

function readSig(name) {
  const file = arg(name);
  const content = readFileSync(file, "utf-8").trim();
  if (!content) {
    console.error(`签名文件为空: ${file}`);
    process.exit(1);
  }
  return content;
}

const win = arg("win");
const mac = arg("mac");
const linux = arg("linux");
const apk = arg("apk");
const apkSha256 = arg("apk-sha256");
const notesFile = arg("notes-file");
const notes = readFileSync(notesFile, "utf-8").trim();

if (!/^[0-9a-f]{64}$/.test(apkSha256.toLowerCase())) {
  console.error(`--apk-sha256 必须是 64 位十六进制 sha256，收到: ${apkSha256}`);
  process.exit(1);
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  platforms: {
    "windows-x86_64": {
      signature: readSig("win-sig"),
      url: win,
    },
    "darwin-aarch64": {
      signature: readSig("mac-sig"),
      url: mac,
    },
    // universal 构建：aarch64 产物同时覆盖 x86_64（Rosetta 不涉及，直接跑通用二进制）
    "darwin-x86_64": {
      signature: readSig("mac-sig"),
      url: mac,
    },
    "linux-x86_64": {
      signature: readSig("linux-sig"),
      url: linux,
    },
  },
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
