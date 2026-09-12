#!/usr/bin/env node
//! 统一更新全仓库版本号，并发刷新两个锁文件。
//!
//! 版本号声明位置：
//!   - package.json（根）        —— pnpm 工作区根
//!   - apps/web/package.json     —— 前端包
//!   - apps/client/package.json  —— Tauri 壳包
//!   - apps/client/tauri.conf.json —— 桌面/移动端安装包版本
//!   - Cargo.toml（根，[workspace.package]）—— 所有 Rust crate 的 version.workspace
//! 锁文件：Cargo.lock 由 `cargo update -w` 刷新；pnpm-lock.yaml 由 `pnpm install --lockfile-only` 刷新。
//!
//! 用法：pnpm bump 0.1.2   （或 node scripts/bump-version.mjs 0.1.2）
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const arg = process.argv[2];
if (!arg || !/^v?\d+\.\d+\.\d+(-[\w.]+)?$/.test(arg)) {
  console.error("用法: pnpm bump <x.y.z>（如 0.1.1）");
  process.exit(1);
}
const version = arg.replace(/^v/, "");

const files = [
  "package.json",
  "apps/web/package.json",
  "apps/client/package.json",
  "apps/client/tauri.conf.json",
];

for (const file of files) {
  const s = readFileSync(file, "utf8");
  const next = s.replace(/("version":\s*)"[^"]+"/, `$1"${version}"`);
  if (next === s) {
    console.error(`[bump] ${file}: 未找到 version 字段`);
    process.exit(1);
  }
  writeFileSync(file, next);
  console.log(`[bump] ${file} -> ${version}`);
}

const cargo = readFileSync("Cargo.toml", "utf8");
const cargoNext = cargo.replace(/^version = "[^"]+"/m, `version = "${version}"`);
if (cargoNext === cargo) {
  console.error("[bump] Cargo.toml: 未找到 workspace version");
  process.exit(1);
}
writeFileSync("Cargo.toml", cargoNext);
console.log(`[bump] Cargo.toml -> ${version}`);

execSync("cargo update -w", { stdio: "inherit" });
execSync("pnpm install --lockfile-only", { stdio: "inherit" });
console.log(`[bump] 锁文件已刷新，全部版本 -> ${version}`);
