import { isoToHbDate, parseHomeBankXml } from "../src/lib/homebank";

export const sampleXml = `<?xml version="1.0"?>
<homebank v="1.6" d="51003">
  <properties title="Test" curr="1"/>
  <cur key="1" iso="EUR" frac="2" rate="1"/>
  <account key="1" name="Banque" type="1" curr="1" initial="100" minimum="-50"/>
  <account key="2" name="Epargne" type="7" curr="1" initial="200"/>
  <account key="3" name="Ferme" flags="2" type="1" curr="1" initial="999"/>
  <pay key="1" name="Tiers existant"/>
  <cat key="1" name="Maison"/>
  <cat key="2" parent="1" name="Courses"/>
  <tag key="1" name="test"/>
  <fav key="1" date="739890" wording="Modele" custom="preserve"/>
  <asg key="1" name="Regle"/>
  <flt key="1" name="Filtre"/>
  <ope date="739890" account="1" amount="-20" st="2" payee="1" category="2" wording="Courses" info="123" tags="test"/>
  <ope date="739891" account="1" amount="-10" st="1"/>
  <ope date="739920" account="1" amount="-5" st="0"/>
  <ope date="739891" account="1" amount="1000" st="3"/>
  <ope date="739891" account="2" amount="40" st="2"/>
</homebank>`;

export const sampleWallet = () => parseHomeBankXml(sampleXml, "test.xhb");

export const scheduledXml = sampleXml.replace("</homebank>", `
  <fav key="10" account="1" amount="2000" recflg="1" nextdate="${739891}" every="1" unit="2" wording="Salaire mensuel" info="SAL-42" custom="preserve"/>
  <fav key="11" account="1" amount="-600" recflg="1" nextdate="739894" every="1" unit="2" wording="Loyer" category="1"/>
  <fav key="12" account="1" amount="-60" recflg="1" nextdate="739899" every="1" unit="2" weekend="1" wording="Electricite"/>
  <fav key="13" account="1" amount="-10" recflg="3" limit="3" nextdate="739892" every="1" unit="1" wording="Abonnement hebdomadaire"/>
  <fav key="14" account="1" dst_account="2" flags="8" amount="-100" recflg="1" nextdate="739897" every="1" unit="2" wording="Epargne automatique"/>
  <fav key="15" account="2" amount="5" recflg="1" nextdate="739904" every="1" unit="2" wording="Interets epargne"/>
  <fav key="16" account="1" amount="-20" recflg="1" nextdate="739884" every="1" unit="2" wording="Assurance en retard"/>
  <fav key="17" account="3" amount="-999" recflg="1" nextdate="739890" every="1" unit="2" wording="Operation compte ferme"/>
  <fav key="18" account="1" amount="-999" recflg="0" nextdate="739890" every="1" unit="2" wording="Modele sans recurrence"/>
  <fav key="19" account="1" amount="-25" recflg="5" nextdate="739919" every="1" unit="2" ordn="5" wkdy="5" wording="Dernier vendredi"/>
</homebank>`);

export const nextMonthScheduledXml = sampleXml.replace("</homebank>", `
  <fav key="20" account="1" dst_account="2" flags="8" amount="-7.27" recflg="1" nextdate="${isoToHbDate("2026-11-04")}" every="1" unit="2" wording="Virement assurance pret"/>
  <fav key="21" account="1" dst_account="2" flags="8" amount="-12.28" recflg="1" nextdate="${isoToHbDate("2026-11-04")}" every="1" unit="2" wording="Virement assurance habitation"/>
  <fav key="22" account="1" amount="-70" recflg="1" nextdate="${isoToHbDate("2026-11-09")}" every="1" unit="2" wording="Energie"/>
  <fav key="23" account="1" amount="-20.99" recflg="1" nextdate="${isoToHbDate("2026-11-16")}" every="1" unit="2" wording="Telephone"/>
  <fav key="24" account="1" amount="-39" recflg="1" nextdate="${isoToHbDate("2026-11-16")}" every="1" unit="2" wording="Impots"/>
</homebank>`);
