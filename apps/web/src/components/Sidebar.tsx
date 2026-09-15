import { useMemo, useState, type ReactNode } from "react";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownPopover, DropdownTrigger, Input, Label, Separator } from "@heroui/react";
import type { ProjectRecord } from "../types";
import { actions, useApp, type ViewKind } from "../state/store";
import { countTasks } from "../lib/filters";
import { PROJECT_DOT_COLORS, projectDotClass } from "../lib/projectColors";
import { isDesktopApp } from "../lib/platform";
import { ProjectRenameDialog } from "./ProjectRenameDialog";
import { Logo } from "../App";

const SMART_LISTS: { key: "today" | "upcoming" | "all" | "trash"; label: string }[] = [
  { key: "today", label: "今天" },
  { key: "upcoming", label: "最近 7 天" },
  { key: "all", label: "全部" },
  { key: "trash", label: "回收站" },
];

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

/** 项目行：左键导航；⋯ 按钮唤出项目菜单（改色 / 重命名 / 删除）。
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
  // 菜单受控开合：菜单项选中由 RAC 自动收起，但色块是 Popover 直下的普通按钮，需手动收起。
  const [menuOpen, setMenuOpen] = useState(false);
  // 菜单过期防护：打开期间项目被他端删除/软删时，action 静默忽略，不执行任何变更。
  const isStale = !props.projects.some((x) => x.id === p.id && !x.deleted);

  return (
    <div className="group flex items-center">
      {/* 导航区：左键切换到该项目视图（testid 保持在可点击元素上，E2E 依赖）。 */}
      <button
        onClick={() => actions.setView({ kind: "project", id: p.id })}
        data-testid={`nav-project-${p.name}`}
        className={`flex min-w-0 flex-1 items-center justify-between rounded-lg px-3 py-1.5 text-sm outline-none transition ${
          props.active
            ? "bg-blue-500 text-white"
            : "text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${projectDotClass(p.color)}`} />
          <span className="truncate">{p.name}</span>
        </span>
        {props.count > 0 && (
          <span
            className={`ml-1 text-xs ${props.active ? "text-blue-100" : "text-zinc-400"} group-hover:invisible`}
          >
            {props.count}
          </span>
        )}
      </button>
      {/* 项目菜单：⋯ 按钮为全平台唯一入口；DropdownTrigger 本身就是按钮（内部不可再嵌 Button，
          否则 <button> 套 <button> 非法嵌套，React 恢复时会丢掉弹层内容）。 */}
      <Dropdown isOpen={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownTrigger
          aria-label="项目菜单"
          data-testid={`project-menu-${p.name}`}
          className="ml-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-200/60 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          ⋯
        </DropdownTrigger>
        <DropdownPopover placement="bottom end">
          {/* 颜色区放 Menu 之外的 Popover 直下：RAC Menu 只渲染集合节点（Item/Section），
              裸 div 会被集合构建剔除（首版「弹层开着但内容为空」的根因）。 */}
          <div aria-label="项目颜色" className="flex items-center gap-1.5 px-2 pt-2">
            <span className="text-xs font-medium text-zinc-400">颜色</span>
            {Object.entries(PROJECT_DOT_COLORS).map(([color, cls]) => (
              <button
                key={color}
                aria-label={`颜色：${color}`}
                aria-pressed={p.color === color}
                data-testid={`project-color-${color}`}
                onClick={() => {
                  if (isStale) return;
                  void actions.setProjectColor(p.id, color);
                  setMenuOpen(false); // 色块非菜单项，RAC 不会自动收起，手动关
                }}
                className={`flex size-6 cursor-pointer items-center justify-center rounded-full text-[10px] leading-none text-white transition hover:scale-110 ${cls} ${
                  p.color === color
                    ? "ring-2 ring-blue-500 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900"
                    : ""
                }`}
              >
                {p.color === color ? "✓" : ""}
              </button>
            ))}
          </div>
          <Separator className="mt-2" />
          <DropdownMenu>
            {/* 动作挂在 Item 自身的 onAction 上：RAC Menu 本身无 onAction prop（传了会被静默忽略），
                这是首版「点重命名无反应」的根因；文字用官方 Label 吃 hover/焦点态，删除用官方 danger 变体；
                菜单项选中后由 RAC 自动收起菜单。 */}
            <DropdownItem
              key="rename"
              onAction={() => {
                if (isStale) return;
                props.onRename?.(p);
              }}
            >
              <Label>重命名</Label>
            </DropdownItem>
            <DropdownItem
              key="delete"
              variant="danger"
              onAction={() => {
                if (isStale) return;
                actions.requestConfirm({
                  title: "删除项目",
                  message: `项目「${p.name}」及其任务将移入回收站，可在回收站恢复。`,
                  confirmLabel: "删除",
                  danger: true,
                  action: () => void actions.deleteProject(p.id),
                });
              }}
            >
              <Label>删除</Label>
            </DropdownItem>
          </DropdownMenu>
        </DropdownPopover>
      </Dropdown>
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
