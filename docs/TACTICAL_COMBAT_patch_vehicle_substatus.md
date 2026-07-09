# Patch: Vehicle Sub-Status System → Existing Tactical Combat Implementation

> Delta doc only — assumes the pre-sub-status build already implemented per the original
> `TACTICAL_COMBAT.md`. Full spec lives in that document's **Armour Penetration System** and
> **Vehicle Sub-Status System** sections; this file is just "what to touch, and where."

---

## 1. What's new, in one paragraph

A grid cell (not each individual vehicle in it) can now carry up to four independent status
flags — **Mobility, Firepower, Armour, Optics** — triggered deterministically by the existing
pen-ratio table plus one new weapon-category rule. No new RNG. No sub-unit tracking. Clears
via the same supply-recovery path HP already uses.

---

## 2. Data model

Add to the per-cell unit state (wherever HP/suppression/experience-tier currently live):

```
status_multipliers: {
  mobility_immobilized: boolean   // true/false, not a multiplier — see §3
  firepower_mult: float           // starts 1.0, multiplies down on trigger
  armour_mult:    float           // starts 1.0, multiplies down on trigger
  optics_reach_reduction: int     // starts 0, +1 per trigger (not multiplicative — it's a
                                   // row/column count, so it's additive by nature)
}
```

**Mobility is boolean, not a multiplier** — a cell either can reposition or it can't; there's
no "60% mobile." Firepower and Armour store the *running* multiplier (not just a flag),
since repeated triggers stack multiplicatively (`0.8 × 0.8 = 0.64`) — store the product, not
a hit counter, so damage resolution just multiplies by whatever's currently there.

---

## 3. Resolution logic — where the hooks go

**Extend the existing pen-ratio lookup** (wherever `< 60% / 60–69% / 70–79% / 80–89% /
90–99% / ≥100%` currently maps to damage %) to also return a status effect:

| Ratio tier | Damage (unchanged) | New: status triggered |
|---|---|---|
| <60% | 0% | none |
| 60–69%, 70–79% | 20%, 30% | `mobility_immobilized = true` |
| 80–89%, 90–99% | 40%, 70% | `firepower_mult *= 0.6` (illustrative — exact value playtesting-bound) |
| ≥100% | 100% | none (normal HP damage already covers it) |

**New trigger, not from the pen table:** any HE/fragmentation-type attack (artillery, bombs —
i.e. anything that isn't an AT pen-ratio roll) that hits a cell without destroying it →
`optics_reach_reduction += 1`.

**New trigger, repeat-hit rule:** any hit landing on a cell that already has *any* non-zero
status from a previous hit this engagement → `armour_mult *= 0.85` (illustrative) in addition
to whatever else that hit triggers.

All four are lookups against data that's already computed (pen ratio, weapon category, "has
this cell been hit before") — no new combat sub-system, just extra branches off resolution
paths that already exist.

---

## 4. Where each flag needs to be consulted

| Flag | Existing system to hook into | Change |
|---|---|---|
| `mobility_immobilized` | Reposition/movement-during-combat logic | Block reposition entirely while true |
| `firepower_mult` | Outgoing HP-damage calculation for this cell | Multiply final damage output by `firepower_mult` |
| `armour_mult` | Incoming pen-ratio calculation (this cell as defender) | Multiply this cell's armour value by `armour_mult` before computing attacker's pen ratio |
| `optics_reach_reduction` | Attack pattern row/column reach (per archetype) | Reduce reach by this count before resolving the pattern |

---

## 5. Recovery

No new mechanic. All four fields reset to default (`false` / `1.0` / `1.0` / `0`) under the
exact same condition HP already recovers under: division not engaged + supply reaching it.
If the division is destroyed while a cell carries any active status, that cell is lost with
it — same rule already governing Incapacitated units.

---

## 6. UI — fits into the existing ambient/hover/click layering, no new pattern

Per `UI_UX_DESIGN.md` §7's established convention (ambient = always visible, hover = detail,
click = full profile), slot sub-status in exactly there rather than inventing a fourth
visual language:

**Ambient (on the cell itself, ambient, no hover needed):**
A small icon cluster in one consistent corner of the cell (pick the corner not already used
by the experience-tier badge), one glyph per *active* flag only — nothing rendered for a
clean cell, so the common case stays visually quiet. Suggested glyphs, consistent with the
project's existing symbolic language (Kessel ring, broken chain, crossed swords):

| Flag | Suggested glyph |
|---|---|
| Mobility | Broken track/wheel icon |
| Firepower | Crossed-out gun/turret icon |
| Armour | Cracked shield icon |
| Optics | Cracked crosshair/eye icon |

Multiple simultaneous flags = multiple small icons in that same cluster, same "stacks
cleanly, most-severe-first" principle `STRATEGIC_COMBAT.md`'s Division Status Visual
Indicators already uses for strategic-map icons.

**Hover:** exact current value per active flag — e.g. "Firepower ×0.36 (2 hits)," "Optics:
attack reach −2." Same conditional-reveal principle as the existing attack-pattern hover
overlay: ambient tells you *that* something's wrong, hover tells you *how much*.

**Click:** surfaces in the existing **Unit Profile** component (`UI_UX_DESIGN.md` §6.6) —
not a new panel. Same reuse pattern already established for every other per-unit detail
view.

**One future-proofing note:** if air wings' equivalent Wing Sub-Status system (Engine/
Weapons/Fuel tank/Instruments, per `AIR_COMBAT.md`) get built later, reuse this exact same
ambient-icon-cluster + hover + Unit-Profile-click pattern for wings — the mechanic is
already designed to mirror 1:1 between the two, the UI should too.

---

## 7. Implementation checklist

- [ ] Add `status_multipliers` fields to per-cell unit state schema
- [ ] Extend pen-ratio lookup table with the status-trigger column (§3)
- [ ] Add HE/fragmentation → Optics trigger (non-AT weapon category check)
- [ ] Add repeat-hit → Armour trigger (requires "has this cell been hit before" flag per
      engagement)
- [ ] Hook `mobility_immobilized` into reposition logic
- [ ] Hook `firepower_mult` into outgoing damage calculation
- [ ] Hook `armour_mult` into incoming pen-ratio calculation
- [ ] Hook `optics_reach_reduction` into per-archetype attack pattern reach
- [ ] Reset all four fields on the existing HP-recovery-via-supply path
- [ ] Ambient icon cluster on `UnitGlyphCell` (or equivalent), one glyph per active flag
- [ ] Hover tooltip showing exact current multiplier/value per active flag
- [ ] Wire into existing Unit Profile component on click — no new panel

### Verification gate
AT gun scores a 65% pen-ratio hit on a tank cell → 20% HP damage applied → cell shows
Mobility icon → cell cannot reposition → cell still deals full damage (Firepower untouched).
Second AT hit on the same cell at 85% ratio → 40% HP damage → Firepower icon added,
`firepower_mult = 0.6` → cell's outgoing damage drops to 60%. Artillery HE hit on a cell that
survives → Optics icon added → that cell's attack pattern reach reduced by 1 row/column.
Third hit of any kind on the same already-flagged cell → Armour icon added, `armour_mult`
multiplies down → subsequent incoming pen-ratio rolls against this cell succeed more easily.
Division holds position, receives supply, disengages → all icons clear, multipliers reset to
1.0. Division destroyed while a cell carries active flags → that cell's experience and status
are both lost, consistent with Incapacitation's existing "only kept if the division survives"
rule.
