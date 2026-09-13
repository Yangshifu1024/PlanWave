//! 代理设置纯函数测试：地址校验与默认值。

import { describe, expect, it } from "vitest";
import { getProxySettings, isValidProxyUrl, setProxySettings } from "../src/lib/proxySettings";

describe("isValidProxyUrl", () => {
  it("接受 http/https/socks5 代理地址", () => {
    expect(isValidProxyUrl("http://127.0.0.1:7890")).toBe(true);
    expect(isValidProxyUrl("https://proxy.example.com")).toBe(true);
    expect(isValidProxyUrl("socks5://127.0.0.1:1080")).toBe(true);
    expect(isValidProxyUrl("  socks5://127.0.0.1:1080  ")).toBe(true);
  });

  it("拒绝缺协议或无关协议的地址", () => {
    expect(isValidProxyUrl("127.0.0.1:7890")).toBe(false);
    expect(isValidProxyUrl("ftp://127.0.0.1")).toBe(false);
    expect(isValidProxyUrl("")).toBe(false);
    expect(isValidProxyUrl("socks5://")).toBe(false);
  });
});

describe("getProxySettings / setProxySettings", () => {
  it("缺省为系统代理、无自定义地址", () => {
    localStorage.removeItem("planwave.proxy.mode");
    localStorage.removeItem("planwave.proxy.url");
    const settings = getProxySettings();
    expect(settings.mode).toBe("system");
    expect(settings.url).toBe("");
  });

  it("写入自定义档后可读回；切回系统档清除地址", () => {
    setProxySettings({ mode: "custom", url: "socks5://127.0.0.1:1080" });
    expect(getProxySettings()).toEqual({ mode: "custom", url: "socks5://127.0.0.1:1080" });

    setProxySettings({ mode: "system", url: "" });
    expect(getProxySettings()).toEqual({ mode: "system", url: "" });
  });
});
