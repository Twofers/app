# Product decisions — AI ads (locked for MVP)

| Topic | Decision |
|--------|-----------|
| **Regeneration cap** | **2** per draft. Revisit only after usage data. |
| **DB shape (headline / subhead / CTA)** | Separate columns long-term; **delay migration** until after validation. Listing still uses composed `description` until then. |
| **Profile fields** | **category, tone, location, short description** on `businesses` — **optional**, editable under Account. Do **not** block testing if empty. |
| **Moderation** | **Light automated checks** (prompt rules + owner review). **No** heavy moderation pipeline yet. |
| **Weak output** | **No** smart nudge system. Use **regenerate + edit + manual fallback** only. |
