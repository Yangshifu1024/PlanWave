import { Button, Modal } from "@heroui/react";
import type { ProjectRecord, TaskRecord } from "../types";
import { useShellMode } from "../lib/useShellMode";
import { TaskRow } from "./TaskRow";

/**
 * 某一天的任务浮层：桌面居中弹框、移动端底部抽屉（同一份内容）。
 * 点条目 → 冒泡关浮层（`TaskRow` 自身已打开详情）；`onAdd` 存在时展示该日新建入口
 * （未排期浮层不传 `onAdd`，只作只读列表）。
 */
export function DayTasksOverlay(props: {
  title: string;
  tasks: TaskRecord[];
  projects: ProjectRecord[];
  onClose: () => void;
  onAdd?: () => void;
  testId?: string;
}) {
  const bottom = useShellMode() === "compact";
  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container placement={bottom ? "bottom" : "center"}>
          <Modal.Dialog
            data-testid={props.testId ?? "day-tasks-overlay"}
            className="w-full sm:max-w-md"
          >
            <Modal.Header>
              <Modal.Heading className="text-base font-bold">{props.title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-3">
              {props.tasks.length === 0 ? (
                <p className="py-6 text-center text-sm text-fg-subtle">这天没有任务</p>
              ) : (
                <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto" onClick={props.onClose}>
                  {props.tasks.map((t) => (
                    <li key={t.id}>
                      <TaskRow task={t} showProject projects={props.projects} />
                    </li>
                  ))}
                </ul>
              )}
              {props.onAdd && (
                <Button
                  variant="primary"
                  onPress={() => {
                    props.onClose();
                    props.onAdd?.();
                  }}
                  data-testid="day-add-task"
                >
                  添加任务到这天
                </Button>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
