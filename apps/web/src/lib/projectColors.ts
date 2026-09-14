//! 项目色点：Tailwind 静态类名映射（动态拼接的类名不会被打包器保留）。

export const PROJECT_DOT_COLORS: Record<string, string> = {
  blue: "bg-blue-400",
  red: "bg-red-400",
  orange: "bg-orange-400",
  green: "bg-green-400",
  purple: "bg-purple-400",
  gray: "bg-gray-400",
};

export function projectDotClass(color: string): string {
  return PROJECT_DOT_COLORS[color] ?? PROJECT_DOT_COLORS.gray ?? "bg-gray-400";
}
