import { useMemo, useState, type ReactNode } from "react";
import {
  Button,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownPopover,
  DropdownTrigger,
  Input,
  Label,
  Separator,
} from "@heroui/react";
import type { ProjectRecord } from "../types";
import { actions, useApp, type ViewKind } from "../state/store";
import { countTasks } from "../lib/filters";
import { PROJECT_DOT_COLORS, projectDotClass } from "../lib/projectColors";
import { ProjectRenameDialog } from "./ProjectRenameDialog";
import { Logo } from "./ui/Logo";

const ICON_TODAY = (
  <svg viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" aria-hidden>
    <rect x="3" y="4" width="14" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M3 8h14M7 2.5v3M13 2.5v3"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <circle cx="10" cy="12.5" r="1.5" fill="currentColor" />
  </svg>
);

const ICON_UPCOMING = (
  <svg viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" aria-hidden>
    <rect x="3" y="4" width="14" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M3 8h14M7 2.5v3M13 2.5v3"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path d="M6.5 11h7M6.5 14h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const ICON_ALL = (
  <svg viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" aria-hidden>
    <path
      d="M3 6.5A2.5 2.5 0 0 1 5.5 4h9A2.5 2.5 0 0 1 17 6.5v7A2.5 2.5 0 0 1 14.5 16h-9A2.5 2.5 0 0 1 3 13.5v-7Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M3 11h4l1 1.8h4L13 11h4"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

const ICON_TRASH = (
  <svg viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" aria-hidden>
    <path
      d="M4 5.5h12M8 5.5V4.4c0-.5.4-.9.9-.9h2.2c.5 0 .9.4.9.9v1.1M6 5.5l.6 9.6c0 .7.6 1.2 1.2 1.2h4.4c.7 0 1.2-.5 1.2-1.2l.6-9.6"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const SMART_LISTS: {
  key: "today" | "upcoming" | "all" | "trash";
  label: string;
  icon: ReactNode;
}[] = [
  { key: "today", label: "今天", icon: ICON_TODAY },
  { key: "upcoming", label: "最近 7 天", icon: ICON_UPCOMING },
  { key: "all", label: "全部", icon: ICON_ALL },
  { key: "trash", label: "回收站", icon: ICON_TRASH },
];

/** 左侧栏：智能清单 + 项目列表 + 设置/登出。
 * 桌面由 AdaptivePane 常驻（宽 240/256），移动端为抽屉。
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
    for (const s of SMART_LISTS)
      map.set(`smart:${s.key}`, compute({ kind: "smart", smart: s.key }));
    for (const p of projects) map.set(`project:${p.id}`, compute({ kind: "project", id: p.id }));
    return map;
  }, [tasks, projects]);

  const submitProject = async () => {
    await actions.addProject(newName);
    setNewName("");
    setAdding(false);
  };

  return (
    <aside className="flex h-full w-full shrink-0 flex-col gap-1 p-3">
      <div className="mb-3 flex items-center gap-2 px-2 pt-2">
        <Logo className="size-6 text-blue-500" />
        <span className="text-sm font-semibold tracking-widest text-fg-subtle">PLANWAVE</span>
      </div>

      {/* 可滚动导航区：项目再多时仅此区域滚动，底行始终固定 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {SMART_LISTS.map((s) => (
          <SideItem
            key={s.key}
            icon={s.icon}
            active={view.kind === "smart" && view.smart === s.key}
            label={s.label}
            count={counts.get(`smart:${s.key}`) ?? 0}
            testId={`nav-${s.key}`}
            onClick={() => actions.setView({ kind: "smart", smart: s.key })}
          />
        ))}

        <div className="mt-5 flex items-center justify-between px-2">
          <span className="text-xs font-medium uppercase tracking-wider text-fg-subtle">项目</span>
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
          className="text-fg-subtle"
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
          className="text-xs text-fg-subtle"
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
 * ⋯ 常显（去除 hover 才出现的交互）；计数也不再悬停隐藏。 */
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
    <div className="group flex items-center gap-1">
      {/* 导航区：左键切换到该项目视图（testid 保持在可点击元素上，E2E 依赖）。 */}
      <button
        onClick={() => actions.setView({ kind: "project", id: p.id })}
        data-testid={`nav-project-${p.name}`}
        className={`flex min-w-0 flex-1 items-center justify-between rounded-lg px-3 py-1.5 text-sm outline-none transition ${
          props.active
            ? "bg-pw-selected font-medium text-pw-accent"
            : "text-fg-muted hover:bg-pw-hover"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${projectDotClass(p.color)}`} />
          <span className="truncate">{p.name}</span>
        </span>
        {props.count > 0 && (
          <span className={`ml-1 text-xs ${props.active ? "text-pw-accent/70" : "text-fg-subtle"}`}>
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
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-subtle transition hover:bg-pw-hover hover:text-fg"
        >
          ⋯
        </DropdownTrigger>
        <DropdownPopover placement="bottom end">
          {/* 颜色区放 Menu 之外的 Popover 直下：RAC Menu 只渲染集合节点（Item/Section），
              裸 div 会被集合构建剔除（首版「弹层开着但内容为空」的根因）。 */}
          <div aria-label="项目颜色" className="flex items-center gap-1.5 px-2 pt-2">
            <span className="text-xs font-medium text-fg-subtle">颜色</span>
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
            {/* 动作挂在 Item 自身的 onAction 上：RAC Menu 本身无 onAction prop（传了会被静默忽略）；
                文字用官方 Label 吃 hover/焦点态，删除用官方 danger 变体；菜单项选中后由 RAC 自动收起。 */}
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
  icon: ReactNode;
  active: boolean;
  label: ReactNode;
  count: number;
  testId: string;
  onClick: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg text-sm transition ${
        props.active
          ? "bg-pw-selected font-medium text-pw-accent"
          : "text-fg-muted hover:bg-pw-hover"
      }`}
    >
      <button
        onClick={props.onClick}
        data-testid={props.testId}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
      >
        {props.icon}
        <span className="min-w-0 flex-1 truncate">{props.label}</span>
      </button>
      {props.count > 0 && (
        <span className={`pr-3 text-xs ${props.active ? "text-pw-accent/70" : "text-fg-subtle"}`}>
          {props.count}
        </span>
      )}
    </div>
  );
}
