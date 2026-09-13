import { Button, Modal } from "@heroui/react";
import { actions, useApp } from "../state/store";

/** 通用确认弹框：退出登录/完成任务/删除任务等操作的确认门。 */
export function AppConfirmDialog() {
  const confirm = useApp((s) => s.confirm);
  if (!confirm) return null;
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) actions.clearConfirm();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog data-testid="confirm-dialog">
            <Modal.Header>
              <Modal.Heading className="text-lg font-bold">{confirm.title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p className="text-sm">{confirm.message}</p>
            </Modal.Body>
            <Modal.Footer>
              <Button
                variant="ghost"
                type="button"
                onPress={() => actions.clearConfirm()}
                data-testid="confirm-cancel"
              >
                取消
              </Button>
              {/* danger = 破坏性操作：确认按钮转红色警示 */}
              {confirm.danger ? (
                <Button
                  type="button"
                  className="bg-red-500 text-white hover:bg-red-600"
                  onPress={() => {
                    void confirm.action();
                    actions.clearConfirm();
                  }}
                  data-testid="confirm-accept"
                >
                  {confirm.confirmLabel}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  type="button"
                  onPress={() => {
                    void confirm.action();
                    actions.clearConfirm();
                  }}
                  data-testid="confirm-accept"
                >
                  {confirm.confirmLabel}
                </Button>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
