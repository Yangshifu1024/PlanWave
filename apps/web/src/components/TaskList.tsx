import { useMemo, useState, type FormEvent } from "react";
import { Button, Input } from "@heroui/react";
import { actions, useApp, type ViewKind } from "../state/store";
import { filterTasks } from "../lib/filters";
import { isDesktopApp } from "../lib/platform";
import { TaskRow } from "./TaskRow";

function viewTitle(view: ViewKind): string {
  switch (view.kind) {
    case "smart":
      return { today: "今天", upcoming: "最近 7 天", all: "全部", trash: "回收站" }[view.smart]!;
    case "project": {
      const name = useApp
        .getState()
        .projects.find((p) => p.id === view.id)?.name;
      return name ?? "项目";
    }
  }
}

/** 中栏：视图标题 + 搜索 + 快速添加（标题 + 优先级） + 任务列表。 */
export function TaskList() {
  const tasks = useApp((s) => s.tasks);
  const view = useApp((s) => s.view);
  const search = useApp((s) => s.search);
  const projects = useApp((s) => s.projects);
  const [draft, setDraft] = useState("");
  const [priority, setPriority] = useState(0);

  const visible = useMemo(() => filterTasks(tasks, view, search), [tasks, view, search]);
  const isTrash = view.kind === "smart" && view.smart === "trash";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void actions.addTask(draft, undefined, priority);
    setDraft("");
    setPriority(0);
  };

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
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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
            placeholder={view.kind === "smart" ? "添加到「收集箱」（无项目）" : "添加任务，回车确认"}
            data-testid="new-task-input"
            fullWidth
          />
          <select
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            data-testid="new-task-priority"
            aria-label="新任务优先级"
            className="shrink-0 rounded-xl border border-zinc-200 bg-white px-2 text-sm text-zinc-600 [color-scheme:light] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:[color-scheme:dark]"
          >
            <option value={0}>无</option>
            <option value={1}>低</option>
            <option value={2}>中</option>
            <option value={3}>高</option>
          </select>
        </form>
      )}

      <ul className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-3 pb-8" data-testid="task-list">
        {visible.map((t) => (
          <TaskRow key={t.id} task={t} showProject={view.kind !== "project"} projects={projects} />
        ))}
        {visible.length === 0 && (
          <li className="pt-16 text-center text-sm text-zinc-400" data-testid="empty-state">
            {search ? "没有匹配的任务" : isTrash ? "回收站是空的" : "这里空空如也，添加一个任务吧"}
          </li>
        )}
      </ul>
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
    <span
      className="flex items-center gap-1.5 text-xs text-zinc-400"
      data-testid="sync-badge"
      title={`同步状态：${s.text}`}
    >
      <span className={`size-1.5 rounded-full ${s.cls}`} />
      {s.text}
    </span>
  );
}
