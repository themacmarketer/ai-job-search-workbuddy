# Search Queries for Job Scraper

<!-- LOCALISED: Singapore. Filled for Raymond Chia (sandbox persona), 2026-10-20.
     Re-run /setup --section search to change the targeting. -->

## Installed portal CLIs (primary for `/scrape`)

| Skill | Status | What it gives you |
|---|---|---|
| **`mycareersfuture-search`** | **enabled — primary** | WSG government portal. Declared monthly SGD salary, posting date, expiry date, full description, skills, company UEN. Where EP/S Pass roles must be advertised. |
| `linkedin-search` | enabled | Country-agnostic; pass `-l "Singapore"`. Personal use only. |
| `freehire-search` | enabled | Tech aggregator; pass `--country SG`. Weak for commercial roles — low priority here. |
| `jobstreet-search` | **disabled by default** | Singapore's largest commercial board, and the best source for sales/commercial roles after MCF. Its robots.txt disallows the search API, so it ships off — see that skill's access notice. |
| `jobbank-`, `jobdanmark-`, `jobindex-`, `jobnet-search` | disabled | Danish demos, irrelevant. Leave off. |

The `site:` templates below are the **WebSearch fallback** for portals without a CLI
(Indeed SG, Glints, eFinancialCareers, company career pages) or when a CLI fails.

**Language scope:** English. Singapore employers advertise in English even when the role
needs another language; that requirement appears inside an English ad and the Language Gate
in `04-job-evaluation.md` catches it there.

## Search Sites

Primary:
- **MyCareersFuture** — CLI, and the only source with reliable salary data
- **LinkedIn** — CLI, `-l "Singapore"`
- **JobStreet Singapore** — CLI disabled; WebSearch fallback works today

Secondary (WebSearch only):
- **Indeed Singapore** (`sg.indeed.com`) — broad, aggregates many boards
- **Glints** (`glints.com/sg`) — startups and tech; thinner for commercial ops
- **Careers@Gov** (`careers.gov.sg`) — public sector commercial and procurement roles
- **eFinancialCareers** (`efinancialcareers.sg`) — financial-services operations roles

## Query Categories

Organised by function, not title. The same work appears as "Sales Operations Manager",
"Commercial Excellence Lead", "Revenue Operations Manager" and "Business Operations
Manager" depending on the employer — search the function, not one string.

### Priority 1: Sales Operations / Commercial Excellence

Raymond's strongest and most desired direction. Run these by default.

```
site:mycareersfuture.gov.sg "sales operations" Singapore
site:mycareersfuture.gov.sg "commercial excellence" Singapore
site:mycareersfuture.gov.sg "revenue operations" Singapore
site:mycareersfuture.gov.sg "commercial operations manager" Singapore
site:linkedin.com/jobs "sales operations manager" Singapore
site:sg.jobstreet.com "commercial excellence" Singapore
```

### Priority 2: Applied AI adoption in commercial functions

The differentiator, and the narrower target. Fewer results — expect noise.

```
site:mycareersfuture.gov.sg "AI adoption" commercial Singapore
site:mycareersfuture.gov.sg "digital transformation" sales Singapore
site:mycareersfuture.gov.sg "commercial transformation" Singapore
site:linkedin.com/jobs "AI adoption lead" Singapore
site:linkedin.com/jobs "commercial transformation" Singapore
```

### Priority 3: Adjacent commercial roles

Pivot targets that use the same operating experience without the "sales operations" label.

```
site:mycareersfuture.gov.sg "key account manager" Singapore
site:mycareersfuture.gov.sg "commercial manager" Singapore
site:mycareersfuture.gov.sg "business planning manager" Singapore
site:mycareersfuture.gov.sg "sales excellence" Singapore
site:linkedin.com/jobs "commercial manager" Singapore
```

### Priority 4: Broader regional / APAC

Wider net, higher noise. Run on `/scrape broad` or when P1 is thin.

```
site:mycareersfuture.gov.sg "regional sales manager" APAC
site:mycareersfuture.gov.sg "business operations" Singapore
site:linkedin.com/jobs "head of sales operations" Singapore
site:linkedin.com/jobs "commercial director" Singapore
```

### Skill-term queries (distinctive, searchable)

These surface roles whose titles you would not guess:

```
site:mycareersfuture.gov.sg Salesforce "sales operations"
site:mycareersfuture.gov.sg "Power BI" commercial Singapore
site:mycareersfuture.gov.sg forecasting "key account" Singapore
```

## Location Filter

No home area is recorded for this persona, so treat the island as commutable and flag by
**door-to-door time**, not district. MCF returns a URA planning district, region and postal
code; JobStreet returns a locality label.

| Cluster | Districts / areas | Relevance here |
|---|---|---|
| **CBD** | Raffles Place, Marina Bay, Tanjong Pagar | Regional HQs, FMCG and distribution HQs — highest concentration of P1 roles |
| **City fringe** | Bugis, Orchard, Novena | Consumer brands, commercial offices |
| **one-north / Buona Vista** | One-North, Biopolis | Tech and biomedical commercial teams |
| **Jurong East / West** | Jurong East, Tuas | Industrial distribution and logistics HQs — relevant to the Brightwell background |
| **Changi / East** | Changi Business Park, Tampines, Ubi | Banking ops, aviation, industrial |
| **North** | Woodlands, Senoko, Yishun | Industrial, food, engineering |

- **Ideal (under ~30 min):** not set — no home area recorded
- **Acceptable (30–45 min):** any MRT-connected district
- **Borderline (45–60 min):** flag, don't reject
- **Over 60 min:** flag with the number
- **"Islandwide":** PASS — common for distribution and field-commercial roles, but check the travel expectation

## Language Filter

Only English is declared (see `CLAUDE.md`). A posting requiring Mandarin, Malay or Tamil as
a job condition is a **hard exclusion** under the Language Gate until the profile records
otherwise — and for a Singapore commercial role serving China-market clients, this will come
up. Confirm the persona's other languages before relying on this filter.

## Date Filter

Last 14 days, or an unexpired deadline. Per portal:

- **MyCareersFuture** — no server-side date parameter; `--jobage` filters client-side and
  drops past-deadline postings by default (`meta.expiredDropped` reports the count)
- **JobStreet** — `daterange` is server-side but only accepts 1/7/14/31
- **LinkedIn** — `--jobage` maps to `f_TPR`
- **WebSearch** — no reliable filter; check the posting page

## Notes for this profile

- **Do not search for engineering or data-science titles.** The persona is explicitly not a
  programmer; those results waste a scoring pass and inflate the apparent gap.
- **"Commercial excellence" is the highest-yield term** for this profile — it returned 25
  salary-disclosing postings in a 60-day window against 4 for "regional sales operations".
- **"Key account manager" is a dead end for this profile — measured, not assumed.** Ten
  KAM-query postings scored in `/rank` on 2026-10-20 produced a median of 51.5 and **zero
  above 60** (range 22–55), against a median of 61 and two Strong Fits at 85 from the
  sales-operations / commercial-excellence queries. The reason is consistent: KAM adverts
  in Singapore are quota-carrying account ownership, which is this persona's explicitly
  stated weak area, not commercial operations. Keep Priority 3 for discovery but expect it
  to score poorly; do not spend `/apply` effort on a KAM result without a high score first.
- **Bare "sales operations" skews junior — always qualify it.** Measured 2026-10-20: the
  phrase alone returned Sales Operations *Executive* roles at S$2,800–4,400 on the first
  page, while "commercial excellence" returned Siemens at S$7,000–13,000 and Microsoft at
  S$12,600–22,500. Use `"sales operations manager"`, or pair it with `--min-salary 7000`,
  rather than the bare phrase.
- **Salary anchor for scoring:** commercial excellence roles, n=25, median S$9,000/mo,
  p25–p75 S$7,110–17,550 (MCF, 60-day window, pulled 2026-10-20).
