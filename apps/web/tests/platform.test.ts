//! 服务器地址解析：用户覆盖（登录屏）优先于构建期默认值。

import { beforeEach, describe, expect, it } from "vitest";
import {
  applyServerAddress,
  getApiBase,
  getStoredApiBase,
  DEFAULT_API_BASE,
} from "../src/lib/platform";

describe("服务器地址解析", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("未覆盖时用默认地址", () => {
    expect(getStoredApiBase()).toBeNull();
    expect(getApiBase()).toBe(DEFAULT_API_BASE);
  });

  it("登录屏覆盖后生效", () => {
    expect(applyServerAddress("https://example.com/api")).toBe(true);
    expect(getStoredApiBase()).toBe("https://example.com/api");
    expect(getApiBase()).toBe("https://example.com/api");
  });

  it("重复保存相同地址不算变化（首次显式保存默认地址也不算）", () => {
    expect(applyServerAddress(DEFAULT_API_BASE)).toBe(false);
    expect(getStoredApiBase()).toBeNull();
    expect(applyServerAddress("https://example.com/api")).toBe(true);
    expect(applyServerAddress("https://example.com/api")).toBe(false);
  });

  it("去除尾部斜杠；清空输入回退默认地址并移除覆盖", () => {
    applyServerAddress("https://example.com/api/");
    expect(getApiBase()).toBe("https://example.com/api");
    expect(applyServerAddress("")).toBe(true);
    expect(getStoredApiBase()).toBeNull();
    expect(getApiBase()).toBe(DEFAULT_API_BASE);
  });
});
