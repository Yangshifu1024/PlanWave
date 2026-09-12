import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Input } from "@heroui/react";
import { actions, useApp } from "../state/store";
import { DEFAULT_API_BASE, getStoredApiBase } from "../lib/platform";
import { Logo } from "../App";

type ServerCheck =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; version: string }
  | { state: "error"; message: string };

function normalizeBase(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

/** 探测地址是否指向 PlanWave 服务端：/about 必须带 planwave-server 键。 */
async function probeServer(base: string): Promise<ServerCheck> {
  try {
    const resp = await fetch(`${base}/about`, { cache: "no-store" });
    if (!resp.ok) {
      return { state: "error", message: `服务器响应异常（HTTP ${resp.status}）` };
    }
    const body = (await resp.json()) as Record<string, unknown>;
    const version = body["planwave-server"];
    if (typeof version !== "string") {
      return { state: "error", message: "该地址不是 PlanWave 服务器" };
    }
    return { state: "ok", version };
  } catch {
    return { state: "error", message: "无法连接服务器，请检查地址与网络" };
  }
}

/** 登录 / 首次初始化（单账号注册）界面。 */
export function AuthScreen() {
  const hasAccount = useApp((s) => s.hasAccount);
  const authError = useApp((s) => s.authError);
  // 服务器地址在第一位：探测通过前凭据输入保持锁定
  const [server, setServer] = useState(
    () => getStoredApiBase() ?? DEFAULT_API_BASE,
  );
  const [serverCheck, setServerCheck] = useState<ServerCheck>({ state: "checking" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const probeIdRef = useRef(0);

  const base = normalizeBase(server);
  const baseValid = /^https?:\/\//i.test(base);
  const serverReady = serverCheck.state === "ok";

  // 地址变化防抖后自动探测（500ms）：通过后解锁凭据输入并显示服务器版本
  useEffect(() => {
    if (!baseValid) {
      setServerCheck({ state: "error", message: "地址需以 http:// 或 https:// 开头" });
      return;
    }
    const id = ++probeIdRef.current;
    setServerCheck({ state: "checking" });
    const timer = setTimeout(async () => {
      const result = await probeServer(base);
      if (probeIdRef.current === id) setServerCheck(result);
    }, 500);
    return () => clearTimeout(timer);
  }, [server, baseValid]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !serverReady || !username || password.length < 8) return;
    setBusy(true);
    try {
      if (hasAccount) await actions.login(username, password, base);
      else await actions.register(username, password, base);
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
            data-testid="auth-server"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="服务器地址（自托管实例）"
            autoComplete="url"
            className="text-xs"
            fullWidth
          />
          {serverCheck.state === "checking" && (
            <p className="text-xs text-zinc-400" data-testid="server-check">
              正在连接服务器…
            </p>
          )}
          {serverCheck.state === "ok" && (
            <p className="text-xs text-green-600 dark:text-green-400" data-testid="server-check">
              服务器版本：{serverCheck.version}
            </p>
          )}
          {serverCheck.state === "error" && (
            <p className="text-xs text-red-500" data-testid="server-check">
              {serverCheck.message}
            </p>
          )}
          <Input
            data-testid="auth-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名"
            autoComplete="username"
            disabled={!serverReady}
            fullWidth
          />
          <Input
            data-testid="auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码（至少 8 位）"
            autoComplete={hasAccount ? "current-password" : "new-password"}
            disabled={!serverReady}
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
          isDisabled={busy || !serverReady || !username || password.length < 8}
          data-testid="auth-submit"
          fullWidth
        >
          {busy ? "请稍候…" : hasAccount ? "登录" : "创建账号并开始"}
        </Button>
      </form>
    </div>
  );
}
