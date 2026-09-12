#!/usr/bin/env node
//! 释放开发端口：杀掉监听指定端口的进程（Windows: netstat+taskkill；Unix: fuser）。
//! 用途：E2E 与 preview 前清理残留服务，保证固定端口约定（API=8787, web=4173）不被占用卡死。
import { execSync } from "node:child_process";

const ports = process.argv.slice(2).map(Number).filter(Boolean);
if (ports.length === 0) {
  console.error("用法: node free-ports.mjs <port> [port...]");
  process.exit(1);
}

for (const port of ports) {
  if (process.platform === "win32") {
    const out = execSync("netstat -ano -p TCP", { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/);
      if (m && Number(m[1]) === port) pids.add(m[2]);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
        console.log(`[free-ports] ${port}: 已终止 PID ${pid}`);
      } catch {
        /* 进程可能已退出 */
      }
    }
  } else {
    try {
      execSync(`fuser -k ${port}/tcp`, { stdio: "ignore" });
      console.log(`[free-ports] ${port}: 已清理`);
    } catch {
      /* 端口本就空闲 */
    }
  }
}
