import { describe, expect, it } from "vitest";
import { balancesByAccount, isoToHbDate, parseHomeBankXml } from "../src/lib/homebank";
import { manualForecastKey, salaryForecastBalances } from "../src/lib/salaryForecast";

const today = isoToHbDate("2026-11-11"), payday = today + 20;
const salary = (extra = "") => `<fav key="1" account="1" amount="2000" recflg="1" unit="2" nextdate="${payday}" wording="Salaire" ${extra}/>`;
const expense = (date = today + 2, extra = "") => `<fav key="2" account="1" amount="-100" recflg="1" unit="2" nextdate="${date}" ${extra}/>`;
const posted = (date: number, amount: number, extra = "") => `<ope account="1" date="${date}" amount="${amount}" ${extra}/>`;
const wallet = (content = "") => parseHomeBankXml(`<homebank v="1.6"><properties curr="1"/><cur key="1" iso="EUR" frac="2"/><cur key="2" iso="USD" frac="2"/>
  <account key="1" name="Courant fictif" curr="1" initial="1000"/><account key="2" name="Livret fictif" type="7" curr="1" initial="100"/>
  <account key="3" name="Clos fictif" flags="2" curr="1"/>
  <cat key="1" name="Revenus"/><cat key="2" parent="1" name="Salaires"/>${content}</homebank>`, "fictif.xhb");

describe("future balance before recurring salary", () => {
  it("includes posted and planned charges strictly before salary, excludes salary day and later writes", () => {
    const w = wallet(salary() + expense() + posted(today - 1, -10, 'st="2"') + posted(today + 1, -50, 'st="1"') + posted(payday, 2000)
      + posted(payday, -200) + posted(payday + 1, -300) + posted(today + 1, 9999, 'st="3"'));
    const result = salaryForecastBalances(w, today).get(1)!;
    expect(result.future).toBe(840);
    expect(result.reconciled).toBe(990); expect(result.cleared).toBe(940);
    expect(result.forecast).toMatchObject({ until: payday, estimated: false, available: true, kind: "salary" });
  });
  it("recognizes a hierarchical salary category even when the memo only names an employer", () => {
    const w = wallet(salary('category="2"').replace('wording="Salaire"', 'wording="Employeur fictif"') + expense());
    expect(salaryForecastBalances(w, today).get(1)!.future).toBe(900);
  });
  it("uses a dominant substantial regular income only as an explicitly estimated boundary", () => {
    const w = wallet(salary().replace('wording="Salaire"', 'wording="Employeur fictif"') + expense()
      + `<fav account="1" amount="20" recflg="1" unit="2" nextdate="${today + 1}"/>`);
    expect(salaryForecastBalances(w, today).get(1)).toMatchObject({ future: 920, forecast: { estimated: true, until: payday } });
  });
  it("does not mistake small or ambiguous recurring credits for a substantial income", () => {
    const small = wallet(salary().replace('wording="Salaire"', 'wording="Cashback"').replace('amount="2000"', 'amount="5"') + expense());
    expect(salaryForecastBalances(small, today).get(1)!.forecast).toBeUndefined();
    const ambiguous = wallet(salary().replace('wording="Salaire"', 'wording="Revenu A"') + salary().replace('wording="Salaire"', 'wording="Revenu B"') + expense());
    expect(salaryForecastBalances(ambiguous, today).get(1)!.forecast).toBeUndefined();
  });
  it("keeps non-salary recurring incomes before the next salary", () => {
    const w = wallet(salary() + expense() + `<fav account="1" amount="50" recflg="3" limit="1" unit="2" nextdate="${today + 1}" wording="Remboursement"/>`);
    expect(salaryForecastBalances(w, today).get(1)!.future).toBe(950);
  });
  it("chooses the earliest of multiple named salaries", () => {
    const w = wallet(salary() + salary().replace(`nextdate="${payday}"`, `nextdate="${today + 10}"`) + expense());
    expect(salaryForecastBalances(w, today).get(1)!.forecast!.until).toBe(today + 10);
  });
  it("honors the adjusted weekend date as the exclusive boundary", () => {
    const saturday = isoToHbDate("2026-11-28");
    const w = wallet(salary('weekend="1"').replace(`nextdate="${payday}"`, `nextdate="${saturday}"`) + expense(saturday - 1));
    expect(salaryForecastBalances(w, today).get(1)).toMatchObject({ future: 1000, forecast: { until: saturday - 1 } });
  });
  it("includes today, not overdue charges, and reports the omitted overdue occurrences", () => {
    const w = wallet(salary() + expense(today) + expense(today - 3));
    expect(salaryForecastBalances(w, today).get(1)).toMatchObject({ future: 900, forecast: { overdue: 1 } });
  });
  it("handles salary due today and a final remaining salary without counting it", () => {
    const w = wallet(salary().replace('recflg="1"', 'recflg="3" limit="1"').replace(`nextdate="${payday}"`, `nextdate="${today}"`) + posted(today, -500));
    expect(salaryForecastBalances(w, today).get(1)).toMatchObject({ future: 1000, forecast: { until: today } });
  });
  it("uses HomeBank nextdate instead of guessing duplicate transactions", () => {
    const w = wallet(salary() + expense(today + 2) + posted(today + 2, -100));
    expect(salaryForecastBalances(w, today).get(1)!.future).toBe(800);
    w.templates[1].attributes.nextdate = String(payday + 2);
    expect(salaryForecastBalances(w, today).get(1)!.future).toBe(900);
  });
  it("stops before a salary posted in advance even when HomeBank has advanced nextdate", () => {
    const w = wallet(salary().replace(`nextdate="${payday}"`, `nextdate="${payday + 31}"`)
      + posted(payday, 2000, 'wording="Salaire"') + expense() + posted(payday + 1, -300));
    expect(salaryForecastBalances(w, today).get(1)).toMatchObject({ future: 900, forecast: { until: payday } });
  });
  it("does not exclude a salary already credited today from the current budget", () => {
    const w = wallet(salary() + posted(today, 2000, 'wording="Salaire"') + expense());
    expect(salaryForecastBalances(w, today).get(1)).toMatchObject({ future: 2900, forecast: { until: payday } });
  });
  it("detects an explicitly named future salary after its template's last occurrence was posted", () => {
    const w = wallet(salary().replace('recflg="1"', 'recflg="3" limit="0"') + posted(payday, 2100, 'category="2"') + expense());
    expect(salaryForecastBalances(w, today).get(1)).toMatchObject({ future: 900, forecast: { until: payday, estimated: false } });
  });
  it("matches an anticipated variable salary by its recurring payer and category, not its amount", () => {
    const w = wallet(salary('payee="1"').replace('wording="Salaire"', 'wording="Employeur fictif"').replace(`nextdate="${payday}"`, `nextdate="${payday + 31}"`)
      + `<pay key="1" name="Employeur fictif"/>` + posted(payday, 2150, 'payee="1"') + expense());
    expect(salaryForecastBalances(w, today).get(1)).toMatchObject({ future: 900, forecast: { until: payday, estimated: true } });
  });
  it("ignores cancelled salary credits and internal transfers labelled salary", () => {
    const w = wallet(posted(payday, 2000, 'wording="Salaire" st="3"') + posted(payday, 2000, 'wording="Salaire" paymode="5"') + expense());
    expect(salaryForecastBalances(w, today).get(1)!.forecast).toBeUndefined();
  });
  it("does not ignore large slower recurring incomes when testing dominance", () => {
    const w = wallet(salary().replace('wording="Salaire"', 'wording="Revenu mensuel"') + expense()
      + `<fav account="1" amount="36000" unit="3" recflg="1" nextdate="${today + 300}"/>`);
    expect(salaryForecastBalances(w, today).get(1)!.forecast).toBeUndefined();
  });
  it("applies recurring transfers once per leg, never classifies legacy transfers as salary", () => {
    const w = wallet(salary() + expense(today + 1, 'dst_account="2" flags="8"')
      + `<fav account="2" dst_account="1" amount="-20" recflg="3" limit="1" unit="2" nextdate="${today + 1}" flags="8"/>`);
    expect(salaryForecastBalances(w, today).get(1)!.future).toBe(920);
    const legacy = wallet(salary('paymode="5"') + expense());
    expect(salaryForecastBalances(legacy, today).get(1)!.forecast).toBeUndefined();
  });
  it("marks incomplete projections unavailable rather than presenting the book balance as a budget", () => {
    const w = wallet(salary() + expense(today + 1, 'every="0"'));
    expect(salaryForecastBalances(w, today).get(1)!.forecast).toMatchObject({ available: false });
  });
  it("adds decimal amounts exactly and preserves negative balances and source data", () => {
    const w = wallet(salary() + expense().replace('amount="-100"', 'amount="-0.1"') + posted(today, -1000.2));
    const before = JSON.stringify(w);
    expect(salaryForecastBalances(w, today).get(1)!.future).toBe(-0.3);
    expect(JSON.stringify(w)).toBe(before);
  });
  it("does not silently lose cents when converting an exact total to the existing numeric UI model", () => {
    const w = wallet(salary() + posted(today, 9007199254740992) + expense().replace('amount="-100"', 'amount="-0.01"'));
    expect(salaryForecastBalances(w, today).get(1)!.forecast!.available).toBe(false);
  });
});

describe("manual future horizon", () => {
  it("is opt-in, includes chosen day's posted and recurring entries, excludes later entries", () => {
    const w = wallet(expense(today + 5) + posted(today + 5, -50) + posted(today + 6, -90));
    expect(salaryForecastBalances(w, today).get(1)!.future).toBe(860);
    const key = manualForecastKey(w, w.accounts[0]);
    const result = salaryForecastBalances(w, today, { [key]: { enabled: true, until: today + 5 } });
    expect(result.get(1)).toMatchObject({ future: 850, forecast: { kind: "manual", until: today + 5 } });
    expect(salaryForecastBalances(w, today, { [key]: { enabled: false, until: today + 5 } }).get(1)!.forecast).toBeUndefined();
  });
  it("cannot override an automatically detected salary", () => {
    const w = wallet(salary() + expense()); const key = manualForecastKey(w, w.accounts[0]);
    expect(salaryForecastBalances(w, today, { [key]: { enabled: true, until: today + 100 } }).get(1)!.forecast!.kind).toBe("salary");
  });
  it("rejects expired dates, isolates wallets/accounts and leaves closed accounts unchanged", () => {
    const w = wallet(expense()); const key = manualForecastKey(w, w.accounts[0]);
    expect(salaryForecastBalances(w, today, { [key]: { enabled: true, until: today - 1 } }).get(1)!.forecast!.available).toBe(false);
    const other = { ...w, sourceFileName: "autre.xhb" };
    expect(salaryForecastBalances(other, today, { [key]: { enabled: true, until: today + 5 } }).get(1)!.forecast).toBeUndefined();
    expect(salaryForecastBalances(w, today).get(3)).toEqual(balancesByAccount(w).get(3));
  });
});
