import { isTauri } from "../lib/platform";
import { useApp } from "../state/store";

/** Web 端更新横幅：服务器部署版本新于页面构建版本时提示刷新（桌面端跳过）。 */
export function WebUpdateBanner() {
  const webStale = useApp((s) => s.webStale);
  if (!webStale || isTauri) return null;
  return (
    <div
      className="z-40 flex shrink-0 items-center justify-center gap-3 bg-blue-500 px-4 py-1.5 text-sm text-white"
      data-testid="web-update-banner"
    >
      <span>服务端已更新，刷新页面以获取最新版本</span>
      <button
        className="cursor-pointer rounded-lg bg-white/20 px-2 py-0.5 hover:bg-white/30"
        onClick={() => location.reload()}
        data-testid="web-update-reload"
      >
        刷新
      </button>
    </div>
  );
}
