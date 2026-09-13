import { Button, Modal } from "@heroui/react";
import { isDesktopApp, isTauri } from "../lib/platform";
import {
  downloadApkOnAndroid,
  relaunchApp,
  skipUpdate,
  startDesktopUpdate,
} from "../lib/updater";
import { useApp } from "../state/store";

/** 应用更新弹框（桌面/Android）：新版本信息 → 下载进度 → 重启安装。 */
export function UpdateDialog() {
  const info = useApp((s) => s.updateInfo);
  const phase = useApp((s) => s.updatePhase);
  const progress = useApp((s) => s.updateProgress);
  const error = useApp((s) => s.updateError);
  const isAndroid = isTauri && !isDesktopApp;

  if (!info || !isTauri) return null;

  const busy = phase === "checking" || phase === "downloading";

  const startUpdate = () => {
    if (isAndroid) void downloadApkOnAndroid();
    else void startDesktopUpdate();
  };

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        // 下载中/待重启时禁止 Esc 与点遮罩关闭：关闭会丢失更新入口；
        // 空闲态关闭 = 跳过此版本
        if (!open && phase === "idle") skipUpdate();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog data-testid="update-modal">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (phase === "ready") {
                  if (!isAndroid) void relaunchApp();
                } else if (phase === "idle") {
                  startUpdate();
                }
              }}
              className="flex flex-col"
            >
              <Modal.Header>
                <Modal.Heading className="text-lg font-bold">
                  发现新版本 v{info.version}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="gap-3">
                <p className="whitespace-pre-line text-sm">
                  {info.notes.trim() !== "" ? info.notes : "新版本可用，包含问题修复与改进。"}
                </p>
                {phase === "downloading" && (
                  <div className="space-y-1.5">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                      <div
                        className="h-full bg-blue-500 transition-all"
                        style={{ width: `${progress ?? 0}%` }}
                      />
                    </div>
                    <p className="text-xs text-zinc-400" data-testid="update-progress-text">
                      正在下载…{progress !== null ? `${progress}%` : ""}
                    </p>
                  </div>
                )}
                {phase === "ready" && (
                  <p className="text-sm text-green-600 dark:text-green-400">
                    {isAndroid
                      ? "下载完成，已拉起系统安装器，请在系统提示中确认安装。"
                      : "下载完成，重启应用即可完成安装。"}
                  </p>
                )}
                {error && (
                  <p className="text-sm text-red-500" data-testid="update-error">
                    {error}
                  </p>
                )}
              </Modal.Body>
              <Modal.Footer>
                {phase === "ready" ? (
                  isAndroid ? (
                    <Button
                      variant="ghost"
                      type="button"
                      onPress={() => skipUpdate()}
                      data-testid="update-close"
                    >
                      关闭
                    </Button>
                  ) : (
                    <Button variant="primary" type="submit" data-testid="update-restart">
                      重启安装
                    </Button>
                  )
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      type="button"
                      isDisabled={busy}
                      onPress={() => skipUpdate()}
                      data-testid="update-skip"
                    >
                      跳过此版本
                    </Button>
                    <Button
                      variant="primary"
                      type="submit"
                      isDisabled={busy}
                      data-testid="update-install"
                    >
                      {busy ? "下载中…" : "立即更新"}
                    </Button>
                  </>
                )}
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
