import { useEffect } from "react";
import { Toast } from "@heroui/react";
import { actions, useApp } from "./state/store";
import { scheduleAutoUpdateCheck } from "./lib/updater";
import { useShellMode } from "./lib/useShellMode";
import { AuthScreen } from "./components/AuthScreen";
import { Sidebar } from "./components/Sidebar";
import { TaskList } from "./components/TaskList";
import { TaskDetail } from "./components/TaskDetail";
import { UpdateDialog } from "./components/UpdateDialog";
import { PurgeConfirmDialog } from "./components/PurgeConfirmDialog";
import { AppConfirmDialog } from "./components/ConfirmDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { AppShell } from "./components/shell/AppShell";
import { SafeArea } from "./components/shell/SafeArea";
import { AdaptivePane } from "./components/shell/AdaptivePane";
import { BottomNav } from "./components/shell/BottomNav";
import { Logo } from "./components/ui/Logo";

export default function App() {
  const phase = useApp((s) => s.phase);

  useEffect(() => {
    void actions.boot();
  }, []);

  // 进入主界面后延迟做一次静默更新检查（桌面/Android 走 updater，Web 检测服务端版本）
  useEffect(() => {
    if (phase === "ready") scheduleAutoUpdateCheck();
  }, [phase]);

  return (
    <AppShell>
      {phase === "boot" && (
        <SafeArea className="flex flex-1 items-center justify-center">
          <BootSplash />
        </SafeArea>
      )}
      {phase === "auth" && (
        <SafeArea className="flex min-h-0 flex-1 flex-col">
          <AuthScreen />
        </SafeArea>
      )}
      {phase === "ready" && <MainLayout />}
      <UpdateDialog />
      <AppConfirmDialog />
      <SettingsDialog />
      {/* 全局 Toast 区域（列表页「撤销完成」等）；使用 HeroUI 全局 toast 队列 */}
      <Toast.Provider placement="bottom" />
    </AppShell>
  );
}

function BootSplash() {
  return (
    <div className="flex h-full items-center justify-center" data-testid="boot-splash">
      <div className="flex items-center gap-3 text-fg-subtle">
        <Logo className="size-8 animate-pulse text-blue-500" />
        <span className="text-sm tracking-widest">PLANWAVE</span>
      </div>
    </div>
  );
}

function MainLayout() {
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const compact = useShellMode() === "compact";
  return (
    <>
      {/* BottomNav 挂载时 bottom 安全区由它自己消费，SafeArea 不再重复补 */}
      <SafeArea
        className="flex min-h-0 flex-1"
        edges={compact ? ["top", "left", "right"] : ["top", "right", "bottom", "left"]}
      >
        <AdaptivePane role="nav" open={sidebarOpen} onClose={() => actions.toggleSidebar(false)}>
          <Sidebar />
        </AdaptivePane>
        <AdaptivePane role="main">
          <TaskList />
        </AdaptivePane>
        <TaskDetail />
      </SafeArea>
      <BottomNav />
      <PurgeConfirmDialog />
    </>
  );
}
