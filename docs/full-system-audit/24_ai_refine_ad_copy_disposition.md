# Disposition: legacy hosted function `ai-refine-ad-copy` (F-013)

Date: 2026-07-11. Batch 11 of `20_prioritized_remediation_plan.md`.

## Caller inventory (this repo, full sweep)

`rg -i "ai-refine-ad-copy|refine-ad-copy|refineAdCopy"` across `app/`, `lib/`, `components/`, `hooks/`, `website/`, `supabase/functions/`, `scripts/`:

- **Zero code callers.** Every match is documentation: `docs/twofer-billing-remaining-work.md:108` (notes it was left deployed), the audit package itself, and `outdated/` history.
- The shipped refine/revision path is the revise flow inside `ai-generate-ad-variants` (invoked via `lib/functions.ts` → `invokeAdEdge`); the legacy `ai-create-deal` endpoint is separately disabled (410).
- No website or admin surface invokes it; `supabase.functions.invoke(` call sites reference only functions with local source directories.

## Risk while it stays deployed

The hosted bundle has no authoritative source in this repository, so its auth checks, prompt, provider/data handling, cost controls, and error sanitization cannot be reviewed, tested, or reproduced. It is a live, unauditable AI endpoint on the production project.

## Recommendation

**Retire it.** Restoring source for review is not warranted: nothing calls it, and the current AI function family supersedes it.

Dan-gated action (production change — do not run without approval):

```
supabase functions delete ai-refine-ad-copy --project-ref <prod-project-ref>
```

Afterward the hosted count should equal the local count, and the desired-vs-hosted function inventory (Batch 14 generated release state) will pass with the local `supabase/functions/` directories as the complete expected set.

## Interim safeguard (no deploy needed)

None required beyond existing platform auth: the audit's live probe of hosted functions returned 401 for unauthenticated calls. If deletion is deferred, treat any `ai_generation_costs` / usage rows attributable to `ai-refine-ad-copy` as a red flag worth immediate investigation, since no legitimate client sends traffic to it.
