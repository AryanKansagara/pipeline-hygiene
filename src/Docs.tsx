import { FIELDS, KIND_LABEL, type Kind } from './engine/csv.ts'
import { RULE_LABEL, RULES, defaultConfig } from './engine/types.ts'
import { Code, Link } from './ui.tsx'

const SOQL_OPPS = `SELECT Id, Name, Account.Name, Owner.Name, Owner.UserRole.Name, StageName, Amount,
       CloseDate, CreatedDate, LastActivityDate, NextStep, ForecastCategoryName, Probability
FROM Opportunity
WHERE IsClosed = false
   OR CloseDate = LAST_N_QUARTERS:6
   OR CloseDate = THIS_QUARTER`

const SOQL_HIST = `-- Option A: Opportunity History (always on, one row per stage/amount/date save)
SELECT Id, OpportunityId, CreatedDate, StageName, Amount, CloseDate, ForecastCategory
FROM OpportunityHistory
WHERE CreatedDate = LAST_N_DAYS:540

-- Option B: Field History (needs Field History Tracking on these fields)
SELECT OpportunityId, CreatedDate, Field, OldValue, NewValue
FROM OpportunityFieldHistory
WHERE Field IN ('StageName', 'Amount', 'CloseDate', 'ForecastCategoryName')`

const SOQL_ROLES = `SELECT OpportunityId, ContactId, Role, IsPrimary
FROM OpportunityContactRole
WHERE Opportunity.IsClosed = false`

const SOQL_DEDUPE = `SELECT Id, Name, Website, Phone, BillingStreet, BillingCity, BillingState,
       BillingPostalCode, BillingCountry, Industry, NumberOfEmployees, Owner.Name,
       CreatedDate, LastActivityDate
FROM Account

SELECT Id, FirstName, LastName, Account.Name, Email, Phone, Title, MailingStreet,
       MailingPostalCode, Owner.Name, CreatedDate, LastActivityDate
FROM Contact

SELECT Id, FirstName, LastName, Company, Email, Phone, Title, Status, LeadSource,
       Street, PostalCode, Owner.Name, CreatedDate, LastActivityDate
FROM Lead
WHERE IsConverted = false`

const UPDATE_EX = `Id,CloseDate,Name (reference only, do not map),Previous CloseDate (reference only)
0065g00000AbCdEAAV,2026-12-12,Granite Analytics - Platform renewal,2026-10-31`

export default function Docs() {
  const c = defaultConfig()
  return (
    <section className="page narrow docs">
      <div className="eyebrow">Docs · last reviewed November 9, 2026</div>
      <h1>Getting your data out of Salesforce</h1>
      <p className="lede">Pipeline Hygiene needs two files for forecasting (opportunities and their history) and up to three more for duplicate detection. Everything is parsed in your browser. Steps below match Lightning Experience as of the Winter &rsquo;27 release; menus in Classic differ.</p>
      <nav className="toc" aria-label="On this page">
        <a href="#opps">1. Opportunities</a><a href="#history">2. Opportunity history</a><a href="#roles">3. Contact roles (optional)</a><a href="#dedupe">4. Accounts, contacts, leads</a><a href="#dataloader">Data Loader</a><a href="#hubspot">HubSpot</a><a href="#rules">How scores are computed</a><a href="#merge">Merging safely</a><a href="#columns">Recognised columns</a>
      </nav>

      <h2 id="opps">1. Opportunities report</h2>
      <ol>
        <li><b>Reports</b> → <b>New Report</b> → report type <b>Opportunities</b> → <b>Start Report</b>.</li>
        <li>Filters: <b>Show Me</b> = All opportunities; <b>Close Date</b> = Custom, from the start of the quarter six quarters ago to the end of next quarter. Include closed won and closed lost: accuracy needs them.</li>
        <li>Remove any groupings so the report is <b>tabular</b>. Add columns: Opportunity ID, Opportunity Name, Account Name, Opportunity Owner, Owner Role, Stage, Amount, Close Date, Created Date, Last Activity, Next Step, Forecast Category, Probability (%).</li>
        <li><b>Save &amp; Run</b>, then the arrow next to Edit → <b>Export</b> → <b>Details Only</b>, format <b>Comma Delimited .csv</b> (or .xlsx). &ldquo;Formatted Report&rdquo; also works: the title block and Grand Totals footer are detected and skipped.</li>
      </ol>
      <p className="muted small">Amounts in multi-currency orgs: use <b>Amount (converted)</b> so every deal is in the corporate currency.</p>

      <h2 id="history">2. Opportunity history</h2>
      <p>Slippage, the weekly waterfall and forecast accuracy are rebuilt from history. Either report works; you only need one.</p>
      <ul>
        <li><b>Opportunity History</b> (report type <i>Opportunity History</i>): on in every org, one row per save that changed stage, amount, probability, close date or forecast category. Columns: Opportunity ID, Edit Date (or Last Modified), Stage, Amount, Close Date, Forecast Category.</li>
        <li><b>Opportunity Field History</b> (report type <i>Opportunities with Field History</i>): requires <b>Setup → Object Manager → Opportunity → Fields &amp; Relationships → Set History Tracking</b> on Stage, Amount, Close Date and Forecast Category. Columns: Opportunity ID, Edit Date, Field / Event, Old Value, New Value.</li>
      </ul>
      <p className="muted small">Retention: field history is kept 18 months in the UI and up to 24 months through the API (as of November 2026). Export at least once a quarter if you want accuracy across more quarters, and save a snapshot here each week.</p>

      <h2 id="roles">3. Contact roles (optional)</h2>
      <p>The single-threaded rule needs to know how many contact roles each deal has. Add a <b># of Contact Roles</b> roll-up or formula to the opportunities report, or export the <i>Opportunities with Contact Roles</i> report / the query below. Without either, the rule is skipped.</p>

      <h2 id="dedupe">4. Accounts, contacts and leads</h2>
      <p>Report types <b>Accounts</b>, <b>Contacts &amp; Accounts</b> and <b>Leads</b>, tabular, Details Only export. Include the ID, name, website or email, phone, billing/mailing street and postal code, owner, created date and last activity. Every extra column you include shows up in the survivorship preview.</p>

      <h2 id="dataloader">Data Loader or Workbench (SOQL)</h2>
      <p>For larger orgs, export with Data Loader (<b>Export</b>, not Export All, unless you want deleted records) using these queries. Headers come out as API names (<code>STAGENAME</code>, <code>ACCOUNT.NAME</code>) and are detected automatically.</p>
      <Code label="SOQL · Opportunity" code={SOQL_OPPS} />
      <Code label="SOQL · History" code={SOQL_HIST} />
      <Code label="SOQL · Contact roles" code={SOQL_ROLES} />
      <Code label="SOQL · Dedupe objects" code={SOQL_DEDUPE} />
      <p>The close-date fixes you approve on the Hygiene tab download as a Data Loader <b>Update</b> file. Map <code>Id</code> and <code>CloseDate</code> only:</p>
      <Code label="close-date-updates.csv" code={UPDATE_EX} />

      <h2 id="hubspot">HubSpot (bonus)</h2>
      <p><b>CRM → Deals</b> → table view → <b>Export</b>, include all properties. Record ID, Deal Name, Deal Stage, Amount, Close Date, Create Date, Deal owner and Associated Company are mapped automatically. HubSpot has no field-history export in the UI, so slippage needs a few weekly snapshots first.</p>
      <p>Files without an ID column (HubSpot&rsquo;s own <a href="https://knowledge.hubspot.com/import-and-export/sample-import-files" target="_blank" rel="noreferrer">sample import files</a>, or a report without the ID column) still import: records are keyed by name (contacts by email), owner falls back to Unassigned, and Excel dates stored as plain serial numbers are read as dates. Deals keyed by name are left out of the Data Loader update file, because Data Loader needs the real Id.</p>

      <h2 id="rules">How scores are computed</h2>
      <p>Each open deal starts at 100 and loses the weight of every rule it breaks (floor 0). Owner, team and org scores are the mean of their open deals. Defaults below; change them per org on Data &amp; rules.</p>
      <div className="table-wrap"><table>
        <thead><tr><th>Rule</th><th>Fires when</th><th className="num">Weight</th></tr></thead>
        <tbody>{RULES.map(r => <tr key={r}><th scope="row">{RULE_LABEL[r]}</th><td className="small">{{
          pastDue: 'Close date is before the data as-of date.',
          stale: `No activity for more than ${c.staleDays} days (created date if no Last Activity column).`,
          noNextStep: 'Next Step is blank.',
          stageAge: `Days in the current stage exceed the stage benchmark (default ${c.defaultStageDays}).`,
          zeroAmount: 'Amount is 0 or blank.',
          singleThreaded: 'One contact role or none (only when roles are known).',
          pushed: `Close date moved later ${c.pushLimit} or more times.`,
          stageRegressed: 'Stage history moved backwards in the stage order.',
          stageSkipped: 'Stage history jumped over one or more stages.',
        }[r]}</td><td className="num">{c.weights[r]}</td></tr>)}</tbody>
      </table></div>
      <h3>Forecast accuracy</h3>
      <p>For each completed quarter, the commit (closed won to date plus open deals in the Commit category closing in the quarter) is rebuilt as it stood at week {c.forecastWeek}, then compared with closed won at quarter end. Error = (called − won) / won; a quarter with a commit but nothing won counts as a 100% miss instead of being dropped. MAPE is the mean of absolute errors; bias pools all quarters (total called / total won − 1). Bias at or below −30% is labelled sandbagging, at or above +30% over-forecasting. When the export has no forecast-category history, the category is inferred from the stage.</p>
      <h3>Realistic close</h3>
      <p>For every closed deal, the engine records how many more days the close date moved after its first, second, third&hellip; change. An open deal that has been pushed <i>k</i> times gets the median further slip of closed deals that were also changed at least <i>k</i> times, using the owner&rsquo;s own deals when there are five or more, else the whole team. It is a pattern, not a prediction: the pack shows the basis for every suggestion.</p>
      <h3>Duplicate matching</h3>
      <p>Names are normalised (case, accents, punctuation, legal suffixes such as Inc, LLC, Corp, GmbH, and domains typed as names). Records are only compared when they share a blocking key (name prefix, first word, domain, email, phone, or address), which keeps 10,000 records well under a second. Evidence (same normalised name, Jaro-Winkler / trigram similarity, same domain, email, phone, street) is combined as 1 − ∏(1 − p), halved when two accounts have different domains, and records above the threshold (default {Math.round(c.dupThreshold * 100)}%) are clustered. The master is the most complete record by default; ties go to the most recent activity, then the oldest.</p>

      <h2 id="merge">Merging safely in a live org</h2>
      <ul>
        <li>Salesforce merges <b>at most three records at a time</b> (one master plus two). The merge plan splits bigger clusters into several merges into the same master.</li>
        <li>Merges cannot be undone. Merged-away records sit in the Recycle Bin for 15 days, but their links now point at the master.</li>
        <li>Data Loader cannot merge. Use the UI (Accounts: <i>Merge Accounts</i>; Contacts: <i>Merge Contacts</i> from the account; Leads: <i>Merge</i> from the lead or the duplicate record set), Apex <code>Database.merge(master, duplicates)</code>, or the API <code>merge()</code> call.</li>
        <li>Apply the survivorship CSV to the masters first (a Data Loader update), then merge. Rehearse in a sandbox and take a backup export first.</li>
        <li>Contacts with different parent accounts, person accounts, and records owned by integrations need a human look. Mark wrong clusters as &ldquo;Not duplicates&rdquo;; the decision survives re-imports.</li>
      </ul>

      <h2 id="columns">Recognised columns</h2>
      <p className="muted small">Headers are matched case- and punctuation-insensitively. Anything else can be mapped by hand on import.</p>
      {(Object.keys(FIELDS) as Kind[]).map(k => (
        <details key={k} className="disclose"><summary>{KIND_LABEL[k]}</summary>
          <ul className="small">{FIELDS[k].map(f => <li key={f.key}><b>{f.label}</b>{f.required ? ' (required)' : ''}: <span className="muted">{f.aliases.slice(0, 6).join(', ')}</span></li>)}</ul>
        </details>
      ))}
      <p style={{ marginTop: 28 }}><Link href="/app" className="btn primary">Open the app</Link></p>
    </section>
  )
}
