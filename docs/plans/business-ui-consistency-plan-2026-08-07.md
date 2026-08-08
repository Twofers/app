# Business (merchant) UI consistency + clutter plan

Date: 2026-08-07
Status: IMPLEMENTED — workstreams 1–4 shipped 2026-08-07 (17495bdf, 90aea54c,
903f4329, and this commit), each device-verified on the S10 in dark mode.
ONE item remains open and FOUNDER-GATED: the B4 **server-side** timezone fix
(prod migration; see B4). A4 was retracted as not-a-bug before any code was
written; B10 was closed by decision #5.
Source: full screenshot audit of every reachable business screen on the S10
(dark mode, `test2@test.com` / Cedar & Bean Cafe). Evidence files are
`biz01`–`biz12`, `dm_*` in the session scratchpad.
Convention: this plan file IS the tracker; check items off as they land.

## Screens audited

| # | Screen | Route | Evidence |
|---|--------|-------|----------|
| 1 | Create hub | `(tabs)/create.tsx` | biz01, biz09 |
| 2 | Redeem | `(tabs)/redeem.tsx` | biz02 |
| 3 | Offers / dashboard | `(tabs)/dashboard.tsx` | biz03, biz03b, biz03c, biz05 |
| 4 | Account | `(tabs)/account/index.tsx` | biz04, biz11, biz12 |
| 5 | Edit business profile | `business-setup.tsx` | dm_v3, dm_v4 |
| 6 | Menu library | `create/menu-manager.tsx` | biz06 |
| 7 | Menu offer | `create/menu-offer.tsx` | biz07 |
| 8 | Reuse & repeat | `create/reuse.tsx` | biz08 |
| 9 | Templates (hub expander) | `(tabs)/create.tsx` | biz09 |
| 10 | Deal analytics | `deal-analytics/[id].tsx` | biz10 |
| 11 | AI ads (express + expanded) | `create/ai.tsx` | express2/3, s1w_* |

NOT audited (unreachable this pass, carry forward): billing
(`account/billing*` — no card renders for this comped account), active
redemption mode (`redemption-mode.tsx`), menu scan (`create/menu-scan.tsx`),
business apply (`business-apply.tsx` — pre-approval only).

---

## Part A — SYSTEMIC (fix once, every screen benefits)

These are the reason the app "doesn't feel like one app". Fix these first:
most per-screen complaints in Part B disappear as a side effect.

### A1. Selected state has FOUR different treatments (P1)

**What.** The same "this one is chosen" idea is drawn four ways, sometimes
120px apart on one screen:
- solid orange fill + dark text — Offers filter chips (`All`), Account
  language (`English`, `Same as app`), Business setup category (`Café`)
- orange **outline** + orange text, transparent fill — Offers **sort** chips
  (`Newest`)
- orange outline + brown tint fill — Account appearance (`Dark`)
- orange outline + brown tint fill + radio dot — Account repeat-limit
  (`No limit`)

**How.** Add one `<SelectableChip selected variant="chip" | "row">` to
`components/ui/`. Exactly two visual forms: **chip** = solid orange fill +
`primaryText` (for horizontal filter/segment chips), **row** = orange border
+ `PrimaryTint.surfaceStrong` fill + radio/check glyph (for full-width
option rows). Replace all call sites; delete the ad-hoc styling.

**Expected outcome (testable).** Screenshot Offers and Account. Every chip
in a horizontal chip row uses the identical fill/text pair; every full-width
option row uses the identical border/tint pair. A source test asserts no
screen defines its own `backgroundColor: primary` chip style inline.

### A2. Action styling has SIX levels with no ladder (P1)

**What.** Observed action treatments: solid orange full-width, outlined
full-width, centered orange text link (`Edit profile`), left-aligned orange
text link (`Edit all fields`, `+ More options`), inline text pair
(`Edit` / `Archive`), and orange text + arrow (`Repeat in quick deal →`).
Nothing communicates relative importance, and two of them (`Edit profile`,
`Edit all fields`) are the *same destination with different labels*.

**How.** Define and document a 3-rung ladder, then map every action to it:
1. **Primary** — solid `PrimaryButton`, max ONE per card/screen.
2. **Secondary** — outlined full-width button.
3. **Tertiary** — left-aligned orange text link (never centered).
Destructive gets its own rung (see A3). Fold `Edit profile` /
`Edit all fields` into one label + one route.

**Expected outcome (testable).** No card renders two solid primary buttons.
Every text-link action is left-aligned. Grep shows one label key for the
edit-profile destination.

### A3. Destructive actions are the loudest thing on screen (P0 for trust)

**What.** Four treatments, and the worst offender is the most dangerous:
- `Delete my account` — **solid filled red**, the highest-emphasis button
  anywhere in the app, louder than any primary CTA (biz12).
- `Delete old deal` — full-width red outlined button, **repeated on every
  one of 24 deal cards** (biz03c).
- template delete — bare red trash icon in a circle, no label (biz08).
- template delete (hub) — red text+icon pill, right-aligned (biz09).

**How.** One `DestructiveAction` treatment: red **outlined**, never filled.
Never full-width inside a repeating list row — move `Delete old deal` into
the existing `Manage` sheet (which already hosts Duplicate / Print flyer /
Delete). `Delete my account` becomes outlined inside its red-tinted card.
Icon-only delete gets a visible label.

**Expected outcome (testable).** No filled red button exists in the app
(grep + screenshot). The Offers list renders zero delete buttons; deleting
requires opening `Manage`. Deal card height drops (see B1).

### A4. ~~Stack screens have no bottom safe-area inset~~ — RETRACTED, NOT A BUG

**Original claim:** the last row on Menu library / Menu offer / Reuse / Deal
analytics is clipped behind the Android nav bar.

**RETRACTED 2026-08-07 before any code was written.** The claim was an
artifact of the audit method: those screenshots were taken **mid-scroll**,
so the next item was naturally half-visible at the fold — which is normal
scrolling, not clipping. Verified by scrolling Menu library to its true end
(`verify_menulib_end.png`): the final row ("Add-on Egg") renders fully with
generous clearance above the nav bar.

Confirmed in source too — every screen named already does the right thing:
`useScreenInsets("stack")` → `scrollBottom` applied to the ScrollView's
`contentContainerStyle` (`menu-manager.tsx:39,178`, `reuse.tsx:102,209`,
and the same pattern in menu-offer / menu-scan / menu / business-setup /
deal-analytics). `getScreenLayoutMetrics` additionally floors the Android
inset (`STACK_ANDROID_BOTTOM_FLOOR`) precisely for the edge-to-edge dev
client case.

**No work required.** The earlier revise-panel fix (QA F-QA4) was a genuine
but unrelated case: that panel was nested inside a container that did not
inherit the scroll padding.

**Lesson for future audits:** never call something clipped from a single
mid-scroll screenshot — scroll to the end first.

### A5. Cards are the app's visual language — except where they aren't (P1)

**What.** Every business screen uses bordered cards on `theme.surface`…
except **Deal analytics**, which is a bare wall of left-aligned text directly
on the background (biz10). It reads like an unstyled debug view.

**How.** See B4 — wrap analytics sections in the same `CardShell` the
dashboard uses.

**Expected outcome (testable).** Screenshot Deal analytics beside Offers:
identical card radius, border colour, padding, and section-heading scale.

### A6. Header patterns differ screen to screen (P2)

**What.** Three variants: (a) tab screens — big title + subtitle, no back;
(b) stack screens — `←` + title, then a LARGE gap (~180px) before body copy
(Menu library biz06, Reuse biz08); (c) Deal analytics — a labeled
`← My offers` **pill inline with the title**, which shoves the title right
and wraps the deal name and date across three lines at a broken indent
(biz10).

**How.** One `ScreenHeader` for stack screens: plain `←` glyph at the far
left, title beside it, optional one-line subtitle directly under, fixed
spacing token. Retire the labeled back-pill.

**Expected outcome (testable).** All stack screens show the back glyph at
the same x and the title baseline at the same y. Deal analytics' deal name
and date no longer wrap under the back control.

### A7. Vocabulary drift — four names for one feature (P1, cheap)

**What.** The reuse flow is called: "Repeat a past deal" (hub, biz01),
"Reuse & repeat" (header, biz08), "Repeat in quick deal →" (row action,
biz08), "Opens in AI deal" (template row, biz08). **"quick deal" and
"AI deal" are the OLD screen names** (`create/quick.tsx`,
`create/ai.tsx`) that were unified into one builder — stale internal
terminology leaking to merchants. Same class: "Edit profile" vs "Edit all
fields"; "Promote a menu item" (hub) vs "Menu offer" (header).

**How.** Pick one noun per flow and use it in hub, header, and actions:
Reuse → "Repeat a deal"; menu promo → "Promote a menu item"; profile →
"Edit business profile". Update en/es/ko together.

**Expected outcome (testable).** Grep the locale files: no user-facing
string contains "quick deal" or "AI deal". Each flow's hub label, screen
header, and row action use the same noun.

### A8. Empty placeholders reserve big blank boxes (P2)

**What.** Templates expander renders a **~330px tall empty gray rectangle**
where a template thumbnail would be (biz09) — the single largest piece of
dead UI in the app. The Reuse template row shows a smaller blank square
(biz08). The Offers loading skeleton's first block is a featureless
~900px box while the blocks below it use properly shaped bars (biz03) —
reads as a rendering failure.

**How.** No image → render no image box (let the text fill the width), or a
compact icon tile at list-row size. Reshape the dashboard skeleton's first
block to mirror the real card's layout.

**Expected outcome (testable).** A template with no thumbnail shows zero
blank image area. During dashboard load, no untextured block taller than
~120px appears.

### A9. Metric presentation is inconsistent and arbitrarily coloured (P2)

**What.** Two tile styles: the dashboard's 6 large tiles vs the deal card's
4 small tiles (biz03b). Within the SAME 6-tile grid, three values are white
(Live deals, Claims, Redemptions) and three are orange (Engagement, Saved
customers, Repeat customers) with no semantic rule. Also "Claims 28" and
"Engagement 28" sit adjacent showing the same number with different labels
("Deal opens this month" vs "This month"), which reads as a duplicate.
Separately, "Feed views" is buried behind a collapsed monthly-stats section
(QA F-QA10), so related metrics live at two different depths.

**How.** One `MetricTile` with a `size` prop. Colour encodes meaning, not
decoration: neutral `text` for counts; orange reserved for the single
headline metric. Re-label so no two visible tiles restate the same number.
Decide one home for impressions/feed views.

**Expected outcome (testable).** ~~At most one value is orange~~ (voided by
Dan's decision #2 — the orange growth-metric split is intentional). No two
visible tiles show the same number with different labels.

**DONE 2026-08-07, with a supervisor correction.** The deal card's divergent
tile implementation (`DealStatPill`) is deleted, leaving `MetricTile` used
only by the summary grid. The duplicate-looking pair was "Claims / 28 / This
month" beside "Engagement / 28 / Deal opens this month".

The agent relabelled `metricEngagement` to a FIXED "Deal opens" — which QA
caught as a **defect**: that tile is polymorphic. It shows opens, ELSE a
redemption PERCENTAGE, ELSE "Waiting", so a merchant with claims but no opens
would have read "Deal opens: 50%". The generic "Engagement" it carried was
imprecise but not wrong. Fixed by making the LABEL travel with the value:
opens → "Deal opens" + "This month"; percentage → "Redeem rate" (reusing the
existing `dealStatConversion` key) + its own sublabel; waiting → "Engagement"
(new `metricEngagementWaiting`, en/es/ko). This removes the duplicate read
AND keeps every branch correctly labelled.

---

## Part B — PER-SCREEN

### B1. Offers — the deal card is ~610px and 24 of them stack (P0 clutter)

**What.** Each card = thumbnail + title + date range + 4 metric tiles +
**three stacked full-width buttons** (`Manage`, `Run again`, `Delete old
deal`). The buttons alone are ~330px — more than half the card. Only ~2.5
cards fit on screen; 24 deals ≈ a 15,000px scroll with 72 buttons (biz03c,
biz05).

**How.** Collapse to: thumbnail + title + status pill + one metrics line
(`2 claims · 1 redeemed · 50%`) + ONE primary action (`Run again`) + a
`⋯` overflow carrying Manage/Analytics/Delete. Target ≤240px per card.
Tapping the card body still opens analytics.

**Expected outcome (testable).** ≥4 deal cards visible on one S10 screen
(vs 2.5 today). Zero delete buttons in the list. Card height ≤240px.

**DONE 2026-08-07 (workstream 2).** Per Dan's decision #1 both Manage and Run
again stayed, so the card was slimmed without touching them: the 4-up stat
grid became one inline muted line (`dealMetricsLine`, and a zero-claim deal
now reads "No claims yet" instead of four zeros), and the two buttons moved
side by side. Device-measured ~348px, above the original ≤240px target
(that target assumed one action + overflow, which decision #1 ruled out) but
down from ~610px. **The testable outcome is met: 4.5 cards now fit on one S10
screen vs 2.5** (`w2b_scrolled.png`). Delete left the card in workstream 1.

### B2. Offers — the sticky header wastes 300px and lies (P2)

**What.** "Offers / Welcome back, Cedar & Bean Cafe / This month at a glance
· tap a deal for details" stays pinned while you scroll deep into the deal
list (biz05), costing ~15% of the viewport at every scroll position. By then
the subtitle is stale, and "tap a deal for details" is misleading now that
each card has explicit buttons.

**How.** Collapse the header on scroll to just "Offers" (+ the live-count
pill). Drop the "tap a deal" hint once B1 gives cards a clear tap target.

**Expected outcome (testable).** After scrolling past the first card, the
header occupies ≤120px.

**DONE 2026-08-07.** Subtitle collapses past ~200px of scroll (160px
hysteresis on the way back up); device-verified showing only "Offers" while
deep in the list (`w2b_scrolled.png`). "· tap a deal for details" dropped
from `offersDashboard.subtitle` in en/es/ko.

### B3. Offers — the same fact is stated three times (P2)

**What.** The summary card says "**No live deals**" as its title, "**0
live**" in a pill top-right, and "**Live deals / 0**" as the first tile —
one number, three times, in one card (biz03b).

**How.** Keep the tile (it belongs in the grid); make the card title the
business-facing headline and drop the pill.

**Expected outcome (testable).** The live-deal count appears exactly once
in the summary card.

**DONE 2026-08-07.** The top-right "N live" pill was removed; the card title
and the "Live deals" tile remain (`w2a_offers.png`).

### B4. Deal analytics — full visual rebuild (P1) + a real bug (P1)

**What.** No cards; raw `key: value` lines ("unknown: 2", "Favorite: 2",
"QR / code: 1"); heading sizes jump around; "(aggregated)" is developer
speak; "Claims over time" has no chart, just a date and a sentence; two
equal-weight outlined buttons with no primary (biz10).

**Bug:** "Claims by hour … **Busiest around 3:00 AM local** (2 claims)" —
both claims were made ~10:40 PM local. This is the documented device-tz vs
store-tz defect (QA plan F-11, `deal-analytics/[id].tsx:159`).

**How.** Wrap each section in `CardShell`; render counts as `MetricTile`s;
one heading scale; plain-English headings ("Audience & timing"); `Edit deal`
becomes primary, `Export analytics` secondary; either draw a small bar for
claims-by-day or rename the section to match what it shows. Fix the hour
bucketing to use the deal's store timezone, not the device's.

**Expected outcome (testable).** Analytics is visually indistinguishable in
card/tile styling from the dashboard. A deal claimed at 10:40 PM store-local
reports a 10 PM busiest hour, not 3 AM — assert with a unit test over the
bucketing function.

**VISUAL REBUILD DONE 2026-08-07 (workstream 3), device-verified**
(`w3a_analytics.png`): every section now sits in `CardShell`; the raw
`key: value` lines render as `MetricTile` grids; `MetricTile` was extracted
from `dashboard.tsx` to `components/ui/metric-tile.tsx` and is now shared;
one heading scale; "(aggregated)" dropped; "Edit deal" is primary and
"Export analytics" secondary; the labeled "← My offers" pill became a plain
`←` glyph so the title and date no longer wrap at a broken indent.

**THE TIMEZONE BUG IS *NOT* FIXED — root cause found, and it is SERVER-SIDE.**
Supervisor QA traced it properly rather than accepting the agent's account.
The agent fixed a genuine but DIFFERENT latent defect: the client
`bestTime` bucketing at `[id].tsx:167-175` used `getDay()`/`getHours()`
(device timezone), plus an AM/PM label derived from the bucket's END hour so
a 10 PM peak printed "10–12 AM". Both are now fixed behind a tested pure
helper (`lib/deal-analytics-hours.ts`, 16 tests). Keep that work.

But the string actually observed on device — "Claims by hour (local to each
deal): Busiest around 3:00 AM local" — is rendered by
`components/merchant-insights-panel.tsx:71` from `insights.claims_by_hour_local`,
a **server-computed** field. The chain, verified in source:

1. `app/create/ai.tsx:4444` — `timezone: isRecurring ? timezone : null`, so
   **one-time deals persist a NULL timezone** (only recurring deals store one).
2. `supabase/migrations/20260601153000_...sql:315` —
   `COALESCE(NULLIF(trim(d.timezone), ''), 'UTC')`, so a NULL deal timezone
   silently becomes **UTC**.
3. The RPC buckets with `EXTRACT(hour FROM (f.created_at AT TIME ZONE v_tz))`
   and the panel labels the result **"local"**.

10:40 PM CDT = 03:40 UTC, which is exactly what was displayed. (Confirmed the
S10 itself is `America/Chicago`, which is why a device-timezone read could
never have produced 3 AM — that mismatch is what exposed the wrong diagnosis.)

Note one RPC overload already does the right thing —
`:501` uses `COALESCE(NULLIF(trim(b.timezone), ''), 'UTC') AS tz` off the
**business** row — so the two overloads disagree.

**WRITTEN 2026-08-07 on Dan's "do the timezone migration" — APPLY IS STILL
FOUNDER-GATED.** Two halves, both committed:

1. **`supabase/migrations/20260828120000_reporting_timezone_fallback.sql`** —
   repairs EXISTING rows. New `public.resolve_reporting_timezone(text, uuid)`
   resolves **deal tz → that business's most recent non-null deal tz → 'UTC'**,
   and both RPC overloads route through it (the business overload resolves once
   into `v_fallback_tz` rather than per claim row).
2. **`app/create/ai.tsx`** (hash-locked, re-hashed with a chained ref) — the
   publish payload now always persists `timezone` instead of
   `isRecurring ? timezone : null`, so new one-time deals never need the
   fallback at all.

**Two corrections to this section's earlier analysis, found while building it:**
- I claimed the two overloads "disagree", citing `b.timezone` at `:501` as the
  *business* timezone. WRONG — `b` there aliases the `base` CTE
  (deal_claims ⋈ deals), so both overloads were already using the **deal**
  timezone identically.
- I proposed falling back to "the business timezone". **There is no such
  column**: `businesses` has none, and `business_profiles.timezone` was never
  created — the guard in `20260703120004_timezone_validation.sql` always takes
  its "column does not exist — skipping" branch. Hence the fallback actually
  used: the business's own other deals, which do carry a timezone whenever one
  was recurring or took the `deals.timezone` column default.

Safety checks done before touching the locked file: nothing infers recurrence
from a null timezone, and `lib/deal-time.ts:33` already defaults a null — so
always storing it only makes resolution accurate. Scope held to the deals
payload; the sibling `deal_templates` insert is unchanged.

Guarded by `supabase/functions/_shared/reporting-timezone-fallback-migration.test.ts`
(6 tests) including a **byte-identity check** that the two RPC bodies copied
out of `20260601153000` differ ONLY at the two timezone expressions.

**Remaining for Dan:** apply the migration to prod (`supabase db push` per the
runbook). Until it is applied, one-time deals published before the client fix
still report UTC hours. Nothing needs redeploying — these are RPCs, not edge
functions — and the client half rides the next store build.

### B5. Create hub — two card species in one list (P2)

**What.** Top three rows have a tinted rounded-square icon container with
titles at x≈148; bottom two ("Menu library", "Templates") have bare icons
with titles at x≈112 — a visibly ragged left edge in a five-row list
(biz01). Subtitle punctuation is also mixed (two of five end in a period).

**How.** One row component for all five: same icon container, same text
inset. Keep the chevron-down only for the genuinely expanding Templates row.
Normalize subtitle punctuation (no trailing periods).

**Expected outcome (testable).** All five titles share one x-offset; all
five icons share one container size.

### B6. Account — ordering, card boundaries, and a mystery "+" (P2)

**What.** (a) "Logged in as / Log out" is the FIRST card while "Your
business" — the merchant's own identity — is third (biz04). (b) The
"Offers & AI language" card also contains an unrelated "Business profile"
sub-section with its own `Edit all fields` link (biz11) — two concerns in
one card, and a second label for a destination already called `Edit
profile`. (c) The "Redemption mode" card's only affordance is a small orange
**`+`** (biz11), where every other navigable card uses `›`; `+` reads as
"add". (d) `Open dashboard` is a full-width button to a screen that is
already one tap away in the tab bar. (e) `+ More options` (biz12) reuses the
exact words of the create screen's "More options" expander for a different
concept.

**How.** Reorder: Your business → Redemption mode → notifications/limits →
language/appearance → help → Log out → Delete account. Split Business
profile into its own card with one label. `+` → `›`. Drop `Open dashboard`.
Rename `+ More options` to something specific ("Advanced settings").

**Expected outcome (testable).** "Your business" is the first card; "Log
out" is below the fold near Delete. Every navigable card shows `›`. Grep
shows one edit-profile label key.

### B7. Redeem — 75% of the money screen is empty (P2)

**What.** Title, segmented control, an error line, one CTA — then ~1,500px
of black (biz02). The camera-blocked message is naked text on the
background, not in a card like every other status message in the app. There
is no visible entry to staff redemption mode from the Redeem tab (it lives
in Account, biz11) even though that is the mode this screen is for.

**How.** Put the camera-permission state in a card. Below the fold, show
today's redemption count and the last few redeemed tickets (data that
already exists on the dashboard). Add a "Hand device to staff" entry linking
to redemption mode.

**Expected outcome (testable).** With camera blocked, no more than ~35% of
the screen is empty background; the permission message sits in a card;
redemption mode is reachable from the Redeem tab.

### B8. Menu library vs Menu offer — same data, two shapes (P2)

**What.** Menu library shows "THE LEAN & MEAN (Skinny Latte - Skim milk
latte)" as one run-on title (biz06); Menu offer splits the identical record
into title + description (biz07). Menu library's actions are bare
`Edit` / `Archive` text (Archive is white with no affordance that it is
tappable), and its secondary `Show archived` sits ABOVE the primary
`Add item`.

**How.** One `MenuItemRow` used by both screens, parsing name/description
identically (adopt Menu offer's split — it is the readable one). Primary
`Add item` first. `Edit`/`Archive` become tertiary links per A2, or move
Archive into an overflow.

**Expected outcome (testable).** The same menu item renders with identical
title/description on both screens. `Add item` precedes `Show archived`.

### B9. Templates — a card whose only action is Delete (P2)

**What.** The expanded template card shows a giant empty thumbnail, the
name, "$5.99" (price of what is unclear), and exactly one visible action:
red **Delete** (biz09). The primary intent — use the template — has no
visible affordance.

**How.** Primary `Use template` action; delete to overflow (A3); drop the
empty image box (A8); label or remove the bare price.

**Expected outcome (testable).** The card exposes a primary use action;
delete is not the most prominent control.

### B10. Business setup — remaining item (P3)

Two issues from this screen were already fixed and device-verified today
(commit `2b5fee56`): the dark-mode read-only affordance and the run-on
custom-hours block. Remaining: the "Short description" placeholder renders
bright enough to be mistaken for entered content. Note the palette oddity —
the dedicated `inputPlaceholder` token (`#B4BCC5`) is BRIGHTER than the
`theme.icon` (`#9BA1A6`) that the inputs actually use, so "use the right
token" would make it worse. Needs a palette decision, not a screen fix.

---

## Sequencing

1. **A3 (destructive prominence)** first — the only item with real
   user-harm potential, and it is small. (A4 was retracted as not-a-bug.)
2. **A1 + A2** (the shared chip/action components) — unlocks most of Part B.
3. **B1 + B2 + B3** (Offers) — the biggest clutter win per unit of work.
4. **B4** (Deal analytics rebuild + the tz bug).
5. **A5–A9, B5–B9** polish.
6. **B10** after the palette decision.

All of Part A and B is client-only → rides a store build, no OTA. No
migrations, no edge functions. i18n: A7 renames and any new copy need
en/es/ko together (`check:i18n-keys` gates it).

**Poster-lock note:** `app/create/ai.tsx` is hash-locked. Nothing in this
plan requires touching it — if A1/A2 rollout reaches the AI ads screen, that
file needs the per-file approval + lock re-hash.

## Decisions — SETTLED by Dan 2026-08-07

1. **Deal-card actions (B1):** KEEP both `Run again` and `Manage` visible.
   Only `Delete old deal` leaves the card (into the Manage sheet, which
   already hosts Delete). Card-height target relaxes to ≤330px accordingly.
2. **Orange budget (A9):** KEEP all three growth metrics orange
   (Engagement / Saved customers / Repeat customers). The white-vs-orange
   split is therefore INTENTIONAL and stays — A9 drops its recolour clause
   and keeps only: one shared `MetricTile` component, and re-labelling so no
   two visible tiles restate the same number.
3. **Redeem (B7):** KEEP MINIMAL. Do NOT add a redemption activity feed and
   do NOT add a staff-mode entry point. The only change is wrapping the
   camera-permission message in a card for consistency (A5). The empty space
   is accepted as deliberate for counter use.
4. **Account order (B6):** CONFIRMED — Your business first, Log out last
   (directly above Delete account).
5. **Placeholders (B10):** KEEP inputs on `theme.icon`. `inputPlaceholder`
   stays unused. B10 is CLOSED, no change.
