import type { ReactNode } from "react";

/**
 * 自适应面板：
 * - `main`：常驻内容列（flex-col 是承重的，TaskList 依赖它撑满高度并可滚动）
 * - `nav`：compact 左侧抽屉 ↔ regular/wide 常驻栏（几何见 tokens.css `.pw-nav-drawer`）
 * - `detail`：compact 全屏 ↔ regular 右侧抽屉 ↔ wide 停靠（`.pw-detail-pane`）
 */
export function AdaptivePane({
  role,
  open = true,
  onClose,
  children,
  testId,
  className = "",
}: {
  role: "nav" | "main" | "detail";
  open?: boolean;
  onClose?: () => void;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  if (role === "main") {
    return (
      <main className={`flex min-w-0 flex-1 flex-col bg-pw-surface ${className}`}>{children}</main>
    );
  }

  if (role === "nav") {
    return (
      <>
        {open && (
          <div
            className="fixed inset-0 z-20 bg-black/30 md:hidden"
            onClick={onClose}
            data-testid="sidebar-backdrop"
          />
        )}
        <div className={`pw-nav-drawer bg-canvas ${className}`} data-open={open}>
          {children}
        </div>
      </>
    );
  }

  return (
    <>
      {open && (
        <div className="pw-detail-backdrop" onClick={onClose} data-testid="detail-backdrop" />
      )}
      <div
        data-testid={testId}
        className={`pw-detail-pane flex flex-col overflow-hidden bg-pw-surface ${className}`}
      >
        {children}
      </div>
    </>
  );
}
