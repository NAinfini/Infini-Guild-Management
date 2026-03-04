# Bot Integrations — Discord & WeChat (Dev Kit Aligned)

@FEATURE: BOT_INTEGRATIONS
@ROLE: Admin (configuration), All members (receive notifications)

## Summary

Bot integrations run on a dedicated **Bot Runtime** built with **Infini-Dev-Kit** (`bots-core`, `bots-discord`, `bots-wechat`).

The Cloudflare Worker remains the system of record (D1, RBAC, audit, admin UI). Worker and Bot Runtime communicate via authenticated internal APIs + task payloads.

This alignment is required because current dev kit adapters are long-lived client adapters (`discord.js`, `wechaty`), not Worker-only webhook handlers.

## Architecture

- **Cloudflare Worker (Guild Management API + Admin Console)**
  - Source of truth for members, events, war data, permissions
  - Stores bot config in D1
  - Produces bot tasks when domain events happen (event create/update, team save, war result save)
  - Owns scheduled trigger for reminders (every 15 min), then dispatches reminder tasks
- **Bot Runtime Service (Node, long-running process)**
  - Uses `@infini-dev-kit/bots-core`
  - Uses `@infini-dev-kit/bots-discord` and `@infini-dev-kit/bots-wechat`
  - Executes tasks, sends messages, handles incoming Discord/WeChat events
  - Calls Worker internal endpoints for domain mutations (`signup`, `leave`, `link`)
- **D1**
  - Stores config + delivery logs + account link state
  - Keeps idempotency and retry state

---

## Dev Kit Mapping

| Capability | Dev Kit Module |
|-----------|-----------------|
| Bot abstraction + middleware pipeline | `Infini-Dev-Kit/bots/core/bot.ts` |
| Command routing | `Infini-Dev-Kit/bots/core/command-router.ts` |
| Built-in middleware (rate limit/log/error boundary) | `Infini-Dev-Kit/bots/core/built-in/*` |
| Discord adapter + slash command registration | `Infini-Dev-Kit/bots/discord/discord-adapter.ts` |
| Discord raw escape hatch (reaction listeners, advanced API) | `Infini-Dev-Kit/bots/discord/discord-escape-hatch.ts` |
| WeChat adapter | `Infini-Dev-Kit/bots/wechat/wechat-adapter.ts` |

---

## Runtime Contracts

### Worker -> Bot Runtime task ingest

`POST /internal/bot/tasks`

Payload:
```json
{
  "task_id": "nanoid",
  "idempotency_key": "discord:event_notify:event_123:channel_456",
  "platform": "discord",
  "task_type": "event_notify",
  "target": {
    "channel_id": "1234567890"
  },
  "payload": {},
  "attempt": 1,
  "created_at": "2026-02-26T12:00:00Z"
}
```

### Bot Runtime -> Worker internal domain actions

- `POST /internal/bot/signup`
- `POST /internal/bot/leave`
- `POST /internal/bot/link/start`
- `POST /internal/bot/link/verify`

All internal calls require HMAC signature + timestamp header and are server-to-server only.

---

## Discord Bot

@FEATURE: DISCORD_BOT

### Setup

- Register Discord application + bot token
- Bot token and app credentials stored in Bot Runtime environment secrets
- Admin configures in Admin Console:
  - guild ID
  - notification channel ID
  - team-comp channel ID
- On Bot Runtime startup:
  - boot adapter
  - register slash commands through dev kit adapter
  - attach interaction + reaction handlers

### Feature 1: Event Notifications + React-to-Join

**Trigger:** Worker dispatches `event_notify` task on event create/update

**Behavior:**
- Bot posts embed in notification channel:
  - Event title, type, start time
  - Description (max 200 chars)
  - Capacity `current/max`
- Bot adds reactions: ✅ join / ❌ leave
- Bot Runtime listens to `messageReactionAdd` and `messageReactionRemove` via Discord raw client (escape hatch)
- On reaction:
  - resolve `discord_id -> portal member`
  - call Worker internal signup/leave endpoint
  - update embed participant count
- Per-event toggle in Event Editor:
  - `Notify Discord` (default: `guild_war = on`, others = off)

### Feature 2: Slash Commands

| Command | Description | Access |
|---------|-------------|--------|
| `/events` | List upcoming events (next 7 days) | All |
| `/signup event_id:<id>` | Join event by ID | Linked members |
| `/leave event_id:<id>` | Leave event by ID | Linked members |
| `/teams` | Show current guild war team assignments | All |
| `/roster` | Show member list (username, class, power) | All |
| `/stats [member]` | Show war stats (last 5 wars) | All |
| `/link username:<username>` | Start account link flow | Unlinked members |
| `/reminders mode:<on|off>` | Toggle reminder DM | Linked members |

Rules:
- `event_id` is required for `/signup` and `/leave` (avoid name ambiguity)
- Unknown event returns deterministic error message
- Command rate limiting uses middleware + server-side checks

### Feature 3: Team Comp Announcements

**Trigger:** Worker dispatches `team_comp` task when teams are saved or manually triggered

**Behavior:**
- Bot posts formatted team composition in team-comp channel
- Includes war start time and team notes
- Manual trigger button remains on Guild War Active tab

### Feature 4: Event Signup from Discord

- `/signup event_id:<id>` -> Worker validates lock/capacity/permission
- Success: `✅ You've joined [Event Name] (12/20 slots)`
- Capacity full: `⚠️ [Event Name] is full (20/20)`
- Locked: `🔒 Signups are locked for [Event Name]`
- Requires linked Discord account

### Feature 5: Event Reminder DMs

**Trigger:** Cloudflare Worker cron every 15 minutes creates reminder tasks

**Behavior:**
- Target events starting in next 1 hour
- One reminder per event/member/platform (idempotency key enforced)
- Bot Runtime sends DMs to linked Discord users unless opted out

### Feature 6: War Results Summary

**Trigger:** Worker dispatches `war_result` task when war history is saved

**Behavior:**
- Bot posts summary embed in notification channel:
  - win/loss
  - score metrics
  - MVPs and top K/D/A
- Embed color: green for win, red for loss

### Discord Account Linking

- `/link username:<portal_username>` starts link flow
- Worker creates 6-digit code (`expires_at` = 5 min)
- Bot DMs code to user
- Member enters code in My Profile -> Account -> Link Discord
- On success, `member_profiles.discord_id` is stored
- Unlink supported in profile and `/unlink`

---

## WeChat Bot

@FEATURE: WECHAT_BOT

> **v1 scope:** WeChat is notification-only. No signup/leave from chat (intentional). Members use the portal for event signup.

### Setup

- Uses dev kit WeChat adapter (`wechaty`-based runtime)
- Runtime credentials and puppet settings stored in Bot Runtime secrets
- Admin configures target room IDs in Admin Console

### Feature 1: Event Notifications

**Trigger:** Worker dispatches `event_notify` task with `platform = wechat`

**Format:**
```
📢 新活动: [Event Title]
时间: [Start Time] (北京时间)
类型: [Type]
人数: [current/max]
@member1 @member2 @member3 ...
```

- Mentions use `wechat_name`, fallback `username`
- Event-level toggle: `Notify WeChat` (default on for `guild_war`)

### Feature 2: Event Reminders

**Trigger:** Same Worker cron as Discord (every 15 min), tasks sent to WeChat

**Format:**
```
⏰ 活动提醒: [Event Title] 将在 [X] 分钟后开始!
@member1 @member2 ...
```

### Feature 3: War Team Comp Notifications

**Trigger:** Worker dispatches `team_comp` task or manual trigger

**Format:**
```
🏰 公会战: [War Name]
━━━━━━━━━━━━━━━━━━
队伍1: [Team Name]
@member1 @member2 @member3
备注: "rush left"

队伍2: [Team Name]
@member4 @member5 @member6

未分配: @member7 @member8
```

---

## Admin Console: Bot Settings

@FEATURE: BOT_SETTINGS

Dedicated **Bot Settings** tab in Admin Console.

### Discord Settings

- Bot status indicator
- Guild ID
- Notification channel ID
- Team comp channel ID
- Default toggles by event type
- Test notification button

### WeChat Settings

- Runtime connection status
- Target room IDs
- Default toggles by event type
- Test message button

### Per-Event Controls

In Event Editor:
- `Notify Discord` toggle
- `Notify WeChat` toggle
- `Post team comp` button (Guild War only)

---

## Permissions

| Action | External | Member | Moderator | Admin |
|--------|----------|--------|-----------|-------|
| Receive Discord notifications | N/A | Yes (if linked) | Yes | Yes |
| Use Discord slash commands | N/A | Yes (if linked) | Yes | Yes |
| Receive WeChat notifications | N/A | Yes (if in room) | Yes | Yes |
| Configure bot settings | No | No | No | Yes |
| Toggle per-event notifications | No | No | Yes | Yes |
| Link Discord account | No | Yes | Yes | Yes |
| Opt out of reminders | No | Yes | Yes | Yes |

## Security

- Bot platform secrets are stored only in Bot Runtime environment
- Worker <-> Bot Runtime communication uses HMAC signature + timestamp (replay window <= 5 minutes)
- Internal bot endpoints are not public
- Discord link codes expire in 5 minutes and are one-time use
- All bot configuration changes and manual triggers are audit logged

## Delivery State + Retry Policy

- Delivery pipeline is stateful and idempotent
- Status lifecycle: `queued -> sending -> sent | failed`
- Retry on transient failures (network, timeout, 5xx, 429)
- No retry on permanent 4xx validation/auth errors
- Retry schedule (max 4 attempts total):
  - Attempt 1: immediate
  - Attempt 2: +5s
  - Attempt 3: +30s
  - Attempt 4: +120s
- Every attempt updates log row (`attempt_count`, `last_error`, `next_attempt_at`)
- Exhausted retries end in `failed`

## Data Model

```sql
-- Existing member_profiles extension:
-- discord_id TEXT UNIQUE,
-- discord_reminder_opt_out BOOLEAN DEFAULT FALSE

CREATE TABLE discord_link_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL
);

CREATE TABLE bot_delivery_log (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,              -- 'discord' | 'wechat'
  task_type TEXT NOT NULL,             -- 'event_notify' | 'team_comp' | 'reminder' | 'war_result'
  event_id TEXT,
  target_id TEXT NOT NULL,             -- channel_id / room_id / user_id
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- 'queued' | 'sending' | 'sent' | 'failed'
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  message_id TEXT
);

CREATE INDEX idx_bot_delivery_status_next_attempt
ON bot_delivery_log(status, next_attempt_at);

CREATE TABLE bot_discord_event_messages (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, channel_id)
);
```

## Freshness

- Worker remains source of truth for business state
- Bot Runtime is delivery/interaction execution layer
- Reminder scheduler remains every 15 minutes (from Worker cron)
- Delivery failures are retried per policy then marked failed
- Config updates from Admin Console are effective immediately for newly dispatched tasks
