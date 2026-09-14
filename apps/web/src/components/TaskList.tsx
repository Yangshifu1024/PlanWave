import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Checkbox, Input } from "@heroui/react";
import { actions, useApp, type ViewKind } from "../state/store";
import { groupByDue, splitCompleted, subtaskProgress, visibleTree, type TaskTree } from "../lib/filters";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { isDesktopApp } from "../lib/platform";
import { TaskRow } from "./TaskRow";
import { QuickAddModal } from "./QuickAddModal";
import { SyncStatusSheet } from "./SyncStatusSheet";
import { MonthView } from "./MonthView";
import { ViewModeToggle } from "./ViewModeToggle";

/** 「已完成」分区展开偏好的 localStorage key。 */
const SHOW_COMPLETED_KEY = "planwave.ui.showCompleted";

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
  const viewMode = useApp((s) => s.viewMode);
  const search = useApp((s) => s.search);
  const projects = useApp((s) => s.projects);
  const [draft, setDraft] = useState("");
  // 非空 = 打开「新建任务」详情弹框，值为输入框预填的标题
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);
  // 折叠的父任务 id 集合（列表本地状态）
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // 回收站多选：勾选的墓碑任务 id（列表本地状态）
  const [trashSelected, setTrashSelected] = useState<Set<string>>(() => new Set());
  // 「已完成」分区展开状态（偏好持久化；默认折叠）
  const [showCompleted, setShowCompleted] = useState(
    () => localStorage.getItem(SHOW_COMPLETED_KEY) === "true",
  );

  const tree = useMemo(() => visibleTree(tasks, view, search), [tasks, view, search]);
  const isTrash = view.kind === "smart" && view.smart === "trash";
  // 月视图仅支持「全部」与项目视图；其余视图忽略偏好强制列表
  const monthSupported = view.kind === "project" || (view.kind === "smart" && view.smart === "all");
  const showMonth = monthSupported && viewMode === "month";
  const searching = search.trim().length > 0;
  const showGroups = !isTrash && !searching;
  const { active, completed } = useMemo(() => splitCompleted(tree), [tree]);
  const groups = useMemo(() => (showGroups ? groupByDue(active) : []), [active, showGroups]);
  const { ref: listRef, pullPx, phase } = usePullToRefresh(() => actions.refresh());
  const rowCount = tree.reduce((n, node) => n + 1 + node.children.length, 0);
  const visibleCount = searching ? tree.length : active.length + completed.length;

  const toggleCompleted = () => {
    setShowCompleted((prev) => {
      const next = !prev;
      localStorage.setItem(SHOW_COMPLETED_KEY, String(next));
      return next;
    });
  };

  // 任务集合变化（彻底删除/恢复）后清理失效勾选项：
  // 恢复会让墓碑变回活任务，必须同步移出勾选集，避免误删活任务
  useEffect(() => {
    setTrashSelected((prev) => {
      const next = new Set([...prev].filter((id) => tasks.some((t) => t.id === id && t.deleted)));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  const allTrashChecked = rowCount > 0 && tree.every(({ task }) => trashSelected.has(task.id));
  const toggleAllTrash = () => {
    setTrashSelected(() => {
      if (allTrashChecked) return new Set();
      return new Set(tree.map(({ task }) => task.id));
    });
  };

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

  /** 渲染一个顶层任务节点：行 + （展开时的）子任务树（连续竖向引导线）。 */
  const renderNode = ({ task, children }: TaskTree) => {
    const childNodes = collapsed.has(task.id) ? [] : children;
    return (
      <li key={task.id} className="relative">
        <TaskRow
          task={task}
          showProject={view.kind !== "project"}
          projects={projects}
          progress={subtaskProgress(tasks, task.id)}
          collapsed={children.length > 0 ? collapsed.has(task.id) : undefined}
          onToggleCollapse={children.length > 0 ? () => toggleCollapse(task.id) : undefined}
          showDivider={!isTrash && !task.deleted}
          trashSelected={trashSelected.has(task.id)}
          onToggleTrashSelect={
            isTrash
              ? () =>
                  setTrashSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(task.id)) {
                      next.delete(task.id);
                    } else {
                      next.add(task.id);
                    }
                    return next;
                  })
              : undefined
          }
        />
        {childNodes.length > 0 && (
          <div className="relative">
            {/* 连续竖向引导线：贯穿整段子任务 */}
            <span
              className="pointer-events-none absolute bottom-1 left-6 top-1 w-px bg-zinc-200 dark:bg-zinc-700"
              aria-hidden
            />
            <ul className="space-y-0.5">
              {childNodes.map((child) => (
                <li key={child.id} className="relative">
                  {/* 肘线：由引导线连向子任务 */}
                  <span
                    className="pointer-events-none absolute left-6 top-1/2 h-px w-2.5 bg-zinc-200 dark:bg-zinc-700"
                    aria-hidden
                  />
                  <TaskRow
                    task={child}
                    showProject={view.kind !== "project"}
                    projects={projects}
                    isSubtask
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </li>
    );
  };

  return (
    <>
      {/* 桌面端自绘标题栏：内容列顶部拖拽区（Windows 窗口控制按钮落在这里右上） */}
      {isDesktopApp && <div data-tauri-drag-region className="h-9 shrink-0" aria-hidden />}
      <div className="flex items-center gap-1.5 px-4 pt-4 sm:gap-2 sm:px-6 sm:pt-5">
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
          className="min-w-0 flex-1 sm:w-56 sm:flex-none"
        />
        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
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

      <div className="flex items-center justify-between gap-2 px-6 pt-4">
        <h1 className="text-2xl font-bold" data-testid="view-title">
          {viewTitle(view)}
        </h1>
        {monthSupported && <ViewModeToggle />}
      </div>

      {!isTrash && !showMonth && (
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

      {/* 回收站工具行：全选 + 清空回收站 */}
      {isTrash && rowCount > 0 && (
        <div className="flex items-center gap-3 px-6 pt-3">
          <Checkbox
            isSelected={allTrashChecked}
            onChange={toggleAllTrash}
            data-testid="trash-select-all"
            aria-label="全选回收站任务"
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
            </Checkbox.Content>
          </Checkbox>
          <span className="text-xs text-zinc-400">全选</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-zinc-400 hover:text-red-500"
            onPress={() =>
              actions.openPurgeConfirm(tasks.filter((t) => t.deleted).map((t) => t.id))
            }
            data-testid="trash-clear"
          >
            清空回收站
          </Button>
        </div>
      )}

      {/* 回收站批量操作条：有勾选项时浮出 */}
      {isTrash && trashSelected.size > 0 && (
        <div
          className="mx-6 mt-3 flex items-center gap-3 rounded-xl bg-red-50 px-3 py-2 dark:bg-red-500/10"
          data-testid="trash-bulk-bar"
        >
          <span className="text-sm text-zinc-500 dark:text-zinc-300">
            已选 {trashSelected.size} 项
          </span>
          <Button
            size="sm"
            className="ml-auto bg-red-500 text-white hover:bg-red-600"
            onPress={() => actions.openPurgeConfirm([...trashSelected])}
            data-testid="trash-bulk-delete"
          >
            删除所选
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => setTrashSelected(new Set())}
            data-testid="trash-bulk-cancel"
          >
            取消
          </Button>
        </div>
      )}

      {showMonth ? (
        <MonthView />
      ) : (
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
          {isTrash || searching ? (
            tree.map(renderNode)
          ) : (
            <>
              {groups.map((group) => (
                <Fragment key={group.key}>
                  <li
                    className="flex items-center gap-2 px-3 pb-1 pt-4 first:pt-1"
                    data-testid={`group-${group.key}`}
                  >
                    <span className="text-xs font-medium text-zinc-400">{group.label}</span>
                    <span className="text-xs text-zinc-300 dark:text-zinc-600">
                      {group.nodes.length}
                    </span>
                  </li>
                  {group.nodes.map(renderNode)}
                </Fragment>
              ))}
              {completed.length > 0 && (
                <>
                  <li className="mt-4 px-3" data-testid="completed-section">
                    <button
                      className="flex w-full items-center gap-1.5 border-t border-zinc-200 pt-3 text-left text-xs font-medium text-zinc-400 transition hover:text-zinc-600 dark:border-zinc-800 dark:hover:text-zinc-200"
                      onClick={toggleCompleted}
                      data-testid="completed-toggle"
                      aria-expanded={showCompleted}
                    >
                      <svg
                        viewBox="0 0 12 12"
                        className={`size-3 transition-transform ${showCompleted ? "rotate-90" : ""}`}
                        fill="none"
                        aria-hidden
                      >
                        <path
                          d="M4 2.5L8 6l-4 3.5"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      已完成 {completed.length}
                    </button>
                  </li>
                  {showCompleted && completed.map(renderNode)}
                </>
              )}
            </>
          )}
          {visibleCount === 0 && (
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
      )}
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
      className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-1 py-0.5 text-xs text-zinc-400 transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
      data-testid="sync-badge"
      title={`同步状态：${s.text}（点击查看详情）`}
      onClick={() => void actions.openSyncSheet()}
    >
      <span className={`size-1.5 rounded-full ${s.cls}`} />
      {s.text}
    </button>
  );
}
