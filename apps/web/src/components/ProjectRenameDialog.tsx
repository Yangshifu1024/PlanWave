import { useState, type FormEvent } from "react";
import { Button, Input, Modal } from "@heroui/react";
import type { ProjectRecord } from "../types";
import { actions, useApp } from "../state/store";
import { useShellMode } from "../lib/useShellMode";

/**
 * 重命名项目弹窗：项目右键菜单「重命名」入口打开。
 * Modal 层级约束同 QuickAddModal：Container/Dialog 必须是 Backdrop 的子节点，
 * 否则脱离定位上下文退回文档流，弹窗不再居中。
 */
export function ProjectRenameDialog({
  project,
  onClose,
}: {
  project: ProjectRecord;
  onClose: () => void;
}) {
  // 弹窗为条件挂载（关闭即卸载），草稿只需按 props 初始化一次
  const [draft, setDraft] = useState(project.name);
  const bottom = useShellMode() === "compact";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // 提交前校验项目仍存在：弹窗打开期间项目可能被他端删除，此时静默关闭不产生任何变更
    const alive = useApp.getState().projects.some((x) => x.id === project.id && !x.deleted);
    if (!alive) {
      onClose();
      return;
    }
    const name = draft.trim();
    // 空名静默取消：与侧栏新建项目行为一致，不报错、不产生变更
    if (!name) {
      onClose();
      return;
    }
    void actions.renameProject(project.id, name).then(onClose);
  };

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container placement={bottom ? "bottom" : "center"}>
          <Modal.Dialog data-testid="rename-project-dialog">
            <form onSubmit={submit} className="flex flex-col">
              <Modal.Header>
                <Modal.Heading className="text-lg font-bold">重命名项目</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  autoFocus
                  aria-label="项目名称"
                  data-testid="rename-project-input"
                />
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" type="button" onPress={onClose} data-testid="rename-cancel">
                  取消
                </Button>
                <Button variant="primary" type="submit" data-testid="rename-accept">
                  保存
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
