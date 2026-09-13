//! 代理设置（设置弹框-网络）：纯函数 + localStorage 读写。
//! 代理是机器属性，仅本机生效，不进入同步。

export type ProxyMode = "system" | "none" | "custom";

export interface ProxySettings {
  mode: ProxyMode;
  /** 自定义代理地址：http:// https:// 或 socks5:// 前缀。 */
  url: string;
}

const MODE_KEY = "planwave.proxy.mode";
const URL_KEY = "planwave.proxy.url";
const MODES: ProxyMode[] = ["system", "none", "custom"];

/** 读取代理设置；缺省 = 跟随系统代理（与 WebView 默认行为一致）。 */
export function getProxySettings(): ProxySettings {
  const raw = localStorage.getItem(MODE_KEY) as ProxyMode | null;
  const mode: ProxyMode = raw && MODES.includes(raw) ? raw : "system";
  return { mode, url: localStorage.getItem(URL_KEY) ?? "" };
}

/** 写入代理设置（custom 档才持久化地址）。 */
export function setProxySettings(settings: ProxySettings): void {
  localStorage.setItem(MODE_KEY, settings.mode);
  if (settings.mode === "custom") {
    localStorage.setItem(URL_KEY, settings.url);
  } else {
    localStorage.removeItem(URL_KEY);
  }
}

/** 自定义代理地址校验：http:// https:// socks5:// 前缀 + 非空主机。 */
export function isValidProxyUrl(url: string): boolean {
  return /^(https?|socks5):\/\/[^\s/]+(:\d+)?([/?#].*)?$/i.test(url.trim());
}
