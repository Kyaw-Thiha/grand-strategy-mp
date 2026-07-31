# Grand Strategy Multiplayer — Retention & Monetisation Design

> Internal reference. Companion to ARCHITECTURE.md — feed both to Claude Code when working
> on lobby, shop, ladder, or profile systems.
> Last updated: July 2026.

---

## Philosophy

Two constraints shape every decision in this doc, and they compound:

1. **No P2W, ever.** Paid features are about control, expression, and convenience — never
   in-game power. This is the core brand promise and the primary wedge against Call of
   War / Conflict of Nations.
2. **Post-1.0, this studio winds down active development on this title** and moves to new
   projects. Every retention/monetisation system here is chosen because it can run in a
   low-maintenance "autopilot" mode — automated season rotation, contractor-produced art,
   community-generated content — rather than requiring sustained design labor from a core
   team that won't exist anymore.

Anything that required either (a) ongoing balance/mechanic design work, or (b) a subscription
relationship implying ongoing service delivery, was deliberately cut. See "Explicitly Cut"
at the end of this doc.

---

## Pricing Structure

| Tier | What you get | Price | Model |
|---|---|---|---|
| Free | Join public games, random nation, full complete game | $0 | — |
| Host Pass | Create private/open lobbies, deliberate nation choice for **everyone** in your lobby (any nation on the map) | ~$10–15 | One-time, forever |
| Nation Packs | Deliberate-choice unlock + themed cosmetic skins for **regional/minor nation bundles** (e.g. "Balkans", "Nordic") | TBD, tiered by bundle size | One-time |
| Major Nation Cosmetics | Pure cosmetic skins for core-roster majors (Germany, USSR, USA, UK, Japan, etc.) — access already free/pass-covered | TBD, low price point | One-time |
| Ladder Season Pass | Cosmetic-only track unlocked via ladder participation/rank each season | TBD, low price point | One-time per season |
| Cosmetic Marketplace | Player-to-player resale + community-created skins, revenue share to creators | Market-priced | Per-transaction |

**No subscription tier.** See "Why No Subscription" below.

### Why This Split Works

- The **Host Pass** is priced and framed like a Jackbox Games party-pack purchase: one
  person in a friend group buys it, everyone they invite gets the full deliberate-choice
  experience for free. This is not a loophole to patch — it's the intended acquisition
  model. Jackbox has run exactly this shape profitably for a decade (only the host needs
  to own the game; guests join free). Price the pass for what a whole table gets, not
  what one player gets.
- Because full nation choice within a paid lobby is *unrestricted*, there's no hidden
  second paywall inside a lobby someone already paid to create. This matters for trust —
  our exact audience is fleeing games that nickel-and-dime inside features they already
  paid for.
- Because access is free (public matchmaking, random nation) or already unlocked (any
  nation, inside a paid lobby), **all further monetisation is purely cosmetic and
  account-bound** — nation packs, major cosmetics, and the ladder pass never touch what
  a player is allowed to do, only how it looks and what personal progression they've
  built up.

### Why No Subscription

Considered and rejected, for three compounding reasons:

1. **Retention is genuinely unproven for this genre-shape.** War of Dots (closest
   comparable — free, session-based, minimalist strategy) went from a 2,542 CCU peak to
   ~390 CCU (an 85% decline) within about five months of launch. A subscription bets
   revenue on sustained engagement past the honeymoon period; a one-time purchase banks
   revenue at peak intent (the moment a friend group decides to commit) regardless of
   what happens to retention later.
2. **It conflicts with the wind-down plan.** Subscriptions carry an implicit promise of
   continuous new value. A subscriber paying monthly during a "maintenance mode" period
   with no new mechanics is a much angrier customer than a one-time buyer who still gets
   to host games with friends indefinitely.
3. **It's a worse fit for the actual buyer.** The paying segment is friend groups who
   want to play together — closer to "buy the board game" than "subscribe to a service."

---

## Lobby Types

Three lobby types, extending the existing binary `private: boolean` model into a
visibility axis that's orthogonal to who gets deliberate nation choice:

| Type | Created by | Listed in `/lobby/public`? | Nation choice |
|---|---|---|---|
| **Public Matchmaking** | System-generated / auto-filled | Yes | Random (or Featured Nation, see below) |
| **Private Lobby** | Host Pass holder, invite link only | No | Deliberate, any nation, for all invited players |
| **Open Lobby** *(new)* | Host Pass holder, invite link + public visibility | Yes | Deliberate for invited players; random (or Featured Nation) for public joiners filling remaining seats |

### Why Open Lobby Matters

This directly targets the studio's #1 stated risk: discoverability / lobbies dying from
lack of real players. Right now every Private Lobby *removes* real humans from the public
pool entirely. Open Lobby lets a host reserve N seats for their invite link and leave the
rest open to public join — so a friend group of 4 waiting on a no-show 5th/6th player
gets backfilled by the matchmaker instead of the game running short-handed, and the
public matchmaking pool gets access to livelier, more-invested games (a lobby anchored by
an engaged friend group is likely a *better* public game to land in than a fully random one).

**Implementation notes:**
- Host sets `reserved_seats` (invite-link only) vs. open seats at creation time.
- Matchmaker should prefer filling existing Open Lobbies over spinning up fresh public
  rooms — fewer, fuller games reads as a livelier community than many half-empty ones.
- Host retains kick/ban rights over public joiners in their Open Lobby, same as in a
  Private Lobby.

---

## Nation Access Model

Resolved tension: full nation choice, any nation, for **anyone inside a lobby the host
has already paid to unlock** (Private or Open). Restricting *which* nations that covers
would be a hidden second paywall inside a feature already paid for — bad for trust, and
unnecessary once monetisation moved entirely to cosmetics.

- **Core-roster majors** (Germany, USSR, USA, UK, Japan, France, Italy — final list TBD):
  access is free/pass-covered everywhere. Cosmetics for these nations are sold as
  standalone SKUs (Germany alone can support 3-4 skin variants), purely aesthetic,
  no bundling required.
- **Minor/regional nations**: access is free inside any paid lobby (per above). Nation
  Packs bundle a themed cosmetic skin set for a regional grouping (e.g. "Balkans":
  Yugoslavia, Romania, Bulgaria, Hungary; "Nordic": Finland, Norway, Sweden, Denmark) —
  anchored around a historical/thematic narrative, never around bundling a major with
  minors to force a purchase decision. This avoids the cannibalisation problem where
  bundling, say, all Axis nations together sells well but starves every other regional
  pack.
- **Public matchmaking / free tier**: always random nation, except for the Featured
  Nation (below).

### Featured Nation Rotation

A rotating nation (weekly or bi-weekly cadence) that any public/random-join player can
*deliberately* pick, instead of receiving a fully random draw. Cheap to implement (a
config value, no new systems) and does three things at once:

1. Softens the free tier's "always random" experience without touching Nation Pack
   economics — it's transient, never a permanent unlock.
2. Gives the "build in public" marketing motion a free weekly content beat (dev
   diary / Discord / Twitter post material).
3. Functions as a soft, non-manipulative upsell moment — a player who enjoys
   deliberately playing the Featured Nation has just previewed what the Host Pass /
   Nation Packs give permanently, without ever being blocked from anything.

---

## Cosmetics & Community Marketplace

Extends the already-planned player-to-player resale system to include **community-created**
cosmetics, not just resale of existing items — modeled on Valve's Steam Workshop economy
(Team Fortress 2 / Dota 2 / CS2), which has paid out **over $57 million to 1,500+
contributors across 75 countries** with essentially zero central design burden per item.
This is the primary mechanism for keeping cosmetic content flowing after the core team
winds down.

**Commitments, given our ethics-first positioning:**
- **Fixed, publicly stated, never-reduced revenue share for creators.** Valve quietly cut
  Dota 2 creator share from ~25% down to ~6% over time, which badly damaged creator trust.
  We commit to a stated percentage in writing and don't erode it.
- **No randomised loot boxes / cases.** CS2's cosmetic economy is enormous, but a large
  share of that scale comes from gambling-adjacent case-opening mechanics and third-party
  skin-gambling markets — exactly the predatory territory we're positioned against.
  Direct purchase and player-to-player marketplace only.
- Community submissions reviewed for quality/IP compliance, but no gameplay-affecting
  submissions accepted (cosmetic only, enforced at the schema level — see
  `shop_items.type` in DATA_CONTRACTS.md).

---

## Ladder & Season System

**Problem with a naive win/loss ladder:** nation assignment is random and nations aren't
balanced. A simple Elo system would punish the luck of the draw (surviving as Luxembourg
vs. winning as a major power are very different achievements), which contradicts the
"casual players can get in" positioning and the "minor nation problem" fix.

**Design: Performance Score, not Win/Loss.**
Score each session relative to the player's *starting* position — territory held/lost
relative to baseline, economic output relative to nation baseline, survival to session
end, diplomatic achievements (alliance formed, negotiated peace, etc.). This lets a
minor-nation player who punched above their weight rank well even in a loss, and rewards
skillful minor-nation play specifically — directly supporting the minor-nation-relevance
goal.

**Season structure:**
- 4–6 week seasons (long enough to matter, short enough that missing a few weeks isn't
  fatal to standing).
- Soft rank reset each season.
- Cosmetic-only seasonal rewards tied to rank tier (seasonal skin, profile flair) —
  never a gameplay advantage. This is structurally similar to Conflict of Nations'
  "Seasonal Units" mechanic, but **explicitly not a copy of it** — CoN's seasonal units
  are real combat units with stats, gated behind a paid subscription + grind, which is
  literal pay-to-win and exactly what our target audience is fleeing. We reuse only the
  *shape* (time-limited season → engagement + payment → permanent unlock), never the
  power.
- Leaderboards segmented by region/skill tier so newer players see attainable
  competition, not just the top 0.1%.
- No daily-login timers, no FOMO countdown mechanics, no punishing absence.

**Competitive strategy note:** shipping a ladder/season system *at launch* is a real point
of differentiation. Board Game Arena's ranked "Arena mode" and Slitherine's Panzer
Corps/Order of Battle community have both shown multi-year unmet demand for exactly this
feature in adjacent genres — Panzer Corps players were requesting a ladder for 4+ years
before Order of Battle finally shipped a rating system. Launching with this solved is
a rare place to be ahead of established genre veterans, not behind them.

---

## Persistent Group Identity ("War Room")

Free, lightweight, account/Supabase-layer only — does **not** require a persistent
simulated world and has no tension with the ephemeral Colyseus room architecture.

- A named, standing group tied to a host account: emblem/banner (can double as a
  cosmetic slot), member roster, join history.
- Session-history log per group: past maps played, outcomes, simple per-member stat
  lines over time.
- Head-to-head rivalry tracking between specific members.
- Optional lightweight built-in scheduling ("propose next session, members vote on a
  time") — reinforces the core "no scheduling pain" pitch at the exact moment retention
  is decided (the gap between "that was fun" and "when do we play again").

**Validated by Call of War/Conflict of Nations:** their persistent Alliances (which
outlast any single match round) are the retention engine that keeps players in a game
whose monetisation they actively resent. The lesson: persistent social structure, not
the core map-painting loop, is what makes people stick around — and it costs nothing to
build relative to what it retains.

**Explicitly separate from Campaign Mode** (see below) — this is pure social/organisational
scaffolding, not narrative content, and ships as part of core 1.0/retention scope.

---

## Post-1.0 Content Policy (Wind-Down Plan)

Given the studio's plan to wind down active development after 1.0 and move to new
projects, content levers are split by ongoing labor cost:

### Low-maintenance, keep running indefinitely
- **Ladder/season rotation** — mostly automatable once built (season reset, leaderboard
  segmentation); minimal ongoing design work.
- **Cosmetic season drops** — art production via contractor retainer or community
  marketplace, not core design labor.
- **Community cosmetic marketplace** — self-sustaining once launched; requires light
  moderation/curation, not design work.
- **Rebalance patches** — necessary hygiene, not a growth lever. Scope as something a
  single part-time contractor can handle off telemetry (win-rate-by-nation dashboards),
  bundled into the same release cadence as cosmetic season drops rather than run as a
  separate maintenance track.

### One bounded final expansion, then stop
- **New mechanics/units** (e.g. a Naval or Air layer, if not already in 1.0): decide on
  ONE scoped expansion to ship before wind-down, then draw a hard, publicly-stated line.
  Communicating "this is the last major systems update" openly is a strength given our
  transparency-first brand, not a weakness — vague abandonment is what burns trust, not
  an honest, stated roadmap that ends on purpose.

### New maps: free, occasional, historically bounded — not the primary monetisation vehicle
- The flagship/global map will dominate playtime regardless of what else ships — both
  Call of War and Conflict of Nations treat their default world map as the centerpiece,
  with regional scenarios as secondary variety, not the reverse.
- Therefore new maps should NOT be the primary paid content lever (see Nation Packs
  above, which decouple monetisation from map production entirely).
- Avoid alternate-history content: Kaiserreich-style alt-history is community IP, not
  legally ours to reuse, and an original alt-history universe requires real worldbuilding
  investment (consistent lore, new flags/portraits, new focus trees) — a bad fit for a
  winding-down studio.
- Cheaper alternative, if new maps are made at all: underused **real** historical
  theatres (Mediterranean/North Africa, Pacific, Winter War, Balkans) or **point-of-
  divergence scenarios** on the real map with real nations (e.g. "Czechoslovakia fights
  in '38") — much lower authorship burden than inventing a new universe.

### Explicitly Cut
- **Gameplay mod support.** Multiplayer-synchronous sessions require matching state
  across the whole lobby — a real liability for desync/matchmaking fragmentation.
  HoI4's mod ecosystem works because it's singleplayer/host-controlled; doesn't
  transfer here. (Cosmetic community content, which doesn't require lobby-wide sync,
  is kept — see Marketplace above.)
- **Subscription tier.** See "Why No Subscription" above.
- **Campaign Mode (narrative-linked session chaining).** Reframed as a *separate, later,
  separately-priced expansion* — a large scope item (persistent narrative state, focus-
  tree-style branching consequences across sessions) that doesn't fit the "low investment,
  low guaranteed quality post-wind-down" constraint. Not part of core retention design.
  If pursued, treat as new-studio-scale IP work, not a patch to this game.
- **Randomised loot boxes / gambling-adjacent cosmetic mechanics.**

---

## Market Research Log (Retention-Specific Findings)

Condensed record of the comparative research that informed the above, for future
reference. Full detail in conversation history; key facts below.

| Game | Finding | Relevance |
|---|---|---|
| War of Dots | Peaked 2,542 CCU (Feb 2026), down to ~390 CCU by July 2026 (-85%). Recent review sentiment (78%) softer than lifetime (81%). Root causes: P2P-style lag scaling with player count, shallow 2-unit-type meta solved quickly, no team modes/custom maps, privacy concerns raised in reviews. | Nearest comparable (free, session-based, minimalist strategy). Proves genre curiosity spikes but doesn't by itself prove retention. Our architecture (authoritative Colyseus server) structurally avoids the lag-scaling failure mode; our economy/diplomacy depth is the direct counter to the shallow-meta failure mode — but both need real playtesting, not just design-doc confidence. |
| Foxhole | Launched 2022 at 11,778 CCU peak; still averaging ~2,449 CCU and peaking 17,704 CCU four years later (2026). Retention driven by recurring "wars" that end decisively then restart, plus persistent faction identity. | Proof that decisive session closure + a recurring structural rhythm (not a one-off payoff) sustains a multi-year audience. Informs the season/ladder cadence. |
| Call of War / Conflict of Nations | Actively resented for P2W in its own reviews, yet retains players via persistent Alliances/Coalitions that outlast any single match. Seasonal Units mechanic gates real combat-stat units behind subscription + grind — literal P2W, explicitly not to be copied. | Validates persistent group identity (War Room) as a retention lever independent of core-loop quality or monetisation fairness. Cautionary tale on what NOT to copy from an otherwise-informative competitor. |
| Slitherine (Panzer Corps / Order of Battle) | Asynchronous PBEM++ multiplayer (turns submitted on players' own schedule). Community requested a competitive ladder for 4+ years before Order of Battle's first rating system shipped. | Second independent confirmation (with Board Game Arena) of unmet demand for ranked ladders in genre-adjacent wargames. Shipping this at launch is a real differentiator. |
| Board Game Arena | Seasonal ranked "Arena mode" + persistent private "Clubs" for recurring friend groups. (Note: some secondary sourcing on BGA had unverifiable SEO-generated stats; only the structural pattern — not specific numbers — is relied upon here.) | Template for splitting retention into a solo ladder loop and a group/club loop. |
| Steam Workshop (TF2/Dota2/CS2) | Over $57M paid to 1,500+ creators across 75 countries. Dota 2 creator share ~25% (though Valve controversially cut this toward ~6% over time in the past, damaging creator trust). CS2 cosmetic economy reportedly ~$610M profit in H1 2024, substantially built on randomised case-opening mechanics. | Proof case for community-created cosmetic economies as a near-zero-maintenance content engine. Directly informs the marketplace revenue-share commitment and the explicit avoidance of loot-box mechanics. |
| Jackbox Games | 10+ year business built entirely on "one host buys, guests join free." Priced $9.99–$29.99 per copy, reflecting group value not per-player value. | Direct precedent resolving the "friend groups only need one payer" concern — validated as a feature of the model, not a flaw to patch. |
| Systemic War (competitor watch) | New grand-strategy/RTS/diplomacy title adding multiplayer via playtest Aug 2026, full release Q4 2026. Premium, campaign-driven singleplayer-first design (alternate history 2008–2025), MP bolted on. | Not a direct competitor to our short-session/ethical-monetisation/MP-first positioning, but worth tracking for overlap in the "diplomacy + macroeconomy + RTS battles" combination. |

**Net conclusion carried into design:** genre-level demand and specific pain points
(scheduling, desync, P2W, minor-nation irrelevance) are well-evidenced. Retention is the
open risk — not disproven, but not proven either. The systems in this doc (ladder/season,
War Room, Featured Nation, Open Lobby) are the direct, evidence-informed response to that
specific risk, chosen because each one also fits the low-maintenance/wind-down constraint.
