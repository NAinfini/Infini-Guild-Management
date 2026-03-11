# Guild War (`/guild-war`)

@FEATURE: GUILD_WAR
@ROLE: External (read-only, Analytics allowed), Member, Moderator, Admin
@REALTIME: PUSH_ENABLED (< 2s for Active tab)

## Summary

Guild war management with three tabs: Active (setup + team assignment), History (archived wars + stats), and Analytics (LoL-style historical analytics). guild war are events, there could be multiple war going on

## Data (v1)

- Event signup list: `event_participants`
- Guild war teams/pool (Active + saved snapshots): `war_history`, `war_teams`, `war_team_members`, `war_pool_members`
## Tabs

### Tab 1: Active guild war events

@FEATURE: GUILD_WAR_ACTIVE

#### Layout

- Top: Dropdown selector to pick which guild war event to manage (shows all active/upcoming guild_war events by start date)
  - Default: most recent active guild war event
  - Shows: event title + start date + participant count
  - Only guild_war type events appear here
- For the selected guild war event:
- 2 columns:
  - Left: Pool (Signups) — unassigned members
  - Right: Teams board (multiple team panels)
- Mobile: stacked sections + collapsible team panels; long-press drag

#### Pool + Teams Rule (non-negotiable)

- Each guild war event has ONE Pool + multiple Teams
- Pool members are members who signed up for guild war event, but not assigned to any teams.
- A member appears EXACTLY ONCE across Pool + Teams 
- Admin/Mod can: move between teams, move back to pool, force-add/remove from pool

#### Member Cards (Compact, No Avatar)

- Fields: username | class | power
- Background tint by base class group (4 colors only, subclasses share parent color):
  - MingJin (鸣金虹, 鸣金影): blue
  - QianSi (牵丝玉, 牵丝霖): green
  - PoZhu (破竹风, 破竹尘, 破竹鸢): purple
  - LieShi (裂石威, 裂石钧): dark red
- Single click selects; double click -> MemberDetailModal (read-only version of the one in admin-console) (Admin/Mod only)

#### Sorting (View-only, Not Persisted)

- Pool + each Team: sort by Power (default desc), Username, Class (group)
- Client-side only, not apply to server

#### Drag & Drop (dnd-kit)

- Pool -> Team, Team -> Team, Team -> Pool (unassign)
- Drop-zone glow + insertion indicator
- Undo snackbar after moves(not implement move untill undo snack bar disappears)
- Each move is a discrete mutation; if fails, snap back + show toast
- allow drag drop multiple members, use ctrl and shift to select multiple users, selected user are highlighted.

#### Role Assignment (Teams Only)

- `role_tag` is ONLY used in Guild War, ONLY editable inside Teams
- Cards show small role_tag chip
- Pinned common roles bar per team (DPS / Heal / Tank / lead)
- Click = assign to selected member

#### Team Header Controls

- Inline rename + team reorder handle
- Sort (Power / Username / Class)
- Copy (members / label + members wechat name, fallback to username @name)
- Lock toggle (prevents drops, role assignment, rename)

#### Team Notes (Admin/Mod)

- 1-2 line note per team (e.g., "rush left / defend mid")
- Visible to all, editable by Admin/Mod
- Saved into war history snapshot

#### Search + Quick Jump

- One search box across Pool + all Teams
- Highlights matches (does not filter by default)
- Next/Prev match jumps: auto-scroll + pulse/glow matched card

#### Copy Tools

- Uses wechat_name default; fallback username
- Label + members: `Team A: @a, @b, ...`

#### Save Teams to History (Admin/Mod)

- One button: "Save Teams to History"
- **Overwrite semantics:** If a `war_history` row already exists for the selected guild war event (`war_history.event_id`), overwrite the teams/pool snapshot (teams, pool members, role_tag, team notes, team name). Any stats already entered on the existing history entry are preserved.
- If no history entry exists for this event, create a new `war_history` row.
- One event → one history entry (1:1 relationship via `event_id`).
- Results/stats can be filled later in History tab

#### Bot Integration (Active Tab)

- "Post to Discord" button: posts formatted team comp to Discord team-comp channel (see `bot-integrations.md`)
- "Post to WeChat" button: posts team comp with @mentions to configured WeChat group
- Both buttons only visible if bot is configured in Admin Console → Bot Settings
- Buttons appear after teams are assigned (not on empty pool)

---

### Undo Mechanism

**Specifications:**
- **Scope:** Last move only (single or multi-member drag counts as ONE undo unit)
- **Batch undo:** When multiple members are dragged together (ctrl/shift select), the entire batch reverts as one unit — not individual members
- **Timeout:** 5 seconds (user can see countdown)
- **UI:** Snackbar showing "↶ Undo (5s remaining)" with member count if batch (e.g., "↶ Undo 4 members (5s)")
- **Auto-dismiss:** After 5 seconds, undo option disappears and the move is committed to server

**Implementation:**
```typescript
showUndoSnackbar(memberId, from, to);
```

**Concurrent Edit Detection:**
- Use `updated_at` ETag (single source of truth for freshness/concurrency)
- Optimistic locking: each move includes expected `updated_at` (ETag) for the `events` row (guild_war type)
- If conflict: return `409 CONFLICT` + message "Another mod just changed the war. Refresh?"
- User can choose: Refresh or Force Override

---
### Tab 2: History (Archived)

@FEATURE: GUILD_WAR_HISTORY

Allow creation of history from nothing.
#### War List

- Default: recent wars (card list)
- Filters: date range
- Show chip: "Missing: N" if member stats incomplete
- Members/External: view-only; Admin/Mod: edit
- Cache immutable historical data

#### War Detail (Scannable)

Summary uses Own vs Enemy (both sides always shown):
- kills, towers destroyed, base HP remaining, distance moved
- total credits per side

Highlights:
- MVPs: highest damage / healing / building damage
- Overall top K/D/A

Sections:
1. Overview (result + notes)
2. Member stats (cards; sortable/filterable)
3. Team snapshot (teams + role_tag + team notes)

#### Bot Integration (History Tab)

- "Post Results to Discord" button on war detail: posts war results summary embed (see `bot-integrations.md`)
- Only visible if Discord bot is configured

#### Member Stats data table

- username + class, K/D/A, damage / healing / building_damage / credits damage_taken, note
- Admin/Mod: edit stats + note in-place
- Sort (client-side): damage, healing, building, credits, KDA, username
- Search: username

#### Incomplete Data Indicators

- War list + detail show "Missing: N"
- Incomplete cards get outline + tooltip listing missing fields
- Charts use missing gaps (never 0-fill)

#### Chart:

- Toggle button to switch between table view and chart view
- Chart type: horizontal bar chart (ECharts)
  - Y-axis: member usernames
  - X-axis: selected stat value
  - Bars colored by class group (blue/green/purple/red)
- Checkbox group to select which stats to display (damage, healing, building_damage, credits, kills, deaths, assists)
- One chart per selected stat (stacked vertically)
- Missing data: show gap in bar (never 0-fill)
---

### Tab 3: Analytics (Historical, LoL-style)

@FEATURE: GUILD_WAR_ANALYTICS  
@ACCESS: External read-only, Member / Moderator / Admin

#### Purpose
Analytics answers:
- **Player progression:** view **one member’s stats across multiple wars**
- **Member comparison:** compare selected members across selected wars
- **Rankings:** top performers for a metric over a war range
- **Team comparison:** team totals/averages over time (from snapshots)

> Historical-only: immutable mindset, **no push**, heavy caching with ETag.

---

#### Core Concepts (supports real workflows)
Analytics always operates on:
1) **War Set**: which wars are included (date range, tags, manual selection)  
2) **Subject Set**: who/what is analyzed (one member, many members, teams)  
3) **Metric Set**: what is measured (damage/healing/building/credits/KDA/etc.)  
4) **Aggregation**: per-war values vs across-wars rollups (total / average / best / median)  
5) **Participation filter**: include only wars where the subject participated (default)

---

#### Page Layout (built for “one member” + “compare members”)
Cache immutable historical data
##### A) Top “Mode Strip” (LoL-style tabs)
Modes define the workflow:

1. **Player** (single member focus; best for “one member across many wars”)
2. **Compare** (multi-member trend lines + summaries)
3. **Rankings** (Top N; fastest “who’s best”)
4. **Teams** (team aggregates using snapshots)

Default mode: **Player**

---

##### B) Global Filter Bar (always visible)
- Date range presets: 
- War selector: multi-select, ordered by date
- Participation filter:
  - **Only wars where subject participated**
  - include non-participation wars (shows gaps)

---

##### C) Left Panel: Subjects (mode-dependent)

**Player mode**
- Search + select **one member** (username / wechat_name)
- Selected member header:
  - username, class
  - participated wars / selected wars count
  - Missing chip: `Missing: N` if incomplete stats exist

**Compare mode**
- Dense list with checkboxes (username + class + compact preview)
- Presets: Top Damage / Top Heals / Top Credits / Top Building
- Select all / Clear / Invert / Select by class
- Focus player mode:
  - click member => thicker/brighter line, others fade

**Rankings mode**
- Optional filters:
  - class filter
  - min participation threshold (e.g., “≥ 3 wars”)

**Teams mode**
- Select teams (from snapshots in selected wars)
- Toggle: total vs average

---

##### D) Center Panel: Visualization + Table fallback (required)
Always includes:
- Primary chart (mode-dependent)
- **Table fallback** (always shown / always accessible)
- Per-war context chips under chart:
  - hover => war summary (`WAR_RESULTS`)
  - click => open War History detail for that war

**Player mode**
- Timeline chart for a single member
  - X = wars chronological
  - Y = primary metric
- Optional overlays:
  - second metric (toggle)
  - moving average (optional)
- Missing data:
  - gaps/dashed segments, never 0-fill

**Compare mode**
- Trend chart
  - series = members
- Legend controls:
  - Click = Focus toggle
  - Alt/Option-click = Hide/Show series
  - Double click = Solo
  - Shift-click = Compare pair (pins two)

**Rankings mode**
- Bar chart Top N (Top 10 default)
- Aggregation selector:
  - Total / Average / Best / Median
- Optional expand: per-war breakdown

**Teams mode**
- Trend chart
  - series = teams (aggregate per war)
- Membership from saved snapshots

> Rule: every chart must have a paired table fallback (same data).

---

##### E) Right Panel: Metrics + Analysis Summary

**Metric controls**
- Metric toggles:
  - damage, healing, building_damage, credits
  - kills, deaths, assists
  - KDA (derived)
- Primary metric selector (drives main chart)

**Summary cards (mode-aware)**
Player mode:
- Best war (link)
- Average
- Trend direction
- Participation count
- Personal records

Compare mode:
- Top performer per metric (for selected wars)
- Variance/consistency indicator
- Participation differences
- Missing data warnings

Rankings mode:
- Top 5 snapshot + participation threshold indicator

**Per-metric “good direction”**
- Higher is better: damage, healing, building_damage, credits, kills, assists
- Lower is better: deaths
- KDA: higher is better (derived)

---

#### Key Workflows (explicitly supported)

1) **One member across many wars (Player mode)**
- Select member → select metric(s) → select wars  
- Output: timeline, best/avg/trend, best war link, missing gaps

2) **Compare members across wars (Compare mode)**
- Select wars → select members → select metric  
- Output: trend lines + focus member, aggregates (avg/total/best)

3) **Who’s best (Rankings mode)**
- Select wars → select metric → Top N  
- Output: ranked bars + aggregation + min participation filter

4) **Team comparison (Teams mode)**
- Select wars → select teams  
- Output: team totals/averages per war

---

#### Incomplete Data Rules (critical)
- Never 0-fill missing stats
- Show gaps/dashed segments in charts
- Show `Missing: N` chips on:
  - member rows
  - summaries that depend on incomplete stats
- Tooltips list missing fields

---

#### Selection Limits (safety rails)
- Soft cap: 10 members (Compare Trend) => warning + suggest Rankings
- Hard cap: 20 members in Compare Trend
- If cap exceeded:
  - suggest switch to Rankings

---

#### Color Rules
- Deterministic: `hash(user_id) -> palette index` (10–12 distinct hues)
- Class tint via subtle glow/outline on member row only (not chart lines)

---

#### Shareable Analysis Snapshot
- One-click "Copy analysis snapshot"
- Generates Discord-friendly text:
  - wars range
  - mode + primary metric + aggregation
  - top 5 (if Rankings or Compare)
  - focused member summary (if Player/Compare)
- Uses wechat_name default, fallback username
- Local-only formatting; no DB writes

---

#### Two-tier Fetch (cost-efficient)
- Tier 1: war list + `WAR_RESULTS` 
- Tier 2: `WAR_MEMBER_STATS` only after wars selected (heavy, ETag'd)

---

#### Performance
- No push needed (historical, immutable)
- `staleTime: Infinity`, `cacheTime: 600 min`


#### Permissions (Analytics)
| Action | External | Member | Moderator | Admin |
|--------|----------|--------|-----------|-------|
| View Analytics | YES | Yes | Yes | Yes |
| Filter wars | YES | Yes | Yes | Yes |
| Use compare/rank tools | YES | Yes | Yes | Yes |
| Copy analysis snapshot | No | Yes | Yes | Yes |

---


#### Audit (Analytics-adjacent)
Analytics is read-only, no audits

---

#### Loading & Empty States

- Skeleton loading for all chart/table areas
- **Zero war history:** friendly empty state — "No war data yet — record your first guild war to unlock analytics"
- **Member with no participation:** "No participation data for [username] in selected wars"
- **No wars match filters:** "No wars match your filters" + reset CTA

#### Freshness & Caching
Analytics is historical/immutable:
- **No push**
- **ETag required**
- `staleTime: Infinity`
- `cacheTime: 600 min`
- Optional: single refresh check on entry (ETag compare only)

---

#### Defaults (important)
- Default mode: **Player**
- Default metric: **damage**
- Default participation filter: **participated-only**
- Default aggregation (Rankings): **Total**

---
