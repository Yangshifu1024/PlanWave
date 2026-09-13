//! 重复任务的到期滚动（纯函数，便于单测）。
//!
//! 语义：完成带重复规则的任务时，从「上次到期日（或完成时刻，取较晚者）」
//! 起算下一次到期，保持本地时刻（时分秒）不变；月/年在缺日（如 1/31 → 2 月）
//! 时向月末收敛。weekly 可指定多个星期几，间隔按「周锚点」计算。

import type { RecurrenceRule } from "../types";

const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 本地时区「加 N 天」，时刻分量保持不变（避免 DST 用毫秒累加漂移）。 */
function addDaysLocal(d: Date, n: number): Date {
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + n,
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** 本地时区「加 N 个月」，日期超出月末时收敛到月末。 */
function addMonthsLocal(d: Date, n: number): Date {
  const year = d.getFullYear();
  const month = d.getMonth() + n;
  const day = Math.min(d.getDate(), daysInMonth(year, month));
  return new Date(year, month, day, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

function sameLocalTime(d: Date, keep: Date): Date {
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    keep.getHours(),
    keep.getMinutes(),
    keep.getSeconds(),
    keep.getMilliseconds(),
  );
}

/** 与基准日的周日对齐的「周锚点」间隔数（每隔 interval 周才生效）。 */
function weekDiff(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate() - from.getDay());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate() - to.getDay());
  return Math.round((b.getTime() - a.getTime()) / (7 * 86_400_000));
}

/**
 * 计算下一次到期（UTC 毫秒）。
 * @param fromMs 基准时间（通常为已完成的任务的到期日；无到期日用完成时刻）
 * @param nowMs 当前时刻：结果严格晚于该值（过期任务从现在往后滚）
 */
export function nextOccurrenceMs(rule: RecurrenceRule, fromMs: number, nowMs: number): number {
  const interval = Math.max(1, Math.floor(rule.interval) || 1);
  const base = new Date(fromMs);
  // 候选必须严格晚于 now（保持基准时刻的时分秒）
  const keep = base;
  let candidate: Date;

  switch (rule.freq) {
    case "daily": {
      candidate = addDaysLocal(base, interval);
      let guard = 0;
      while (candidate.getTime() <= nowMs && guard++ < 10_000) {
        candidate = addDaysLocal(candidate, interval);
      }
      break;
    }
    case "weekly": {
      const weekdays = rule.weekdays?.length ? rule.weekdays : [base.getDay()];
      // 逐日扫描（上限 7*interval+7 天）：命中星期几且落在间隔周上即生效
      const maxScan = 7 * interval + 7;
      candidate = addDaysLocal(base, 1);
      let guard = 0;
      while (guard++ < maxScan * 4) {
        const dayOk = weekdays.includes(candidate.getDay());
        const weekOk = weekDiff(base, candidate) % interval === 0;
        if (dayOk && weekOk) {
          const withTime = sameLocalTime(candidate, keep);
          if (withTime.getTime() > nowMs) {
            candidate = withTime;
            break;
          }
        }
        candidate = addDaysLocal(candidate, 1);
      }
      break;
    }
    case "monthly": {
      candidate = addMonthsLocal(base, interval);
      let guard = 0;
      while (candidate.getTime() <= nowMs && guard++ < 10_000) {
        candidate = addMonthsLocal(candidate, interval);
      }
      break;
    }
    case "yearly": {
      candidate = addMonthsLocal(base, 12 * interval);
      let guard = 0;
      while (candidate.getTime() <= nowMs && guard++ < 10_000) {
        candidate = addMonthsLocal(candidate, 12 * interval);
      }
      break;
    }
  }
  return candidate.getTime();
}

/** 规则的中文摘要（列表/详情展示用）。 */
export function recurrenceLabel(rule: RecurrenceRule): string {
  const interval = Math.max(1, Math.floor(rule.interval) || 1);
  const unit = { daily: "天", weekly: "周", monthly: "月", yearly: "年" }[rule.freq];
  const weekdays = rule.weekdays ?? [];
  if (rule.freq === "weekly" && weekdays.length > 0) {
    const days = weekdays.map((d) => WEEKDAY_NAMES[d] ?? "").join("、");
    return interval === 1 ? `每${days}` : `每 ${interval} 周的${days}`;
  }
  if (interval === 1) return `每${unit}`;
  return `每 ${interval} ${unit}`;
}
