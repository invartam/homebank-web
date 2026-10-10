import { describe, expect, it } from "vitest";
import type { LineSeriesOption } from "echarts/charts";
import { balanceChartOptions } from "../src/lib/balanceChartEngine";
import { balanceChartData, buildBalanceHistory, historyAccounts, historyTimestamp } from "../src/lib/balanceHistory";
import { isoToHbDate, overdraftLimit } from "../src/lib/homebank";
import { sampleWallet } from "./fixtures";

const today = isoToHbDate("2026-10-10");
const appearance = { dark: false, text: "#111", muted: "#666", grid: "#ddd", surface: "#fff", primary: "#477eb8", danger: "#d32f2f", font: "Arial", fractionDigits: 2 };
const money = (amount: number) => `${amount.toFixed(2)} EUR`;

describe("balance curve rendering", () => {
  it("joins two unstacked segments at today's actual balance, with only the future dashed", () => {
    const wallet = sampleWallet(), history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today);
    const data = balanceChartData(history, history.domain);
    const option = balanceChartOptions(history, data, history.domain, appearance, money);
    const series = option.series as LineSeriesOption[];
    expect(series).toHaveLength(2);
    for (const segment of series) {
      expect(segment.type).toBe("line");
      expect(segment.stack).toBeUndefined();
      expect(segment.areaStyle).toMatchObject({ color: appearance.primary, origin: 0 });
      expect(segment.data).toContainEqual([historyTimestamp(today), 70]);
    }
    expect(series[0].lineStyle?.type).toBe("solid");
    expect(series[1].lineStyle?.type).toBe("dashed");
    expect(series[1].areaStyle!.opacity).toBeLessThan(series[0].areaStyle!.opacity!);
    expect(series[0].data).not.toContainEqual([historyTimestamp(history.domain.end), expect.anything()]);
    expect(series[1].data).toContainEqual([historyTimestamp(history.domain.end), 65]);
  });

  it.each([-50, 50, 0])("draws the account overdraft limit for minimum %s and keeps it in the axis", (minimum) => {
    const wallet = sampleWallet(); wallet.accounts[0].minimum = minimum;
    const history = buildBalanceHistory(wallet, historyAccounts(wallet, "account:1"), today);
    const data = balanceChartData(history, history.domain), limit = overdraftLimit(wallet.accounts[0]);
    const option = balanceChartOptions(history, data, history.domain, appearance, money, limit);
    const series = option.series as LineSeriesOption[];
    expect(series[0].markLine!.data).toContainEqual(expect.objectContaining({ yAxis: limit, lineStyle: { color: appearance.danger, width: 1.5, type: "dashed" } }));
    const yAxis = option.yAxis as { min: (extent: { min: number; max: number }) => number };
    expect(yAxis.min({ min: 100, max: 200 })).toBeLessThan(limit);
    expect(series).toHaveLength(2);
  });

  it("does not invent an overdraft threshold for a grouped view, even with one account", () => {
    const wallet = sampleWallet(), history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today);
    const data = balanceChartData(history, history.domain);
    const option = balanceChartOptions(history, data, history.domain, appearance, money);
    const series = option.series as LineSeriesOption[];
    expect(series[0].markLine!.data).toEqual([{ xAxis: historyTimestamp(today) }]);
  });

  it("keeps the threshold on the visible future segment when historical data is outside the window", () => {
    const wallet = sampleWallet(), history = buildBalanceHistory(wallet, historyAccounts(wallet, "account:1"), today);
    const range = { start: today + 1, end: today + 10 }, data = balanceChartData(history, range);
    const series = balanceChartOptions(history, data, range, appearance, money, -50).series as LineSeriesOption[];
    expect(series[0].markLine).toBeUndefined();
    expect(series[1].markLine!.data).toContainEqual(expect.objectContaining({ yAxis: -50 }));
  });

  it("shows a single future tooltip amount, ignoring the null historic segment", () => {
    const wallet = sampleWallet(), history = buildBalanceHistory(wallet, historyAccounts(wallet, "bank"), today);
    const data = balanceChartData(history, history.domain);
    const option = balanceChartOptions(history, data, history.domain, appearance, money);
    const tooltip = option.tooltip as { renderMode: string; formatter: (rows: unknown) => string };
    expect(tooltip.renderMode).toBe("richText");
    const date = historyTimestamp(history.domain.end);
    expect(tooltip.formatter([{ data: [date, null] }, { data: [date, 65] }])).toBe("10/10/2027\nSolde previsionnel : 65.00 EUR");
    expect(tooltip.formatter([{ data: [date, null] }])).toBe("");
  });
});
