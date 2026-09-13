import { useMemo, useState, type FormEvent } from "react";
import { Button, Input } from "@heroui/react";
import { actions, useApp, type ViewKind } from "../state/store";
import { subtaskProgress, visibleTree } from "../lib/filters";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { isDesktopApp } from "../lib/platform";
import { TaskRow } from "./TaskRow";
import { QuickAddModal } from "./QuickAddModal";
import { SyncStatusSheet } from "./SyncStatusSheet";

function viewTitle(view: ViewKind): string {
  switch (view.kind) {
    case "smart":
      return { today: "今天", upcoming: "最近 7 天", all: "全部", trash: "回收站" }[view.smart]!;
    case "project": {
      const name = useApp.getState().projects.find((p) => p.id === view.id)?.name;
      return name ?? "项目";
    }
  }
}

/** 中栏：视图标题 + 搜索 + 快速添加（回车弹出详情表单） + 任务列表（子任务缩进树）。 */
export function TaskList() {
  const tasks = useApp((s) => s.tasks);
  const view = useApp((s) => s.view);
  const search = useApp((s) => s.search);
  const projects = useApp((s) => s.projects);
  const [draft, setDraft] = useState("");
  // 非空 = 打开「新建任务」详情弹框，值为输入框预填的标题
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);
  // 折叠的父任务 id 集合（列表本地状态）
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const tree = useMemo(() => visibleTree(tasks, view, search), [tasks, view, search]);
  const isTrash = view.kind === "smart" && view.smart === "trash";
  const { ref: listRef, pullPx, phase } = usePullToRefresh(() => actions.refresh());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    setPendingTitle(title);
  };

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const rowCount = tree.reduce((n, node) => n + 1 + node.children.length, 0);

  return (
    <>
      {/* 桌面端自绘标题栏：内容列顶部拖拽区（Windows 窗口控制按钮落在这里右上） */}
      {isDesktopApp && <div data-tauri-drag-region className="h-9 shrink-0" aria-hidden />}
      <div className="flex items-center gap-2 px-6 pt-5">
        <button
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-200/60 md:hidden dark:hover:bg-zinc-800"
          onClick={() => actions.toggleSidebar(true)}
          aria-label="打开侧栏"
          data-testid="menu-button"
        >
          <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden>
            <path
              d="M3 5h14M3 10h14M3 15h14"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <Input
          value={search}
          onChange={(e) => actions.setSearch(e.target.value)}
          placeholder="搜索任务、备注、标签…"
          data-testid="search-input"
          className="w-56"
        />
        <div className="ml-auto flex items-center gap-3">
          <SyncBadge />
          <Button
            isIconOnly
            variant="ghost"
            onPress={() => void actions.refresh()}
            aria-label="手动刷新"
            data-testid="refresh-button"
          >
            <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden>
              <path
                d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6M16.5 3.5v3h-3"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Button>
        </div>
      </div>

      <div className="px-6 pt-4">
        <h1 className="text-2xl font-bold" data-testid="view-title">
          {viewTitle(view)}
        </h1>
      </div>

      {!isTrash && (
        <form onSubmit={submit} className="flex gap-2 px-6 pt-3">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              view.kind === "smart" ? "添加到「收集箱」（无项目）" : "添加任务，回车填写详情"
            }
            data-testid="new-task-input"
            fullWidth
          />
        </form>
      )}

      {/* 下拉刷新指示器：绝对定位于列表上方，随拉拽距离渐显 */}
      <div className="relative mt-3 flex-1 min-h-0">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center text-xs text-zinc-400 transition-opacity"
          style={{
            height: 48,
            opacity: phase === "idle" ? 0 : 1,
            transform: `translateY(${Math.max(0, pullPx - 48)}px)`,
          }}
          aria-hidden={phase === "idle"}
          data-testid="pull-indicator"
        >
          {phase === "refreshing" ? (
            <span className="flex items-center gap-1.5">
              <svg viewBox="0 0 20 20" className="size-3.5 animate-spin" fill="none" aria-hidden>
                <circle
                  cx="10"
                  cy="10"
                  r="7.5"
                  stroke="currentColor"
                  strokeOpacity="0.25"
                  strokeWidth="2"
                />
                <path
                  d="M17.5 10a7.5 7.5 0 0 0-7.5-7.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              刷新中…
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <svg
                viewBox="0 0 20 20"
                className={`size-3.5 transition-transform ${phase === "ready" ? "rotate-180" : ""}`}
                fill="none"
                aria-hidden
              >
                <path
                  d="M10 3.5v11M5.5 10L10 14.5 14.5 10"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {phase === "ready" ? "松手刷新" : "下拉刷新"}
            </span>
          )}
        </div>
        <ul
          ref={listRef}
          className="h-full space-y-0.5 overflow-y-auto overscroll-contain px-3 pb-8"
          data-testid="task-list"
          style={{
            transform: `translateY(${pullPx}px)`,
            transition:
              phase === "pulling" || phase === "ready" ? "none" : "transform 0.2s ease-out",
          }}
        >
          {tree.map(({ task, children }) => {
            const childNodes = collapsed.has(task.id) ? [] : children;
            return (
              <li key={task.id} className="space-y-0.5">
                <TaskRow
                  task={task}
                  showProject={view.kind !== "project"}
                  projects={projects}
                  progress={subtaskProgress(tasks, task.id)}
                  collapsed={children.length > 0 ? collapsed.has(task.id) : undefined}
                  onToggleCollapse={children.length > 0 ? () => toggleCollapse(task.id) : undefined}
                />
                {childNodes.map((child) => (
                  <TaskRow
                    key={child.id}
                    task={child}
                    showProject={view.kind !== "project"}
                    projects={projects}
                    isSubtask
                  />
                ))}
              </li>
            );
          })}
          {rowCount === 0 && (
            <li className="pt-16 text-center text-sm text-zinc-400" data-testid="empty-state">
              {search
                ? "没有匹配的任务"
                : isTrash
                  ? "回收站是空的"
                  : "这里空空如也，添加一个任务吧"}
            </li>
          )}
        </ul>
      </div>
      {pendingTitle !== null && (
        <QuickAddModal title={pendingTitle} onClose={() => setPendingTitle(null)} />
      )}
      <SyncStatusSheet />
    </>
  );
}

export function SyncBadge() {
  const status = useApp((s) => s.syncStatus);
  const map: Record<string, { text: string; cls: string }> = {
    online: { text: "已同步", cls: "bg-green-400" },
    syncing: { text: "同步中", cls: "bg-blue-400 animate-pulse" },
    offline: { text: "离线", cls: "bg-zinc-400" },
  };
  const s = map[status]!;
  return (
    <button
      className="flex cursor-pointer items-center gap-1.5 rounded-lg px-1 py-0.5 text-xs text-zinc-400 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
      data-testid="sync-badge"
      title={`同步状态：${s.text}（点击查看详情）`}
      onClick={() => void actions.openSyncSheet()}
    >
      <span className={`size-1.5 rounded-full ${s.cls}`} />
      {s.text}
    </button>
  );
}
