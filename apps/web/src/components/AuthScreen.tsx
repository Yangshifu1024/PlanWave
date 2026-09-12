import { useEffect, useState, type FormEvent } from "react";
import { Button, Input } from "@heroui/react";
import { actions, useApp } from "../state/store";
import { Logo } from "../App";

/** 登录 / 首次初始化（单账号注册）界面。 */
export function AuthScreen() {
  const hasAccount = useApp((s) => s.hasAccount);
  const authError = useApp((s) => s.authError);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.getElementById("auth-username")?.focus();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (hasAccount) await actions.login(username, password);
      else await actions.register(username, password);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center px-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
      >
        <div className="flex flex-col items-center gap-2">
          <Logo className="size-10 text-blue-500" />
          <h1 className="text-lg font-semibold">PlanWave</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {hasAccount ? "登录以同步你的任务" : "首次使用：创建唯一账号（单用户设计）"}
          </p>
        </div>

        <div className="space-y-3">
          <Input
            data-testid="auth-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名"
            autoComplete="username"
            fullWidth
          />
          <Input
            data-testid="auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码（至少 8 位）"
            autoComplete={hasAccount ? "current-password" : "new-password"}
            fullWidth
          />
        </div>

        {authError && (
          <p className="text-sm text-red-500" data-testid="auth-error">
            {authError}
          </p>
        )}

        <Button
          type="submit"
          isDisabled={busy || !username || password.length < 8}
          data-testid="auth-submit"
          fullWidth
        >
          {busy ? "请稍候…" : hasAccount ? "登录" : "创建账号并开始"}
        </Button>
      </form>
    </div>
  );
}
