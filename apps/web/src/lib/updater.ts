//! 应用自动更新：桌面（Tauri updater 插件）/ Android（应用内下载 APK）/ Web（提示刷新）。
//!
//! 分发源为 GitHub Releases 上由 CI 生成的 `latest.json`；「跳过此版本」存
//! localStorage。版本比较与提示判定是纯函数（见 `lib/updateVersion.ts`）。
//!
//! 注意：本模块被 store 单向引用（updater → store），不得反向被 store 引入。

import { getApiBase, isDesktopApp, isTauri } from "./platform";
import { isNewerVersion, isWebStale, shouldPromptUpdate } from "./updateVersion";
import { getProxySettings, isValidProxyUrl } from "./proxySettings";
import { useApp } from "../state/store";

const LATEST_MANIFEST_URL =
  "https://github.com/Yangshifu1024/PlanWave/releases/latest/download/latest.json";
const SKIP_KEY = "planwave.update.skipped_version";
const AUTO_CHECK_DELAY_MS = 5_000;

/** 忽略此版本：直到出现更新的版本才重新提示。 */
export function skipUpdate(): void {
  const { version } = useApp.getState().updateInfo ?? {};
  if (version) localStorage.setItem(SKIP_KEY, version);
  useApp.getState().setPartial({ updateInfo: null, updatePhase: "idle" });
}

/** 应用启动后调用：延迟 5 秒做一次静默检查（所有端）。 */
export function scheduleAutoUpdateCheck(): void {
  window.setTimeout(() => {
    void checkForUpdates(false);
  }, AUTO_CHECK_DELAY_MS);
}

/** 桌面更新请求的代理选项：自定义档走自定义代理，系统档读取 OS 代理设置。 */
async function updaterProxy(): Promise<{ proxy?: string } | undefined> {
  const { mode, url } = getProxySettings();
  if (mode === "custom" && isValidProxyUrl(url)) return { proxy: url.trim() };
  if (mode === "system") {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const sys = await invoke<string | null>("system_proxy_url");
      if (sys) return { proxy: sys };
    } catch {
      /* 读取失败 = 直连 */
    }
  }
  return undefined;
}

/** 检查更新入口。manual = 用户手动触发（显示错误与「已是最新」反馈，无视跳过）。 */
export async function checkForUpdates(manual: boolean): Promise<void> {
  const s = useApp.getState();
  if (s.updatePhase === "checking" || s.updatePhase === "downloading") return;
  s.setPartial({ updatePhase: "checking", updateError: null, updateMessage: null });
  try {
    if (isDesktopApp) {
      await checkDesktop(manual);
    } else if (isTauri && /Android/i.test(navigator.userAgent)) {
      await checkAndroid(manual);
    } else if (!isTauri) {
      await checkWeb();
      useApp.getState().setPartial({ updatePhase: "idle" });
    }
  } catch (e) {
    // 自动检查静默失败；手动检查把错误展示在同步详情页
    useApp.getState().setPartial({
      updatePhase: "idle",
      ...(manual ? { updateError: String(e) } : {}),
    });
  }
}

/** 桌面：启动更新（Linux deb 安装不支持 updater，引导去 Release 页手动下载）。 */
export async function startDesktopUpdate(): Promise<void> {
  const isLinuxDesktop = isDesktopApp && /Linux/i.test(navigator.userAgent);
  if (isLinuxDesktop) {
    const { invoke } = await import("@tauri-apps/api/core");
    // updater 仅支持 AppImage；deb/RPM 安装引导手动下载
    const isAppImage = await invoke<boolean>("is_appimage");
    if (!isAppImage) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://github.com/Yangshifu1024/PlanWave/releases/latest");
      useApp.getState().setPartial({
        updateMessage: "deb 等包管理器安装不支持自动更新，已打开 Release 页，请手动下载新版本",
      });
      return;
    }
  }
  await downloadAndInstallUpdate();
}

/** 桌面：下载并安装（updater 插件），完成后进入 ready，等待用户重启。 */
export async function downloadAndInstallUpdate(): Promise<void> {
  const { check } = await import("@tauri-apps/plugin-updater");
  let update;
  try {
    update = await check(await updaterProxy());
  } catch (e) {
    useApp.getState().setPartial({ updatePhase: "idle", updateError: String(e) });
    return;
  }
  if (!update) {
    useApp.getState().setPartial({ updatePhase: "idle", updateInfo: null });
    return;
  }
  useApp.getState().setPartial({ updatePhase: "downloading", updateProgress: 0 });
  let received = 0;
  let total = 0;
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        received = 0;
        total = event.data.contentLength ?? 0;
      } else if (event.event === "Progress") {
        received += event.data.chunkLength;
        useApp
          .getState()
          .setPartial({ updateProgress: total > 0 ? Math.round((received / total) * 100) : null });
      } else if (event.event === "Finished") {
        useApp.getState().setPartial({ updateProgress: 100 });
      }
    });
  } catch (e) {
    useApp.getState().setPartial({ updatePhase: "idle", updateError: String(e) });
    return;
  }
  useApp.getState().setPartial({ updatePhase: "ready", updateProgress: 100 });
}

/** 桌面：重启应用完成安装（tauri-plugin-process）。 */
export async function relaunchApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** Android：应用内下载 APK（Rust 命令流式下载 + 进度事件），完成后拉起安装器。 */
export async function downloadApkOnAndroid(): Promise<void> {
  const { updateInfo } = useApp.getState();
  if (!updateInfo?.url) return;
  useApp.getState().setPartial({ updatePhase: "downloading", updateProgress: 0 });
  const { listen } = await import("@tauri-apps/api/event");
  const { invoke } = await import("@tauri-apps/api/core");
  const unlisten = await listen<{ received: number; total: number }>(
    "update://apk-progress",
    (event) => {
      const { received, total } = event.payload;
      useApp
        .getState()
        .setPartial({ updateProgress: total > 0 ? Math.round((received / total) * 100) : null });
    },
  );
  try {
    const path = await invoke<string>("download_update_apk", {
      url: updateInfo.url,
      version: updateInfo.version,
      sha256: updateInfo.sha256 ?? null,
    });
    useApp.getState().setPartial({ updatePhase: "ready", updateProgress: 100 });
    await invoke("install_update_apk", { path });
  } catch (e) {
    useApp.getState().setPartial({ updatePhase: "idle", updateError: String(e) });
  } finally {
    unlisten();
  }
}

/** 当前应用版本：Tauri 端读真实包版本；Web 端读构建期注入的页面版本。 */
export async function currentAppVersion(): Promise<string> {
  if (isTauri) {
    const { getVersion } = await import("@tauri-apps/api/app");
    return getVersion();
  }
  return __APP_VERSION__;
}

async function checkDesktop(manual: boolean): Promise<void> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check(await updaterProxy());
  const setPartial = useApp.getState().setPartial;
  if (!update) {
    setPartial({
      updatePhase: "idle",
      updateInfo: null,
      ...(manual ? { updateMessage: "已是最新版本" } : {}),
    });
    return;
  }
  if (!manual && !shouldPromptUpdate(update.version)) {
    setPartial({ updatePhase: "idle" });
    return;
  }
  setPartial({
    updatePhase: "idle",
    updateInfo: { version: update.version, notes: update.body ?? "" },
  });
}

async function checkAndroid(manual: boolean): Promise<void> {
  const res = await fetch(LATEST_MANIFEST_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`获取更新清单失败: HTTP ${res.status}`);
  const manifest = (await res.json()) as {
    version?: string;
    android?: { version?: string; url?: string; sha256?: string; notes?: string };
  };
  const android = manifest.android;
  const current = await currentAppVersion();
  // url 必须是 https 直链（防止清单被污染时引导到非法地址）
  if (
    !android?.version ||
    !android.url?.startsWith("https://") ||
    !isNewerVersion(android.version, current)
  ) {
    if (manual) {
      useApp.getState().setPartial({ updatePhase: "idle", updateMessage: "已是最新版本" });
    }
    return;
  }
  if (!manual && !shouldPromptUpdate(android.version)) {
    useApp.getState().setPartial({ updatePhase: "idle" });
    return;
  }
  useApp.getState().setPartial({
    updatePhase: "idle",
    updateInfo: {
      version: android.version,
      notes: android.notes ?? "",
      url: android.url,
      sha256: android.sha256,
    },
  });
}

async function checkWeb(): Promise<void> {
  const res = await fetch(`${getApiBase()}/about`, { headers: { Accept: "application/json" } });
  if (!res.ok) return;
  const body = (await res.json()) as { "planwave-server"?: string };
  const server = body["planwave-server"];
  if (server && isWebStale(__APP_VERSION__, server)) {
    useApp.getState().setPartial({ webStale: true });
  }
}
