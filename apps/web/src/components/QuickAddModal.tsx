import { useRef, useState, type FormEvent } from "react";
import { Button, Input, ListBox, ListBoxItem, Modal, Select, TextArea } from "@heroui/react";
import { actions, useApp } from "../state/store";
import { fromDateInput, toDateInput } from "../lib/dates";
import { Field, PRIORITIES } from "./TaskDetail";

/**
 * 新建任务详情弹框：快速添加回车后弹出，标题预填输入框内容。
 * `dueDate` 可选预填（月视图点格子新建时传入当天）。
 * 「关闭」（含 Esc/点遮罩）= 放弃创建；「保存」校验标题非空后创建任务。
 */
export function QuickAddModal({
  title,
  dueDate = null,
  onClose,
}: {
  title: string;
  dueDate?: number | null;
  onClose: () => void;
}) {
  const projects = useApp((s) => s.projects);
  const view = useApp((s) => s.view);
  // 弹框为条件挂载（关闭即卸载），草稿只需按 props 初始化一次
  const [draft, setDraft] = useState(() => ({
    title,
    priority: 0,
    due: toDateInput(dueDate), // yyyy-MM-dd，空串 = 未设置
    project_id: view.kind === "project" ? view.id : "",
    labels: "",
    notes: "",
  }));
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = draft.title.trim();
    if (!trimmed) {
      setError("标题不能为空");
      titleRef.current?.focus();
      return;
    }
    void actions.addTask({
      title: trimmed,
      projectId: draft.project_id,
      priority: draft.priority,
      dueDate: fromDateInput(draft.due),
      labels: draft.labels
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      notes: draft.notes,
    });
    onClose();
  };

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* react-aria 结构要求：Container/Dialog 必须是 Backdrop（ModalOverlay）的子节点，
          否则脱离定位上下文退回文档流，弹框不再居中 */}
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog data-testid="new-task-modal">
            <form onSubmit={submit} className="flex flex-col">
              <Modal.Header>
                <Modal.Heading className="text-lg font-bold">新建任务</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-4">
                <div className="space-y-1.5">
                  <Input
                    ref={titleRef}
                    value={draft.title}
                    onChange={(e) => {
                      setDraft({ ...draft, title: e.target.value });
                      if (error) setError(null);
                    }}
                    placeholder="任务标题"
                    fullWidth
                    autoFocus
                    aria-invalid={error !== null}
                    aria-describedby={error !== null ? "new-task-error-desc" : undefined}
                    data-testid="new-task-title"
                    aria-label="任务标题"
                  />
                  {error && (
                    <p
                      id="new-task-error-desc"
                      className="text-sm text-red-500"
                      role="alert"
                      data-testid="new-task-error"
                    >
                      {error}
                    </p>
                  )}
                </div>

                <Field label="优先级">
                  <div className="flex gap-1" data-testid="new-task-priority">
                    {PRIORITIES.map((p) => (
                      <Button
                        key={p.value}
                        size="sm"
                        type="button"
                        variant={draft.priority === p.value ? "primary" : "ghost"}
                        onPress={() => setDraft({ ...draft, priority: p.value })}
                      >
                        {p.label}
                      </Button>
                    ))}
                  </div>
                </Field>

                <Field label="截止日期">
                  <div className="flex w-full items-center gap-2">
                    <input
                      type="date"
                      value={draft.due}
                      onChange={(e) => setDraft({ ...draft, due: e.target.value })}
                      data-testid="new-task-due"
                      aria-label="截止日期"
                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 [color-scheme:light] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:[color-scheme:dark]"
                    />
                    {draft.due !== "" && (
                      <Button
                        size="sm"
                        type="button"
                        variant="ghost"
                        onPress={() => setDraft({ ...draft, due: "" })}
                        className="shrink-0 text-xs text-zinc-400"
                      >
                        清除
                      </Button>
                    )}
                  </div>
                </Field>

                <Field label="所属项目">
                  <Select
                    selectedKey={draft.project_id || null}
                    onSelectionChange={(key) =>
                      setDraft({ ...draft, project_id: (key as string) ?? "" })
                    }
                    data-testid="new-task-project"
                    aria-label="所属项目"
                    fullWidth
                  >
                    <Select.Trigger>
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        <ListBoxItem id="">收集箱（无项目）</ListBoxItem>
                        {projects
                          .filter((p) => !p.deleted)
                          .map((p) => (
                            <ListBoxItem key={p.id} id={p.id}>
                              {p.name}
                            </ListBoxItem>
                          ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </Field>

                <Field label="标签（逗号分隔）">
                  <Input
                    value={draft.labels}
                    onChange={(e) => setDraft({ ...draft, labels: e.target.value })}
                    placeholder="工作, 重要"
                    fullWidth
                    data-testid="new-task-labels"
                  />
                </Field>

                <Field label="备注">
                  <TextArea
                    value={draft.notes}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    rows={3}
                    placeholder="补充说明…"
                    fullWidth
                    data-testid="new-task-notes"
                  />
                </Field>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="ghost"
                  type="button"
                  onPress={onClose}
                  data-testid="new-task-close"
                >
                  关闭
                </Button>
                <Button variant="primary" type="submit" data-testid="new-task-save">
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
