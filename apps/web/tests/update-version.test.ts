//! 自动更新的纯函数测试：版本比较、跳过版本、Web 过期判定。

import { describe, expect, it } from "vitest";
import { isNewerVersion, isWebStale, shouldPromptUpdate } from "../src/lib/updater";

describe("isNewerVersion", () => {
  it("按 major/minor/patch 逐位比较", () => {
    expect(isNewerVersion("0.3.0", "0.2.9")).toBe(true);
    expect(isNewerVersion("0.3.0", "0.3.0")).toBe(false);
    expect(isNewerVersion("0.2.9", "0.3.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("0.3.1", "0.3.0")).toBe(true);
  });

  it("忽略前导 v 与 pre-release 后缀", () => {
    expect(isNewerVersion("v0.3.0", "0.2.9")).toBe(true);
    expect(isNewerVersion("0.4.0-beta.1", "0.3.9")).toBe(true);
    expect(isNewerVersion("0.3.0", "v0.3.0")).toBe(false);
  });
});

describe("shouldPromptUpdate", () => {
  it("未跳过任何版本时始终提示", () => {
    localStorage.removeItem("planwave.update.skipped_version");
    expect(shouldPromptUpdate("0.3.1")).toBe(true);
  });

  it("跳过的版本不再提示，更新的版本重新提示", () => {
    localStorage.setItem("planwave.update.skipped_version", "0.3.1");
    expect(shouldPromptUpdate("0.3.1")).toBe(false);
    expect(shouldPromptUpdate("0.3.2")).toBe(true);
    expect(shouldPromptUpdate("0.3.0")).toBe(false);
    localStorage.removeItem("planwave.update.skipped_version");
  });
});

describe("isWebStale", () => {
  it("服务器版本新于页面构建版本时判定过期", () => {
    expect(isWebStale("0.3.0", "0.3.1")).toBe(true);
    expect(isWebStale("0.3.1", "0.3.1")).toBe(false);
    // 页面比服务器新（服务器尚未升级）不提示
    expect(isWebStale("0.3.1", "0.3.0")).toBe(false);
  });
});
