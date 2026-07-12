# Korean Counter Registry

Status: native reviewer signed off on 2026-07-03.

Current ownership:

- Internal localization owner: Dan / Twofer admin
- Korean reviewer: June

## Current Registry State

| Counter ID | Display | Candidate categories | Reviewer approved | Reviewer |
| --- | --- | --- | --- | --- |
| cup | 잔 | coffee, drink, tea | Yes | June |
| piece | 개 | pastry, retail item | Yes | June |
| serving | 인분 | meal | Yes | June |

## Rules

- Application code may use these Korean counters when the counter entry is reviewer-approved.
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
