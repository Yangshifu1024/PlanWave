//! 应用更新的纯函数（版本比较、提示判定）：零依赖，可直接单测。
//! 编排逻辑见 `lib/updater.ts`。

const SKIP_KEY = "planwave.update.skipped_version";

/** 语义化版本比较（忽略前导 v 与 pre-release 后缀）：candidate 更新返回 true。 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split("-")[0]!
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const [cMajor = 0, cMinor = 0, cPatch = 0] = parse(candidate);
  const [uMajor = 0, uMinor = 0, uPatch = 0] = parse(current);
  if (cMajor !== uMajor) return cMajor > uMajor;
  if (cMinor !== uMinor) return cMinor > uMinor;
  return cPatch > uPatch;
}

/** 是否向用户提示该版本：被「跳过此版本」拦下的不再提示（手动检查无视跳过）。 */
export function shouldPromptUpdate(version: string): boolean {
  const skipped = localStorage.getItem(SKIP_KEY);
  return !skipped || isNewerVersion(version, skipped);
}

/** Web 端：服务器部署的版本（web 镜像与 server 同 tag 构建）新于页面构建版本。 */
export function isWebStale(appVersion: string, serverVersion: string): boolean {
  return isNewerVersion(serverVersion, appVersion);
}
