import { useEffect } from "react";
import { Toast } from "@heroui/react";
import { actions, useApp } from "./state/store";
import { scheduleAutoUpdateCheck } from "./lib/updater";
import { AuthScreen } from "./components/AuthScreen";
import { Sidebar } from "./components/Sidebar";
import { TaskList } from "./components/TaskList";
import { TaskDetail } from "./components/TaskDetail";
import { UpdateDialog } from "./components/UpdateDialog";
import { WebUpdateBanner } from "./components/WebUpdateBanner";
import { PurgeConfirmDialog } from "./components/PurgeConfirmDialog";
import { AppConfirmDialog } from "./components/ConfirmDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { WindowControls } from "./components/WindowControls";

export default function App() {
  const phase = useApp((s) => s.phase);
  const sidebarOpen = useApp((s) => s.sidebarOpen);

  useEffect(() => {
    void actions.boot();
  }, []);

  // 进入主界面后延迟做一次静默更新检查（桌面/Android 走 updater，Web 检测服务端版本）
  useEffect(() => {
    if (phase === "ready") scheduleAutoUpdateCheck();
  }, [phase]);

  return (
    <>
      <WindowControls />
      {phase === "boot" && <BootSplash />}
      {phase === "auth" && <AuthScreen />}
      {phase === "ready" && <MainLayout sidebarOpen={sidebarOpen} />}
      <UpdateDialog />
      <AppConfirmDialog />
      <SettingsDialog />
      {/* 全局 Toast 区域（列表页「撤销完成」等）；使用 HeroUI 全局 toast 队列 */}
      <Toast.Provider placement="bottom" />
    </>
  );
}

function BootSplash() {
  return (
    <div className="flex h-full items-center justify-center" data-testid="boot-splash">
      <div className="flex items-center gap-3 text-zinc-400">
        <Logo className="size-8 animate-pulse text-blue-500" />
        <span className="text-sm tracking-widest">PLANWAVE</span>
      </div>
    </div>
  );
}

function MainLayout({ sidebarOpen }: { sidebarOpen: boolean }) {
  return (
    <div className="flex h-full">
      <WebUpdateBanner />
      {/* 移动端遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30 md:hidden"
          onClick={() => actions.toggleSidebar(false)}
          data-testid="sidebar-backdrop"
        />
      )}
      {/* 侧栏容器：移动端抽屉，桌面常驻；滚动收敛到 Sidebar 内部导航区，底行固定 */}
      <div
        className={`fixed inset-y-0 left-0 z-30 flex flex-col bg-zinc-100 transition-transform duration-200 dark:bg-zinc-900 md:static md:z-auto md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar />
      </div>
      <main className="flex min-w-0 flex-1 flex-col bg-white dark:bg-zinc-900">
        <TaskList />
      </main>
      <TaskDetail />
      <PurgeConfirmDialog />
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M10.5 16.5l3.5 3.5 7-7.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
