//! 同步状态详情页：pending 队列、最近 op、游标与错误信息（移动端底部抽屉，桌面居中弹层）。

import { useEffect } from "react";
import { Button } from "@heroui/react";
import { actions, useApp } from "../state/store";
import { describePatch } from "../lib/opSummary";
import type { SyncOpInfo } from "../types";

function timeLabel(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function OpRow({ op, dir }: { op: SyncOpInfo; dir?: "pending" | "recent" }) {
  const isLocal = op.dir === "local";
  return (
    <li className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
      <span
        className={`mt-0.5 shrink-0 rounded px-1 py-px font-medium ${
          dir === "pending"
            ? "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300"
            : isLocal
              ? "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300"
              : "bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-300"
        }`}
      >
        {dir === "pending" ? "待推" : isLocal ? "本地" : "远端"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-zinc-700 dark:text-zinc-200">{describePatch(op.patch)}</span>
        <span className="text-zinc-400">
          {dir === "recent" ? timeLabel(op.at_ms ?? op.client_time_ms) : timeLabel(op.client_time_ms)}
          {" · λ"}
          {op.lamport}
          {op.seq !== undefined && ` · seq ${op.seq}`}
          {" · "}
          {shortId(op.entity_id)}
        </span>
      </span>
    </li>
  );
}

export function SyncStatusSheet() {
  const open = useApp((s) => s.syncSheetOpen);
  const details = useApp((s) => s.syncDetails);
  const refreshing = useApp((s) => s.refreshing);
  const syncStatus = useApp((s) => s.syncStatus);

  // 打开期间跟随刷新，保证数据新鲜
  useEffect(() => {
    if (!open) return;
    void actions.loadSyncDetails();
    const timer = setInterval(() => void actions.loadSyncDetails(), 5000);
    return () => clearInterval(timer);
  }, [open]);

  if (!open) return null;
  const meta = details?.meta;
  const statusText = { online: "已同步", syncing: "同步中", offline: "离线" }[syncStatus];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 md:items-center"
      onClick={() => actions.closeSyncSheet()}
      data-testid="sync-sheet"
    >
      <div
        className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-zinc-900 md:max-w-md md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">同步状态</h2>
          <button
            onClick={() => actions.closeSyncSheet()}
            className="rounded-lg px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="关闭"
            data-testid="sync-sheet-close"
          >
            ×
          </button>
        </div>

        {/* 概览 */}
        <div className="mb-4 space-y-1.5 rounded-xl bg-zinc-50 p-3 text-xs text-zinc-500 dark:bg-zinc-800/60">
          <div className="flex justify-between">
            <span>状态</span>
            <span data-testid="sync-sheet-status">{statusText}</span>
          </div>
          <div className="flex justify-between">
            <span>最近同步</span>
            <span>{timeLabel(meta?.last_sync_at)}</span>
          </div>
          <div className="flex justify-between">
            <span>待推送 / 最近推送</span>
            <span>
              {details?.pending.count ?? "—"} 条 / {meta?.last_pushed ?? "—"} 条
            </span>
          </div>
          <div className="flex justify-between">
            <span>已拉取游标 (seq)</span>
            <span>{meta?.last_pulled_seq ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span>最近拉取应用</span>
            <span>{meta?.last_pulled ?? "—"} 条</span>
          </div>
          <div className="flex justify-between">
            <span>Lamport 时钟</span>
            <span>{meta?.lamport ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span>设备标识</span>
            <span className="font-mono">{meta ? shortId(meta.device_id) : "—"}</span>
          </div>
        </div>

        {meta?.last_error && (
          <div
            className="mb-4 rounded-xl bg-red-50 p-3 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-300"
            data-testid="sync-sheet-error"
          >
            <div className="mb-0.5 font-medium">最近同步失败</div>
            <div className="break-all">{meta.last_error}</div>
          </div>
        )}

        <div className="mb-4">
          <Button
            size="sm"
            variant="primary"
            isDisabled={refreshing}
            onPress={async () => {
              await actions.refresh();
              await actions.loadSyncDetails();
            }}
            data-testid="sync-sheet-refresh"
            fullWidth
          >
            {refreshing ? "同步中…" : "立即同步"}
          </Button>
        </div>

        {/* 待推送队列 */}
        <section className="mb-4">
          <h3 className="mb-1 text-xs font-medium text-zinc-400">
            待推送队列（{details?.pending.count ?? 0}）
          </h3>
          {details && details.pending.ops.length > 0 ? (
            <ul className="space-y-0.5">
              {details.pending.ops.map((op) => (
                <OpRow key={op.op_id} op={op} dir="pending" />
              ))}
              {details.pending.count > details.pending.ops.length && (
                <li className="px-2 py-1 text-xs text-zinc-400">
                  仅显示前 {details.pending.ops.length} 条…
                </li>
              )}
            </ul>
          ) : (
            <div className="rounded-lg bg-zinc-50 px-3 py-3 text-center text-xs text-zinc-400 dark:bg-zinc-800/60">
              没有待同步的更改
            </div>
          )}
        </section>

        {/* 最近 op */}
        <section className="mb-1">
          <h3 className="mb-1 text-xs font-medium text-zinc-400">最近操作</h3>
          {details && details.recent_ops.length > 0 ? (
            <ul className="space-y-0.5">
              {details.recent_ops.map((op) => (
                <OpRow key={op.op_id} op={op} dir="recent" />
              ))}
            </ul>
          ) : (
            <div className="rounded-lg bg-zinc-50 px-3 py-3 text-center text-xs text-zinc-400 dark:bg-zinc-800/60">
              暂无记录
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
