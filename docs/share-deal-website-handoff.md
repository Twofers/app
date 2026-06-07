# Share Deal — Website route handoff

**Target repo:** [`Twofers/v0-twofer-landing-page`](https://github.com/Twofers/v0-twofer-landing-page)
**Route to add:** `https://www.twoferapp.com/s/[shareCode]`
**App side:** implemented on branch `feature/share-deal-mvp` in the TWOFER app repo (migration `20260710120000_deal_shares.sql`).

This doc is paste-ready. The mobile app generates a 7-character uppercase share code, stores it in `public.deal_shares`, then opens the native share sheet with a link to this route. When the recipient visits the route, the page calls a single Supabase RPC that **returns the share status/deal preview and increments open counters atomically for found shares** — no separate write call is needed.

---

## 1. Environment variables

Add to `.env.local` in the landing-page repo:

```bash
NEXT_PUBLIC_SUPABASE_URL=<same value used by the mobile app>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<same anon key used by the mobile app>
```

The `lookup_deal_share` RPC is `GRANT EXECUTE ... TO anon`, so the public anon key is sufficient. No service role key on the web side. The website should call the RPC and should not query `deal_shares` directly.

## 2. Supabase client (one-time)

`lib/supabase.ts`:

```ts
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
```

## 3. The route

Assuming the landing page is Next.js App Router (v0 default). Path: `app/s/[shareCode]/page.tsx`.

```tsx
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";

type DealShare = {
  share_status: "invalid" | "not_found" | "expired" | "valid";
  share_code: string | null;
  deal_id: string | null;
  deal_title: string | null;
  deal_description: string | null;
  deal_start_time: string | null;
  deal_end_time: string | null;
  deal_max_claims: number | null;
  deal_price: number | null;
  deal_poster_url: string | null;
  deal_poster_storage_path: string | null;
  business_name: string | null;
  business_address: string | null;
  business_location: string | null;
  business_phone: string | null;
  business_hours_text: string | null;
  business_logo_url: string | null;
  opened_count: number | null;
};

export const dynamic = "force-dynamic"; // counters must run on every request
export const revalidate = 0;

async function fetchShare(shareCode: string): Promise<DealShare | null> {
  const { data, error } = await supabase
    .rpc("lookup_deal_share", { lookup_code: shareCode })
    .maybeSingle();
  if (error || !data) return null;
  return data as DealShare;
}

function formatWindow(start: string | null, end: string | null): string | null {
  if (!end) return null;
  const fmt = new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
  const endStr = fmt.format(new Date(end));
  if (!start) return `Ends ${endStr}`;
  const startStr = fmt.format(new Date(start));
  return `${startStr} – ${endStr}`;
}

export default async function ShareLandingPage(
  { params }: { params: { shareCode: string } },
) {
  const share = await fetchShare(params.shareCode);
  if (!share || share.share_status === "invalid" || share.share_status === "not_found") notFound();

  const dealTitle = share.deal_title ?? "A local deal";
  const businessName = share.business_name ?? "a local cafe";
  const timeWindow = formatWindow(share.deal_start_time, share.deal_end_time);
  const isExpired = share.share_status === "expired";

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <p className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
        Someone shared a TWOFER deal with you
      </p>

      <h1 className="mt-4 text-3xl font-extrabold leading-tight">
        {dealTitle}
      </h1>
      <p className="mt-2 text-lg font-semibold text-orange-500">
        at {businessName}
      </p>

      {timeWindow ? (
        <p className="mt-4 text-sm text-neutral-700">{timeWindow}</p>
      ) : null}
      {share.deal_max_claims ? (
        <p className="mt-1 text-sm text-neutral-700">
          Limited to {share.deal_max_claims} claims
        </p>
      ) : null}

      <div className="mt-8 rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
        <p className="text-sm text-neutral-800">
          {isExpired
            ? "This TWOFER deal is no longer active."
            : "TWOFER is currently in private beta. We're launching first in Irving, Coppell, Grapevine, Carrollton, and nearby Dallas communities."}
        </p>
      </div>

      <a
        href="/waitlist"
        className="mt-6 block w-full rounded-xl bg-orange-500 px-5 py-4 text-center text-base font-bold text-white"
      >
        Join Customer Waitlist
      </a>
      <a
        href="/pilot"
        className="mt-3 block w-full rounded-xl border-2 border-orange-500 px-5 py-4 text-center text-base font-bold text-orange-500"
      >
        Request Pilot Access
      </a>
    </main>
  );
}
```

## 4. What the RPC returns

`public.lookup_deal_share(lookup_code text)` is `SECURITY DEFINER` with a locked-down `search_path`. On every call it:

1. Trims + uppercases the code.
2. Validates against the app's 7-character share alphabet (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`).
3. For found shares, bumps `opened_count`, sets `first_opened_at` if null, and updates `last_opened_at`.
4. Returns one status row joined with `deals` and `businesses` when found.

Returned columns:

```
share_status         text   -- invalid | not_found | expired | valid
share_code           text
deal_id              uuid
deal_title           text
deal_description     text
deal_start_time      timestamptz
deal_end_time        timestamptz
deal_max_claims      int4
deal_price           numeric
deal_poster_url      text
deal_poster_storage_path text
business_name        text
business_address     text
business_location    text
business_phone       text
business_hours_text  text
business_logo_url    text
opened_count         int4   -- post-increment value
```

If the code is malformed, the RPC returns `share_status = 'invalid'`. If the code does not exist, it returns `share_status = 'not_found'`. If the linked deal is inactive, scheduled for the future, or past `end_time`, it returns `share_status = 'expired'`.

## 5. Product rules to preserve

- **A share is not a transfer.** Never display or accept the sender's claim code on this page. The recipient must claim their own offer in the app.
- **No sender PII.** The RPC deliberately omits `shared_by_user_id`. Don't add a sender name lookup until consent semantics are worked out.
- **App store buttons:** none yet — the spec says private-beta CTAs only. Swap in store buttons after public launch.

## 6. Local testing without the mobile app

To create a share row by hand for local web testing, run this in Supabase Studio as the authenticated user (or via service role):

```sql
INSERT INTO public.deal_shares (share_code, deal_id, shared_by_user_id)
VALUES ('TEST7AB', '<a real deals.id>', '<a real auth.users.id>');
```

Then visit `/s/TEST7AB` locally.

## 7. Follow-ups (not in MVP)

- Universal Links / Android App Links / iOS associated domains so `/s/CODE` opens the app when installed.
- Open Graph / Twitter card metadata for richer link previews in iMessage / WhatsApp.
- Sender attribution (`"Dan shared a TWOFER deal with you"`) — requires expanding the RPC return to include a sender display name *and* a consent flag.
- Sharer attribution metrics surfaced to the merchant dashboard.
