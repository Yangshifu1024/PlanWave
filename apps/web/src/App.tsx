import { useEffect } from "react";
import { actions, useApp } from "./state/store";
import { AuthScreen } from "./components/AuthScreen";
import { Sidebar } from "./components/Sidebar";
import { TaskList } from "./components/TaskList";
import { TaskDetail } from "./components/TaskDetail";
import { WindowControls } from "./components/WindowControls";

export default function App() {
  const phase = useApp((s) => s.phase);
  const sidebarOpen = useApp((s) => s.sidebarOpen);

  useEffect(() => {
    void actions.boot();
  }, []);

  return (
    <>
      <WindowControls />
      {phase === "boot" && <BootSplash />}
      {phase === "auth" && <AuthScreen />}
      {phase === "ready" && <MainLayout sidebarOpen={sidebarOpen} />}
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
      {/* 移动端遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30 md:hidden"
          onClick={() => actions.toggleSidebar(false)}
          data-testid="sidebar-backdrop"
        />
      )}
      {/* 侧栏容器：移动端抽屉，桌面常驻 */}
      <div
        className={`fixed inset-y-0 left-0 z-30 flex flex-col overflow-y-auto bg-zinc-100 transition-transform duration-200 dark:bg-zinc-900 md:static md:z-auto md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar />
      </div>
      <main className="flex min-w-0 flex-1 flex-col bg-white dark:bg-zinc-900">
        <TaskList />
      </main>
      <TaskDetail />
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
