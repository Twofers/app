# Korean Counter Registry

Status: pending native reviewer. No counter is approved for production use yet.

Current ownership:

- Internal localization owner: Dan / Twofer admin
- Korean reviewer: TBD before production launch

## Current Registry State

| Counter ID | Display | Candidate categories | Reviewer approved | Reviewer |
| --- | --- | --- | --- | --- |
| cup | 잔 | coffee, drink, tea | No | TBD |
| piece | 개 | pastry, retail item | No | TBD |
| serving | 인분 | meal | No | TBD |

## Rules

- Application code may use a Korean counter only when the counter entry is reviewer-approved.
- A model may not infer counters at view time.
- Unknown or unapproved counters must use the counter-free fallback template.
- Every counter addition requires Korean reviewer sign-off and fixture coverage.

## Required Fixture Families

- Same item and same quantity
- Different items
- Quantities greater than one
- English brand name embedded in Korean
- Hangul item name
- Mixed protected term
- Unknown counter
- Long item name
- Percent-off item
- Service rather than physical item
