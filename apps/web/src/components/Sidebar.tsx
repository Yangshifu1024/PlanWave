import { useMemo, useState, type ReactNode } from "react";
import { Button, Input } from "@heroui/react";
import type { ProjectRecord } from "../types";
import { actions, useApp, type ViewKind } from "../state/store";
import { countTasks } from "../lib/filters";
import { isDesktopApp } from "../lib/platform";
import { Logo } from "../App";

const SMART_LISTS: { key: "today" | "upcoming" | "all" | "trash"; label: string }[] = [
  { key: "today", label: "今天" },
  { key: "upcoming", label: "最近 7 天" },
  { key: "all", label: "全部" },
  { key: "trash", label: "回收站" },
];

/** Tailwind 静态类名映射（动态拼接的类名不会被打包器保留）。 */
const DOT_COLORS: Record<string, string> = {
  blue: "bg-blue-400",
  red: "bg-red-400",
  orange: "bg-orange-400",
  green: "bg-green-400",
  purple: "bg-purple-400",
  gray: "bg-gray-400",
};

/** 左侧栏：智能清单 + 项目列表 + 设置/登出。桌面常驻，移动端抽屉。
 * 导航区滚动、底行固定：项目再多也不会把设置/登出推出视野。 */
export function Sidebar() {
  const projects = useApp((s) => s.projects);
  const tasks = useApp((s) => s.tasks);
  const view = useApp((s) => s.view);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    const compute = (v: ViewKind) => countTasks(tasks, v);
    for (const s of SMART_LISTS) map.set(`smart:${s.key}`, compute({ kind: "smart", smart: s.key }));
    for (const p of projects) map.set(`project:${p.id}`, compute({ kind: "project", id: p.id }));
    return map;
  }, [tasks, projects]);

  const submitProject = async () => {
    await actions.addProject(newName);
    setNewName("");
    setAdding(false);
  };

  return (
    <aside className="flex h-full w-full shrink-0 flex-col gap-1 p-4 md:w-64">
      {/* 桌面端自绘标题栏：侧栏顶部拖拽区（macOS 红绿灯落在这里），背景与侧栏一致 */}
      {isDesktopApp && <div data-tauri-drag-region className="-mx-4 -mt-4 h-9 shrink-0" aria-hidden />}
      <div className="mb-4 flex items-center gap-2 px-2 pt-2">
        <Logo className="size-6 text-blue-500" />
        <span className="text-sm font-semibold tracking-widest text-zinc-500 dark:text-zinc-400">
          PLANWAVE
        </span>
      </div>

      {/* 可滚动导航区：项目再多时仅此区域滚动，底行始终固定 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {SMART_LISTS.map((s) => (
          <SideItem
            key={s.key}
            active={view.kind === "smart" && view.smart === s.key}
            label={s.label}
            count={counts.get(`smart:${s.key}`) ?? 0}
            testId={`nav-${s.key}`}
            onClick={() => actions.setView({ kind: "smart", smart: s.key })}
          />
        ))}

        <div className="mt-5 flex items-center justify-between px-2">
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">项目</span>
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            onPress={() => setAdding(true)}
            data-testid="add-project"
            aria-label="新建项目"
          >
            +
          </Button>
        </div>

        {projects
          .filter((p) => !p.deleted)
          .map((p) => (
            <SideItem
              key={p.id}
              active={view.kind === "project" && view.id === p.id}
              label={<ProjectLabel project={p} />}
              count={counts.get(`project:${p.id}`) ?? 0}
              testId={`nav-project-${p.name}`}
              onClick={() => actions.setView({ kind: "project", id: p.id })}
              onDelete={() => void actions.deleteProject(p.id)}
            />
          ))}

        {adding && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitProject();
            }}
          >
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => void submitProject()}
              placeholder="项目名称，回车确认"
              data-testid="new-project-name"
            />
          </form>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between px-2 pt-6">
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          onPress={() => actions.openSettings()}
          data-testid="open-settings"
          aria-label="设置"
          className="text-zinc-400"
        >
          <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden>
            <path
              d="M8.2 2.6a7.4 7.4 0 0 0 0 0m3.6 0a7.4 7.4 0 0 1 0 0M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm6.1 3c0-.5-.05-1-.14-1.44l1.77-1.02-1.5-2.6-1.98.75a7.5 7.5 0 0 0-2.25-1.3L11.75 2.3h-3.5L8 4.4a7.5 7.5 0 0 0-2.25 1.3l-1.98-.75-1.5 2.6 1.77 1.03a7.5 7.5 0 0 0 0 2.86l-1.77 1.02 1.5 2.6 1.98-.75a7.5 7.5 0 0 0 2.25 1.3l.25 2.14h3.5l.25-2.14a7.5 7.5 0 0 0 2.25-1.3l1.98.75 1.5-2.6-1.77-1.03c.09-.45.14-.93.14-1.41Z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onPress={() =>
            actions.requestConfirm({
              title: "退出登录",
              message: "退出后需要重新登录才能继续同步，确认退出？",
              confirmLabel: "退出登录",
              action: () => actions.logout(),
            })
          }
          data-testid="logout"
          className="text-xs text-zinc-400"
        >
          退出登录
        </Button>
      </div>
    </aside>
  );
}

function ProjectLabel({ project }: { project: ProjectRecord }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={`size-2 shrink-0 rounded-full ${DOT_COLORS[project.color] ?? DOT_COLORS.gray}`} />
      <span className="truncate">{project.name}</span>
    </span>
  );
}

function SideItem(props: {
  active: boolean;
  label: ReactNode;
  count: number;
  testId: string;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={`group flex items-center justify-between rounded-lg px-3 py-1.5 text-sm transition ${
        props.active
          ? "bg-blue-500 text-white"
          : "text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      <button
        onClick={props.onClick}
        data-testid={props.testId}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className="min-w-0 flex-1 truncate">{props.label}</span>
      </button>
      {props.count > 0 && (
        <span
          className={`ml-1 text-xs ${props.active ? "text-blue-100" : "text-zinc-400"} group-hover:invisible`}
        >
          {props.count}
        </span>
      )}
      {props.onDelete && (
        <button
          onClick={props.onDelete}
          aria-label="删除项目"
          className={`ml-1 text-xs invisible group-hover:visible ${props.active ? "text-blue-100" : "text-zinc-400"} hover:text-red-500`}
        >
          ×
        </button>
      )}
    </div>
  );
}
