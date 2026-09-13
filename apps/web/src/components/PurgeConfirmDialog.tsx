import { Button, Modal } from "@heroui/react";
import { actions, useApp } from "../state/store";
import { collectDescendants } from "../lib/purge";

/** 彻底删除确认弹框：展示级联后的总条数与子任务数；
 * 确认后执行 purgeTasks——记录将从所有端与服务器永久移除，不可恢复。 */
export function PurgeConfirmDialog() {
  const ids = useApp((s) => s.purgeConfirm);
  const tasks = useApp((s) => s.tasks);
  if (!ids || ids.length === 0) return null;
  // 级联展示：彻底删除的不只是勾选项，还有整棵后代树（含存活子任务）
  const all = collectDescendants(tasks, ids);
  const cascade = all.length - ids.length;

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) actions.closePurgeConfirm();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog data-testid="purge-modal">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void actions.purgeTasks(ids);
              }}
              className="flex flex-col"
            >
              <Modal.Header>
                <Modal.Heading className="text-lg font-bold">彻底删除</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm">
                  将彻底删除 <span className="font-semibold text-red-500">{all.length}</span> 个任务
                  {cascade > 0 ? `（含 ${cascade} 个子任务）` : ""}，操作会同步从所有设备移除，且
                  <span className="font-semibold text-red-500">不可恢复</span>。
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="ghost"
                  type="button"
                  onPress={() => actions.closePurgeConfirm()}
                  data-testid="purge-cancel"
                >
                  取消
                </Button>
                <Button
                  variant="primary"
                  type="submit"
                  data-testid="purge-confirm"
                  className="bg-red-500 text-white hover:bg-red-600"
                >
                  彻底删除
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
