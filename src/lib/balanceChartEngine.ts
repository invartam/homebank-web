import { init, use, type EChartsCoreOption } from "echarts/core";
import { LineChart, type LineSeriesOption } from "echarts/charts";
import { AriaComponent, DataZoomComponent, GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { formatHbDateFr } from "./homebank";
import { historyTimestamp, type BalanceChartData, type BalanceHistory, type HistoryRange } from "./balanceHistory";

use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent, AriaComponent, CanvasRenderer]);
export { init };


interface ChartAppearance { dark: boolean; text: string; muted: string; grid: string; surface: string; primary: string; danger: string; font: string; fractionDigits: number }
export function balanceChartOptions(history: BalanceHistory, data: BalanceChartData, range: HistoryRange, appearance: ChartAppearance,
  money: (amount: number) => string, overdraft?: number): EChartsCoreOption {
  const timestamps = data.dates.map(historyTimestamp);
  const axisMoney = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: Math.max(2, appearance.fractionDigits) });
  const axisBounds = ({ min, max }: { min: number; max: number }) => {
    const low = Math.min(min, 0, overdraft ?? 0), high = Math.max(max, 0);
    const padding = Math.max((high - low) * 0.08, 10 ** -appearance.fractionDigits);
    return { min: low - padding, max: high + padding };
  };
  // Two connected segments of one balance curve distinguish actuals from forecasts.
  const series: LineSeriesOption[] = [false, true].map((forecast) => ({
    id: forecast ? "forecast" : "balance", name: forecast ? "Solde previsionnel" : "Solde", type: "line",
    data: timestamps.map((date, index) => [date, data.balances[index]])
      .filter(([date]) => forecast ? date >= historyTimestamp(history.today) : date <= historyTimestamp(history.today)),
    step: "end", showSymbol: false, lineStyle: { color: appearance.primary, width: 2.5, type: forecast ? "dashed" as const : "solid" as const }, itemStyle: { color: appearance.primary }, z: 10,
    areaStyle: { color: appearance.primary, opacity: forecast ? (appearance.dark ? 0.12 : 0.09) : (appearance.dark ? 0.22 : 0.18), origin: 0 },
    ...((forecast ? range.start > history.today : range.start <= history.today) ? {
      markLine: { silent: true, symbol: "none", z: 20, label: { formatter: "Aujourd'hui", color: appearance.muted, position: "insideEndTop" as const },
        lineStyle: { color: appearance.muted, width: 1, type: "dotted" as const }, data: [
          { xAxis: historyTimestamp(history.today) },
          ...(overdraft === undefined ? [] : [{ name: "Decouvert autorise", yAxis: overdraft,
            lineStyle: { color: appearance.danger, width: 1.5, type: "dashed" as const },
            label: { formatter: "Decouvert autorise", color: appearance.danger, position: "insideStartTop" as const,
              backgroundColor: appearance.surface, padding: [2, 4], fontSize: 10 },
          }]),
        ] },
    } : {}),
  }));
  return {
    animation: false, useUTC: true, backgroundColor: appearance.surface,
    textStyle: { fontFamily: appearance.font, fontSize: 11, color: appearance.text },
    aria: { enabled: true, label: { description: `Evolution du solde du ${formatHbDateFr(range.start)} au ${formatHbDateFr(range.end)}. Solde final ${money(data.closing)}.` } },
    grid: { left: 14, right: 18, top: 24, bottom: 100, containLabel: true },
    xAxis: { type: "time", min: historyTimestamp(history.domain.start), max: historyTimestamp(history.domain.end),
      minInterval: 86400000, splitNumber: 5, axisLine: { lineStyle: { color: appearance.grid } }, axisTick: { show: false },
      axisLabel: { color: appearance.muted, hideOverlap: true, formatter: (value: number) => formatHbDateFr(Math.floor(value / 86400000) + 719163,
        range.end - range.start > 730 ? { day: undefined, month: "short", year: "numeric" } : { year: undefined }) },
      splitLine: { show: true, lineStyle: { color: appearance.grid, opacity: 0.45 } } },
    yAxis: { type: "value", scale: true, min: (extent: { min: number; max: number }) => axisBounds(extent).min, max: (extent: { min: number; max: number }) => axisBounds(extent).max,
      splitNumber: 5, axisLabel: { color: appearance.muted, width: 88, overflow: "truncate",
      formatter: (value: number) => axisMoney.format(value) },
      splitLine: { lineStyle: { color: appearance.grid, opacity: 0.65 } } },
    tooltip: { trigger: "axis", renderMode: "richText", confine: true, backgroundColor: appearance.surface, borderColor: appearance.grid,
      textStyle: { color: appearance.text, fontSize: 12 }, axisPointer: { type: "cross", lineStyle: { color: appearance.muted }, label: { show: false } },
      formatter: (params: unknown) => {
        const rows = (Array.isArray(params) ? params : []).filter((item) => Array.isArray(item?.data) && typeof item.data[1] === "number");
        if (!rows.length) return "";
        const date = Math.floor(Number(rows[0].data[0]) / 86400000) + 719163;
        return `${formatHbDateFr(date)}\n${date > history.today ? "Solde previsionnel" : "Solde"} : ${money(Number(rows[0].data[1]))}`;
      } },
    dataZoom: [
      { type: "inside", xAxisIndex: 0, startValue: historyTimestamp(range.start), endValue: historyTimestamp(range.end),
        minValueSpan: 86400000, filterMode: "filter", throttle: 90, zoomOnMouseWheel: "ctrl", moveOnMouseWheel: false, moveOnMouseMove: true, preventDefaultMouseMove: false },
      { type: "slider", xAxisIndex: 0, startValue: historyTimestamp(range.start), endValue: historyTimestamp(range.end),
        minValueSpan: 86400000, filterMode: "filter", throttle: 90, height: 28, bottom: 24, left: 62, right: 22,
        borderColor: appearance.grid, backgroundColor: appearance.surface, fillerColor: appearance.dark ? "#5794f230" : "#296ec425",
        dataBackground: { lineStyle: { color: appearance.muted }, areaStyle: { color: appearance.muted, opacity: 0.1 } },
        handleStyle: { color: appearance.primary, borderColor: appearance.surface }, textStyle: { color: appearance.muted },
        labelFormatter: (value: number) => formatHbDateFr(Math.round(value / 86400000) + 719163) },
    ], series,
  };
}
