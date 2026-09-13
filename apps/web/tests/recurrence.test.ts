//! 重复任务到期滚动测试（本地时区相关，用例均用本地 Date 构造）。

import { describe, expect, it } from "vitest";
import { nextOccurrenceMs, recurrenceLabel } from "../src/lib/recurrence";

/** 2026-09-14 是周一。 */
const MON = new Date(2026, 8, 14, 10, 0).getTime();
const WED = new Date(2026, 8, 16, 10, 0).getTime();

function expectSameLocal(actual: number, y: number, m: number, d: number, h: number, min: number) {
  const dt = new Date(actual);
  expect([dt.getFullYear(), dt.getMonth(), dt.getDate(), dt.getHours(), dt.getMinutes()]).toEqual([
    y,
    m,
    d,
    h,
    min,
  ]);
}

describe("nextOccurrenceMs", () => {
  it("每天：滚动一天并保持时刻", () => {
    const next = nextOccurrenceMs({ freq: "daily", interval: 1 }, MON, MON);
    expectSameLocal(next, 2026, 8, 15, 10, 0);
  });

  it("每 N 天：跨过当前时刻继续滚", () => {
    const fri = new Date(2026, 8, 18, 9, 30).getTime();
    const now = new Date(2026, 8, 20, 12, 0).getTime(); // 已过期两天
    const next = nextOccurrenceMs({ freq: "daily", interval: 3 }, fri, now);
    // 9/18 + 3 天 = 9/21（仍早于 now 12:00? 9/21 9:30 < 9/20 12:00 不可能）→ 从 9/18 逐次 +3 天到 > 9/20 12:00
    expectSameLocal(next, 2026, 8, 21, 9, 30);
  });

  it("每周多选星期：周一完成后滚到周三", () => {
    const next = nextOccurrenceMs(
      { freq: "weekly", interval: 1, weekdays: [1, 3, 5] },
      MON,
      MON,
    );
    expect(next).toBe(WED);
  });

  it("每 2 周的周一：滚 14 天", () => {
    const next = nextOccurrenceMs({ freq: "weekly", interval: 2, weekdays: [1] }, MON, MON);
    expectSameLocal(next, 2026, 8, 28, 10, 0);
  });

  it("每周缺省星期：跟随基准日的星期", () => {
    const next = nextOccurrenceMs({ freq: "weekly", interval: 1 }, MON, MON);
    expectSameLocal(next, 2026, 8, 21, 10, 0);
  });

  it("每月：1/31 收敛到 2 月末", () => {
    const jan31 = new Date(2027, 0, 31, 8, 0).getTime();
    const next = nextOccurrenceMs({ freq: "monthly", interval: 1 }, jan31, jan31);
    expectSameLocal(next, 2027, 1, 28, 8, 0);
  });

  it("每年：闰日 2/29 收敛到次年 2/28", () => {
    const leap = new Date(2028, 1, 29, 9, 0).getTime();
    const next = nextOccurrenceMs({ freq: "yearly", interval: 1 }, leap, leap);
    expectSameLocal(next, 2029, 1, 28, 9, 0);
  });

  it("过期任务：下一次严格晚于现在", () => {
    const now = new Date(2026, 8, 20, 10, 0).getTime();
    const next = nextOccurrenceMs({ freq: "daily", interval: 1 }, MON, now);
    expect(next).toBeGreaterThan(now);
  });
});

describe("recurrenceLabel", () => {
  it("预设档摘要", () => {
    expect(recurrenceLabel({ freq: "daily", interval: 1 })).toBe("每天");
    expect(recurrenceLabel({ freq: "yearly", interval: 1 })).toBe("每年");
    expect(recurrenceLabel({ freq: "daily", interval: 3 })).toBe("每 3 天");
  });

  it("多选星期的周规则", () => {
    expect(recurrenceLabel({ freq: "weekly", interval: 1, weekdays: [1, 3] })).toBe("每周一、周三");
  });
});
