import { useEffect, useState } from "react";
import { Button, Modal, Radio, RadioGroup, Tabs } from "@heroui/react";
import type { Theme } from "../state/store";
import { actions, useApp } from "../state/store";
import { checkForUpdates, currentAppVersion } from "../lib/updater";
import { isDesktopApp, isTauri, getApiBase } from "../lib/platform";
import {
  getProxySettings,
  isValidProxyUrl,
  setProxySettings,
  type ProxyMode,
} from "../lib/proxySettings";
import { Logo } from "../App";

type TabKey = "appearance" | "network" | "about";

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const PROXY_OPTIONS: { value: ProxyMode; label: string }[] = [
  { value: "none", label: "无代理（直连）" },
  { value: "system", label: "系统代理" },
  { value: "custom", label: "自定义代理" },
];

/** 设置弹框：外观 / 网络（仅桌面）/ 关于。 */
export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen);
  const theme = useApp((s) => s.theme);
  const updatePhase = useApp((s) => s.updatePhase);
  const updateError = useApp((s) => s.updateError);
  const updateMessage = useApp((s) => s.updateMessage);
  const updateInfo = useApp((s) => s.updateInfo);
  const [tab, setTab] = useState<TabKey>("appearance");
  const [appVersion, setAppVersion] = useState("—");
  const [proxyMode, setProxyMode] = useState<ProxyMode>("system");
  const [proxyUrl, setProxyUrl] = useState("");
  const [testState, setTestState] = useState<{ kind: "ok" | "fail"; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  // 网络 Tab 仅桌面端（Windows/macOS/Linux）显示
  const showNetwork = isTauri && isDesktopApp;

  useEffect(() => {
    if (!open) return;
    // 打开时回显已保存的代理设置与当前应用版本
    const saved = getProxySettings();
    setProxyMode(saved.mode);
    setProxyUrl(saved.url);
    void currentAppVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion("未知"));
  }, [open]);

  if (!open) return null;

  const applyProxyMode = (mode: ProxyMode) => {
    // 切到自定义档但地址无效时仅切换本地选择，落盘推迟到输入有效地址
    // （避免桌面网络立即全断）
    if (mode === "custom" && !isValidProxyUrl(proxyUrl)) {
      setProxyMode("custom");
      return;
    }
    setProxyMode(mode);
    setProxySettings({ mode, url: proxyUrl });
  };

  const applyProxyUrl = (url: string) => {
    setProxyUrl(url);
    if (isValidProxyUrl(url)) setProxySettings({ mode: proxyMode, url });
  };

  const testProxy = async () => {
    if (proxyMode === "custom" && !isValidProxyUrl(proxyUrl)) {
      setTestState({ kind: "fail", text: "代理地址无效（支持 http/https/socks5）" });
      return;
    }
    setTesting(true);
    setTestState(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const ms = await invoke<number>("test_proxy", {
        proxy: { mode: proxyMode, url: proxyMode === "custom" ? proxyUrl.trim() : null },
        // 探测同步服务器自身的健康检查接口（代理正是为访问它而设）
        testUrl: `${getApiBase()}/health`,
      });
      setTestState({ kind: "ok", text: `连接成功（${ms} ms）` });
    } catch (e) {
      setTestState({ kind: "fail", text: `连接失败：${String(e)}` });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) actions.closeSettings();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog data-testid="settings-dialog">
            <Modal.Header>
              <Modal.Heading className="text-lg font-bold">设置</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <Tabs
                selectedKey={tab}
                onSelectionChange={(key) => setTab(key as TabKey)}
                aria-label="设置分类"
              >
                <Tabs.List>
                  <Tabs.Tab id="appearance">外观</Tabs.Tab>
                  {showNetwork && <Tabs.Tab id="network">网络</Tabs.Tab>}
                  <Tabs.Tab id="about">关于</Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel id="appearance">
                  <RadioGroup
                    value={theme}
                    onChange={(v) => actions.setTheme(v as Theme)}
                    data-testid="settings-appearance"
                  >
                    {THEME_OPTIONS.map((o) => (
                      <Radio key={o.value} value={o.value}>
                        {o.label}
                      </Radio>
                    ))}
                  </RadioGroup>
                </Tabs.Panel>
                {showNetwork && (
                  <Tabs.Panel id="network">
                    <div className="space-y-3 text-sm">
                      <RadioGroup
                        value={proxyMode}
                        onChange={(v) => applyProxyMode(v as ProxyMode)}
                        data-testid="settings-proxy-mode"
                      >
                        {PROXY_OPTIONS.map((o) => (
                          <Radio key={o.value} value={o.value}>
                            {o.label}
                          </Radio>
                        ))}
                      </RadioGroup>
                      {proxyMode === "custom" && (
                        <div className="space-y-1.5">
                          <input
                            value={proxyUrl}
                            onChange={(e) => applyProxyUrl(e.target.value)}
                            placeholder="http://127.0.0.1:7890 或 socks5://…"
                            data-testid="settings-proxy-url"
                            aria-label="自定义代理地址"
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 [color-scheme:light] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:[color-scheme:dark]"
                          />
                          {!isValidProxyUrl(proxyUrl) && (
                            <p className="text-xs text-zinc-400">
                              填写有效代理地址（http/https/socks5）后自动生效
                            </p>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            isDisabled={testing}
                            onPress={() => void testProxy()}
                            data-testid="test-proxy"
                          >
                            {testing ? "测试中…" : "测试连接"}
                          </Button>
                          {testState && (
                            <p
                              className={`text-xs ${
                                testState.kind === "ok" ? "text-green-600" : "text-red-500"
                              }`}
                              data-testid="proxy-test-result"
                            >
                              {testState.text}
                            </p>
                          )}
                        </div>
                      )}
                      <p className="text-xs text-zinc-400">
                        代理仅在本机生效，用于应用与更新请求；不会同步到其他设备。
                      </p>
                    </div>
                  </Tabs.Panel>
                )}
                <Tabs.Panel id="about">
                  <div className="flex flex-col items-center gap-2 py-2 text-center">
                    <Logo className="size-10 text-blue-500" />
                    <div className="text-sm font-semibold">PlanWave</div>
                    <div className="text-xs text-zinc-400" data-testid="settings-app-version">
                      版本 {appVersion}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      isDisabled={updatePhase === "checking" || updatePhase === "downloading"}
                      onPress={() => void checkForUpdates(true)}
                      data-testid="check-update"
                    >
                      {updatePhase === "checking" ? "检查中…" : "检查更新"}
                    </Button>
                    {updateMessage && (
                      <p className="text-xs text-green-600 dark:text-green-400">{updateMessage}</p>
                    )}
                    {updateError && <p className="text-xs text-red-500">{updateError}</p>}
                    {updateInfo && (
                      <p className="text-xs text-blue-600 dark:text-blue-400">
                        新版本 v{updateInfo.version} 可用，请在弹窗中操作
                      </p>
                    )}
                  </div>
                </Tabs.Panel>
              </Tabs>
            </Modal.Body>
            <Modal.Footer>
              <Button
                variant="ghost"
                type="button"
                onPress={() => actions.closeSettings()}
                data-testid="settings-close"
              >
                关闭
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
