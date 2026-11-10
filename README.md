# Pipeline Hygiene

Sales ops tooling for Salesforce exports: pipeline hygiene scoring, close-date slippage and forecast accuracy tracking, and duplicate Account / Contact / Lead detection with a safe merge plan. Built for the RevOps or Sales Ops manager who has to defend the forecast and clean the CRM.

Live: https://pipeline-hygiene-ten.vercel.app

## The pain

Forecast accuracy is rarely measured per rep, close dates go stale by Friday, and merging duplicates in a live org is risky (three records per merge, no undo). Most of it is a data integrity problem hiding in exports you already have.

## Features

- Import Salesforce report exports (CSV or XLSX, formatted or details-only), Data Loader SOQL extracts, or a HubSpot deals export. Format detection, column mapping, validation with line numbers.
- Hygiene rules per deal (past-due close, no activity, missing next step, stage age over benchmark, zero amount, single-threaded, repeated pushes, skipped or backwards stages), rolled up per owner and team, with editable weights.
- Weekly snapshots rebuilt from field history: the quarter's commit waterfall, push counts, days pushed, amount drift.
- Forecast accuracy: the week-N commit vs closed-won, MAPE and bias per rep, sandbagger and over-forecaster labels.
- Stage conversion and velocity, plus a "realistic close" estimate from each owner's historical push pattern.
- Duplicate detection: normalised names, domain, phone and address matching, Jaro-Winkler and trigram similarity, blocking, clusters with confidence, master-record rules and a survivorship preview.
- Actions: per-rep to-do emails, a Data Loader update CSV for approved close dates, a merge plan CSV that respects the 3-record limit, and a printable weekly forecast-call pack.
- Workspace of orgs in IndexedDB with dated snapshots and a compare view. Optional email/password accounts sync across devices.
- Two synthetic sample orgs (clearly labelled).

## Run locally

```
npm install
cp .env.example .env   # optional, enables sync
npm run dev
npm test
```

Built by Aryan Kansagara. Independent project, not affiliated with Salesforce.
