import { useState, type ReactNode } from "react";
import { Modal } from "@heroui/react";
import { actions, useApp } from "../../state/store";
import { useShellMode } from "../../lib/useShellMode";

const ICON_TODAY = (
  <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden>
    <rect x="3" y="4" width="14" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M3 8h14M7 2.5v3M13 2.5v3"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <circle cx="10" cy="12.5" r="1.6" fill="currentColor" />
  </svg>
);

const ICON_ALL = (
  <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden>
    <path
      d="M3 5.5h14M3 10h14M3 14.5h9"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

const ICON_PROJECTS = (
  <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden>
    <path
      d="M3 6.5A2.5 2.5 0 0 1 5.5 4h2.2l1.4 1.8h5.4A2.5 2.5 0 0 1 17 8.3v5.2A2.5 2.5 0 0 1 14.5 16h-9A2.5 2.5 0 0 1 3 13.5v-7Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
);

const ICON_MORE = (
  <svg viewBox="0 0 20 20" className="size-5" fill="none" aria-hidden>
    <circle cx="4.5" cy="10" r="1.4" fill="currentColor" />
    <circle cx="10" cy="10" r="1.4" fill="currentColor" />
    <circle cx="15.5" cy="10" r="1.4" fill="currentColor" />
  </svg>
);

/**
 * compact（< 768px）底部导航：今天 / 全部 / 项目 / 更多。
 * 项目是「抽屉开合」的 chrome 控件（非目的地）；更多打开底部菜单。
 * 非 compact 或非 ready 阶段返回 null（不并入 a11y 树）。
 */
export function BottomNav() {
  const shell = useShellMode();
  const phase = useApp((s) => s.phase);
  const view = useApp((s) => s.view);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const [moreOpen, setMoreOpen] = useState(false);

  if (shell !== "compact" || phase !== "ready") return null;

  const todayActive = view.kind === "smart" && view.smart === "today";
  const allActive = view.kind === "smart" && view.smart === "all";
  const projectsActive = view.kind === "project";

  return (
    <>
      <nav
        className="z-40 flex h-[52px] shrink-0 border-t border-pw-border bg-canvas pb-[var(--pw-safe-bottom)]"
        data-testid="bottom-nav"
      >
        <NavTab
          testId="tab-today"
          label="今天"
          icon={ICON_TODAY}
          active={todayActive}
          onClick={() => actions.setView({ kind: "smart", smart: "today" })}
        />
        <NavTab
          testId="tab-all"
          label="全部"
          icon={ICON_ALL}
          active={allActive}
          onClick={() => actions.setView({ kind: "smart", smart: "all" })}
        />
        <NavTab
          testId="nav-projects-tab"
          label="项目"
          icon={ICON_PROJECTS}
          active={projectsActive}
          ariaExpanded={sidebarOpen}
          onClick={() => actions.toggleSidebar(true)}
        />
        <NavTab
          testId="nav-more"
          label="更多"
          icon={ICON_MORE}
          active={false}
          onClick={() => setMoreOpen(true)}
        />
      </nav>
      {moreOpen && <MoreSheet onClose={() => setMoreOpen(false)} />}
    </>
  );
}

function NavTab({
  testId,
  label,
  icon,
  active,
  ariaExpanded,
  onClick,
}: {
  testId: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  ariaExpanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-current={active ? "page" : undefined}
      aria-expanded={ariaExpanded}
      onClick={onClick}
      className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 text-[10px] transition ${
        active ? "text-pw-accent" : "text-fg-subtle"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** compact「更多」底部菜单：次级目的地与全局动作。 */
function MoreSheet({ onClose }: { onClose: () => void }) {
  const closeThen = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container placement="bottom">
          <Modal.Dialog data-testid="more-sheet">
            <Modal.Header>
              <Modal.Heading className="text-base font-bold">更多</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-1">
              <SheetItem
                testId="more-upcoming"
                onClick={closeThen(() => actions.setView({ kind: "smart", smart: "upcoming" }))}
              >
                最近 7 天
              </SheetItem>
              <SheetItem
                testId="more-trash"
                onClick={closeThen(() => actions.setView({ kind: "smart", smart: "trash" }))}
              >
                回收站
              </SheetItem>
              <SheetItem testId="more-sync" onClick={closeThen(() => void actions.openSyncSheet())}>
                同步状态
              </SheetItem>
              <SheetItem testId="more-settings" onClick={closeThen(() => actions.openSettings())}>
                设置
              </SheetItem>
              <SheetItem
                testId="more-logout"
                onClick={closeThen(() =>
                  actions.requestConfirm({
                    title: "退出登录",
                    message: "退出后需要重新登录才能继续同步，确认退出？",
                    confirmLabel: "退出登录",
                    action: () => actions.logout(),
                  }),
                )}
              >
                退出登录
              </SheetItem>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function SheetItem({
  testId,
  onClick,
  children,
}: {
  testId: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="rounded-xl px-3 py-3 text-left text-sm text-fg-muted transition hover:bg-pw-hover hover:text-fg"
    >
      {children}
    </button>
  );
}
