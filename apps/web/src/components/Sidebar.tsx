import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownPopover, DropdownTrigger, Input } from "@heroui/react";
import type { ProjectRecord } from "../types";
import { actions, useApp, type ViewKind } from "../state/store";
import { countTasks } from "../lib/filters";
import { isDesktopApp } from "../lib/platform";
import { ProjectRenameDialog } from "./ProjectRenameDialog";
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
 * 导航区滚动、底行固定：项目再多也不会把设置/登出推出视野。
 */
export function Sidebar() {
  const projects = useApp((s) => s.projects);
  const tasks = useApp((s) => s.tasks);
  const view = useApp((s) => s.view);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  // 重命名接缝：菜单「重命名」记录目标项目，ProjectRenameDialog 在 aside 底部条件渲染。
  const [renaming, setRenaming] = useState<ProjectRecord | null>(null);

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
            <ProjectRow
              key={p.id}
              project={p}
              active={view.kind === "project" && view.id === p.id}
              count={counts.get(`project:${p.id}`) ?? 0}
              projects={projects}
              onRename={(target) => setRenaming(target)}
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

      {/* 重命名对话框：菜单「重命名」→ 记录目标项目 → 此处条件渲染 */}
      {renaming && <ProjectRenameDialog project={renaming} onClose={() => setRenaming(null)} />}
    </aside>
  );
}

/** 项目行：左键导航 / 右键与长按唤出上下文菜单（⋯ 按钮也可打开），菜单内改色、重命名、删除。
 * 取代原 SideItem 在项目行的用法；智能清单仍由 SideItem 渲染。 */
function ProjectRow(props: {
  project: ProjectRecord;
  active: boolean;
  count: number;
  /** 全量项目列表（含已删除）：菜单 action 前校验项目是否仍然存在。 */
  projects: ProjectRecord[];
  /** 重命名接缝：菜单 action 转交父层打开 ProjectRenameDialog。 */
  onRename?: (p: ProjectRecord) => void;
}) {
  const p = props.project;
  const [menuOpen, setMenuOpen] = useState(false);
  // 长按哨兵：长按弹菜单后要吞掉抬手时触发的导航点击（React onClick 无法被 preventDefault 阻止）。
  const longPressedRef = useRef(false);
  // 长按自实现：触屏长按 500ms 弹菜单，移动超 10px 视为滚动意图取消；
  // 仅监听 touch 指针，桌面用右键/⋯；组件卸载时清理 window 监听与定时器。
  const pressStartRef = useRef<{ timer: number; cleanup: () => void } | null>(null);
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_TOLERANCE = 10;
  const longPressProps = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const startX = e.clientX;
      const startY = e.clientY;
      const onMove = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > LONG_PRESS_MOVE_TOLERANCE) cleanup();
      };
      const cleanup = () => {
        window.clearTimeout(pressStartRef.current?.timer);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", cleanup);
        window.removeEventListener("pointercancel", cleanup);
        pressStartRef.current = null;
      };
      const timer = window.setTimeout(() => {
        cleanup(); // 触发后无需再监听移动/抬手
        longPressedRef.current = true;
        setMenuOpen(true);
      }, LONG_PRESS_MS);
      pressStartRef.current = { timer, cleanup };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", cleanup);
      window.addEventListener("pointercancel", cleanup);
    },
  };
  useEffect(() => () => pressStartRef.current?.cleanup(), []);
  // 菜单过期防护：打开期间项目被他端删除/软删时，action 静默关闭菜单，不执行任何变更。
  const isStale = !props.projects.some((x) => x.id === p.id && !x.deleted);

  // DropdownTrigger 是 <button>，不能嵌套按钮，⋯ 菜单按钮放在它外层作兄弟元素。
  return (
    <div className="group flex items-center">
      <Dropdown trigger="contextMenu" isOpen={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownTrigger
          {...longPressProps}
          onPress={() => {
            // 长按松手会触发一次 React onClick（见 longPressedRef 注释），跳过防止误导航。
            if (longPressedRef.current) {
              longPressedRef.current = false;
              return;
            }
            actions.setView({ kind: "project", id: p.id });
          }}
          data-testid={`nav-project-${p.name}`}
          className={`flex min-w-0 flex-1 select-none items-center justify-between rounded-lg px-3 py-1.5 text-sm outline-none transition ${
            props.active
              ? "bg-blue-500 text-white"
              : "text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className={`size-2 shrink-0 rounded-full ${DOT_COLORS[p.color] ?? DOT_COLORS.gray}`} />
            <span className="truncate">{p.name}</span>
          </span>
          {props.count > 0 && (
            <span
              className={`ml-1 text-xs ${props.active ? "text-blue-100" : "text-zinc-400"} group-hover:invisible`}
            >
              {props.count}
            </span>
          )}
        </DropdownTrigger>
        <DropdownPopover placement="bottom start">
          {/* 色板不作为菜单项：放在 Menu 之上的自绘区块，点击直接改色并收起菜单。 */}
          <div className="flex gap-1 px-2 py-1.5">
            {Object.entries(DOT_COLORS).map(([color, cls]) => (
              <button
                key={color}
                aria-label={`颜色：${color}`}
                data-testid={`project-color-${color}`}
                className={`size-5 rounded-full text-[10px] leading-none text-white ${cls} ${
                  p.color === color ? "ring-2 ring-offset-1" : ""
                }`}
                onClick={() => {
                  if (isStale) {
                    setMenuOpen(false);
                    return;
                  }
                  void actions.setProjectColor(p.id, color);
                  setMenuOpen(false);
                }}
              >
                {p.color === color ? "✓" : ""}
              </button>
            ))}
          </div>
          <DropdownMenu>
            {/* 动作挂在 Item 自身的 onAction 上：RAC Menu 本身无 onAction prop（传了会被静默忽略），
                这是首版「点重命名无反应」的根因 */}
            <DropdownItem
              key="rename"
              onAction={() => {
                if (isStale) {
                  setMenuOpen(false);
                  return;
                }
                setMenuOpen(false);
                props.onRename?.(p);
              }}
            >
              重命名
            </DropdownItem>
            <DropdownItem
              key="delete"
              className="text-red-500 data-[focused]:text-red-500"
              onAction={() => {
                if (isStale) {
                  setMenuOpen(false);
                  return;
                }
                setMenuOpen(false);
                actions.requestConfirm({
                  title: "删除项目",
                  message: `项目「${p.name}」及其任务将移入回收站，可在回收站恢复。`,
                  confirmLabel: "删除",
                  danger: true,
                  action: () => void actions.deleteProject(p.id),
                });
              }}
            >
              删除
            </DropdownItem>
          </DropdownMenu>
        </DropdownPopover>
      </Dropdown>
      <Button
        isIconOnly
        variant="ghost"
        size="sm"
        className="ml-1 shrink-0 p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        onPress={() => setMenuOpen(true)}
        aria-label="项目菜单"
        data-testid={`project-menu-${p.name}`}
      >
        ⋯
      </Button>
    </div>
  );
}

function SideItem(props: {
  active: boolean;
  label: ReactNode;
  count: number;
  testId: string;
  onClick: () => void;
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
    </div>
  );
}
