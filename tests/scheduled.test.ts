import { describe, expect, it } from "vitest";
import { isoToHbDate, parseHomeBankXml, serializeHomeBankXml, type Wallet } from "../src/lib/homebank";
import { forecastNet, projectScheduledOperations, readScheduledOperations, recurrenceLabel, scheduleRange, scheduledEntries, scheduledPostDate, summarizeScheduledEntries } from "../src/lib/scheduled";
import { sampleWallet } from "./fixtures";

const date = isoToHbDate;
function withSchedules(...items: Record<string, string | number>[]): Wallet {
  const wallet = sampleWallet();
  wallet.templates = items.map((item, index) => ({ name: "fav", attributes: Object.fromEntries(Object.entries({
    key: index + 1, account: 1, amount: -10, recflg: 1, nextdate: date("2026-10-01"), every: 1, unit: 2, ...item,
  }).map(([key, value]) => [key, String(value)])) }));
  return wallet;
}
function project(wallet: Wallet, start = "2026-10-01", end = "2026-12-31") {
  return projectScheduledOperations(wallet, readScheduledOperations(wallet).operations, date(start), date(end));
}

describe("read-only HomeBank scheduled operations", () => {
  it("distinguishes active schedules, ordinary templates, exhausted limits and closed accounts", () => {
    const wallet = withSchedules({}, { recflg: 0 }, { account: 3 }, { recflg: 3, limit: 0 }, { recflg: 3, limit: 1 });
    expect(readScheduledOperations(wallet).operations).toHaveLength(2);
    expect(recurrenceLabel(readScheduledOperations(wallet).operations[1])).toBe("Une seule echeance");
  });

  it("reads pre-5.9 recurrence flags without altering the original XML", () => {
    const wallet = withSchedules({ flags: 132, limit: 2 });
    delete wallet.templates[0].attributes.recflg;
    expect(readScheduledOperations(wallet).operations[0]).toMatchObject({ remaining: 2, type: "expense" });
    expect(project(wallet).entries).toHaveLength(2);
    expect(wallet.templates[0].attributes.flags).toBe("132");
  });

  it("projects daily, weekly, monthly and annual intervals inclusively", () => {
    expect(project(withSchedules({ unit: 0, every: 2 }), "2026-10-01", "2026-10-07").entries.map((entry) => entry.date)).toEqual([1, 3, 5, 7].map((day) => date(`2026-10-0${day}`)));
    expect(project(withSchedules({ unit: 1, every: 2 }), "2026-10-01", "2026-10-31").entries).toHaveLength(3);
    expect(project(withSchedules({ unit: 2 }), "2026-10-01", "2026-12-31").entries).toHaveLength(3);
    expect(project(withSchedules({ unit: 3 }), "2026-10-01", "2027-10-01").entries).toHaveLength(2);
  });

  it("restores the saved month-end gap exactly as HomeBank does", () => {
    const wallet = withSchedules({ nextdate: date("2026-01-31") });
    expect(project(wallet, "2026-01-01", "2026-05-31").entries.map((entry) => entry.date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"].map(date));
    const savedGap = withSchedules({ nextdate: date("2026-02-28"), gap: 3 });
    expect(project(savedGap, "2026-03-01", "2026-03-31").entries[0].date).toBe(date("2026-03-31"));
  });

  it("supports first, second and last relative weekdays and the last calendar day", () => {
    for (const [ordinal, weekday, expected] of [[1, 1, "2026-11-02"], [2, 5, "2026-11-13"], [5, 5, "2026-11-27"], [5, 8, "2026-11-30"]]) {
      const wallet = withSchedules({ nextdate: date("2026-10-01"), recflg: 5, ordn: ordinal, wkdy: weekday });
      expect(project(wallet, "2026-11-01", "2026-11-30").entries[0].date).toBe(date(expected));
    }
  });

  it("shifts weekend posting dates without changing the recurrence anchor", () => {
    expect(scheduledPostDate(date("2026-10-03"), 1)).toBe(date("2026-10-02"));
    expect(scheduledPostDate(date("2026-10-04"), 2)).toBe(date("2026-10-05"));
    const shifted = withSchedules({ nextdate: date("2026-10-03"), unit: 1, weekend: 1 });
    expect(project(shifted, "2026-10-01", "2026-10-16").entries.map((entry) => entry.date)).toEqual(["2026-10-02", "2026-10-09", "2026-10-16"].map(date));
    const skipped = withSchedules({ nextdate: date("2026-10-02"), unit: 0, weekend: 3 });
    expect(project(skipped, "2026-10-02", "2026-10-06").entries.map((entry) => entry.date)).toEqual(["2026-10-02", "2026-10-05", "2026-10-06"].map(date));
  });

  it("includes weekend-before posts on the end boundary and weekend-after posts on the start boundary", () => {
    expect(project(withSchedules({ nextdate: date("2026-11-01"), weekend: 1 }), "2026-10-01", "2026-10-30").entries).toHaveLength(1);
    expect(project(withSchedules({ nextdate: date("2026-10-31"), weekend: 2 }), "2026-11-02", "2026-11-02").entries).toHaveLength(1);
  });

  it("keeps distinct IDs when several daily occurrences shift to the same posting date", () => {
    const entries = project(withSchedules({ nextdate: date("2026-10-02"), unit: 0, weekend: 1 }), "2026-10-02", "2026-10-02").entries;
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(3);
  });

  it("bounds malformed historical projections and explicitly reports an incomplete forecast", () => {
    const result = project(withSchedules({ nextdate: date("0001-01-01"), unit: 0 }));
    expect(result.issues[0]).toContain("prevision incomplete");
    expect(result.entries).toHaveLength(0);
  });

  it("counts late occurrences separately and respects remaining counts including late ones", () => {
    const wallet = withSchedules({ nextdate: date("2026-09-01"), recflg: 3, limit: 2 });
    const result = project(wallet);
    expect(result.overdueCount).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].date).toBe(date("2026-10-01"));
    expect(readScheduledOperations(wallet).operations[0].remaining).toBe(2);
  });

  it("excludes internal transfers from income/expenses and balances their two account flows", () => {
    const wallet = withSchedules({ amount: 1000 }, { amount: -200 }, { flags: 8, amount: -100, dst_account: 2 });
    const entries = project(wallet, "2026-10-01", "2026-10-31").entries;
    const total = summarizeScheduledEntries(wallet, entries)[0];
    expect(total).toMatchObject({ income: 1000, expenses: 200, transferIn: 100, transferOut: 100 });
    expect(forecastNet(total)).toBe(800);
    const accounts = summarizeScheduledEntries(wallet, entries, true);
    expect(accounts.map(forecastNet)).toEqual([700, 100]);
  });

  it("uses explicit cross-currency transfer amounts and never mixes currencies", () => {
    const wallet = withSchedules({ flags: 24, amount: -100, damt: 120, dst_account: 2 });
    wallet.accounts[1].currencyKey = 2;
    wallet.currencies.push({ ...wallet.currencies[0], key: 2, iso: "USD" });
    const entries = project(wallet, "2026-10-01", "2026-10-31").entries;
    expect(entries.map((entry) => entry.amount)).toEqual([-100, 120]);
    expect(summarizeScheduledEntries(wallet, entries).map(forecastNet)).toEqual([-100, 120]);
    delete wallet.templates[0].attributes.damt;
    expect(project(wallet).issues).toHaveLength(1);
    expect(scheduledEntries(wallet, readScheduledOperations(wallet).operations[0])).toHaveLength(1);
  });

  it("does not expose closed destination accounts and warns about an incomplete transfer", () => {
    const wallet = withSchedules({ flags: 8, dst_account: 3 });
    const result = project(wallet);
    expect(result.entries.every((entry) => entry.accountKey === 1)).toBe(true);
    expect(result.issues).toHaveLength(1);
  });

  it("reports malformed schedules without preventing consultation of valid ones", () => {
    const wallet = withSchedules({}, { every: 0 }, { amount: "NaN" }, { nextdate: 0 }, { recflg: 5, ordn: 1, wkdy: 10 });
    expect(readScheduledOperations(wallet).operations).toHaveLength(1);
    expect(readScheduledOperations(wallet).issues).toHaveLength(4);
  });

  it("keeps all original template attributes, cursor, gap, limits and transactions untouched", () => {
    const wallet = withSchedules({ recflg: 3, limit: 2, custom: "unknown & preserved", info: "REF-42" }, { recflg: 0, wording: "Ordinary template" });
    const original = structuredClone(wallet);
    project(wallet);
    expect(wallet).toEqual(original);
    const restored = parseHomeBankXml(serializeHomeBankXml(wallet));
    expect(restored.templates).toEqual(original.templates);
    expect(restored.transactions).toHaveLength(original.transactions.length);
  });

  it("uses civil dates across a DST boundary and defines inclusive forecast periods", () => {
    const wallet = withSchedules({ unit: 0, nextdate: date("2026-10-24") });
    expect(project(wallet, "2026-10-24", "2026-10-27").entries.map((entry) => entry.date)).toEqual([24, 25, 26, 27].map((day) => date(`2026-10-${day}`)));
    expect(scheduleRange(date("2026-10-01"), "month")).toEqual({ start: date("2026-10-01"), end: date("2026-10-31") });
    expect(scheduleRange(date("2026-10-01"), "30").end).toBe(date("2026-10-30"));
    expect(scheduleRange(date("2026-10-01"), "90").end).toBe(date("2026-12-29"));
  });
});
