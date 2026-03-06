[2026-03-06T05:28:15.881Z] GET /api/health → 200 (72ms)
{
  "ok": true,
  "request_id": "d6d0a0bc-ddca-480d-b2f8-1079cd8c3c91"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:15.956Z] GET /api/admin/status → 200 (49ms)
{
  "db": "error",
  "r2": "ok",
  "ws": "ok",
  "crons": "ok",
  "db_checks": {
    "users": "ok",
    "member_profiles": "ok",
    "roles": "missing",
    "role_permissions": "missing"
  }
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.008Z] GET /api/admin/analytics-settings → 200 (32ms)
{
  "reference_duration_minutes": 30,
  "modifier_weight_kda": 0.3,
  "modifier_weight_towers": 0.1,
  "modifier_weight_credits": 0.3,
  "modifier_weight_distance": 0.15,
  "modifier_weight_basehp": 0.15
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.042Z] PATCH /api/admin/analytics-settings → 200 (32ms)
{
  "reference_duration_minutes": 30,
  "modifier_weight_kda": 0.3,
  "modifier_weight_towers": 0.1,
  "modifier_weight_credits": 0.3,
  "modifier_weight_distance": 0.15,
  "modifier_weight_basehp": 0.15
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.077Z] GET /api/auth/check-username?username=test → 200 (29ms)
{
  "available": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.109Z] GET /api/auth/me → 200 (30ms)
{
  "user": {
    "id": "UjIo6k7f9irUESw-oGTso",
    "username": "admin",
    "role": "admin",
    "is_active": true,
    "deleted_at": null,
    "created_at": "2026-03-04T14:21:42.360Z",
    "updated_at": "2026-03-04T14:21:42.360Z"
  },
  "profile": {
    "id": "15HHAWskMfk3kt_LzRMz9",
    "user_id": "UjIo6k7f9irUESw-oGTso",
    "wechat_name": "会长",
    "power": 9999,
    "classes": [
      "鸣金虹"
    ],
    "title_html": "<p>Guild Leader</p>",
    "bio": "Seeded admin profile",
    "images": [],
    "audio_key": null,
    "video_urls": [],
    "availability": {
      "all_day": true
    },
    "vacation_start": null,
    "vacation_end": null,
    "discord_id": null,
    "discord_reminder_opt_out": false,
    "notes": "seed-admin",
    "created_at": "2026-03-04T14:21:43.295Z",
    "updated_at": "2026-03-06T05:22:29.714Z"
  }
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.142Z] POST /api/auth/register/test → 409 (30ms) | ERROR: 409 Conflict
{
  "error_code": "CONFLICT",
  "message": "This invite link is no longer valid",
  "request_id": "1ae86e8f-22b1-452b-9dd9-9ea8d8212cc0"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.175Z] GET /api/users?page=1&limit=5 → 200 (31ms)
{
  "data": [
    {
      "user": {
        "id": "7zfjCYSZi4s0JpzlLMkA2",
        "username": "mod_2",
        "role": "moderator",
        "is_active": true,
        "deleted_at": null,
        "created_at": "2026-03-04T14:21:42.360Z",
        "updated_at": "2026-03-04T14:21:42.360Z"
      },
      "profile": {
        "id": "hLDZCTKmbushLvfQ9j9SY",
        "user_id": "7zfjCYSZi4s0JpzlLMkA2",
        "wechat_name": null,
        "power": 0,
        "classes": [
          "鸣金虹"
        ],
        "title_html": null,
        "bio": "API test profile update",
        "images": [],
        "audio_key": null,
        "video_urls": [],
        "availability": null,
        "vacation_start": null,
        "vacation_end": null,
        "discord_id": null,
        "discord_reminder_opt_out": false,
        "notes": null,
        "created_at": "2026-03-06T05:22:29.512Z",
        "updated_at": "2026-03-06T05:22:29.686Z"
      }
    },
    {
      "user": {
        "id": "JkVomljm62XhSEjHaGhy1",
        "username": "member_01",
        "role": "member",
        "is_active": true,
        "deleted_at": null,
        "created_at": "2026-03-04T14:21:42.360Z",
        "updated_at": "2026-03-04T14:21:42.360Z"
      },
      "profile": {
        "id": "oI-yyZZSZtWJV8s_wMOlq",
        "user_id": "JkVomljm62XhSEjHaGhy1",
        "wechat_name": "成员01",
        "power": 3000,
        "classes": [
          "鸣金虹",
          "牵丝霖"
        ],
        "title_html": "<p>Seed Title 1</p>",
        "bio": "Seed profile for member 1",
        "images": [],
        "audio_key": null,
        "video_urls": [],
        "availability": {
          "weekdayEvening": true
        },
        "vacation_start": null,
        "vacation_end": null,
        "discord_id": "discord_user_1",
        "discord_reminder_opt_out": false,
        "notes": "High priority member",
        "created_at": "2026-03-04T14:21:43.295Z",
        "updated_at": "2026-03-04T14:21:43.295Z"
      }
    },
    {
      "user": {

... (truncated)

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.209Z] GET /api/users/7zfjCYSZi4s0JpzlLMkA2 → 200 (31ms)
{
  "user": {
    "id": "7zfjCYSZi4s0JpzlLMkA2",
    "username": "mod_2",
    "role": "moderator",
    "is_active": true,
    "deleted_at": null,
    "created_at": "2026-03-04T14:21:42.360Z",
    "updated_at": "2026-03-04T14:21:42.360Z"
  },
  "profile": {
    "id": "hLDZCTKmbushLvfQ9j9SY",
    "user_id": "7zfjCYSZi4s0JpzlLMkA2",
    "wechat_name": null,
    "power": 0,
    "classes": [
      "鸣金虹"
    ],
    "title_html": null,
    "bio": "API test profile update",
    "images": [],
    "audio_key": null,
    "video_urls": [],
    "availability": null,
    "vacation_start": null,
    "vacation_end": null,
    "discord_id": null,
    "discord_reminder_opt_out": false,
    "notes": null,
    "created_at": "2026-03-06T05:22:29.512Z",
    "updated_at": "2026-03-06T05:22:29.686Z"
  }
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.242Z] PATCH /api/users/7zfjCYSZi4s0JpzlLMkA2/profile → 200 (31ms)
{
  "id": "hLDZCTKmbushLvfQ9j9SY",
  "user_id": "7zfjCYSZi4s0JpzlLMkA2",
  "wechat_name": null,
  "power": 0,
  "classes": [
    "鸣金虹"
  ],
  "title_html": null,
  "bio": "API test profile update",
  "images": [],
  "audio_key": null,
  "video_urls": [],
  "availability": null,
  "vacation_start": null,
  "vacation_end": null,
  "discord_id": null,
  "discord_reminder_opt_out": false,
  "notes": null,
  "created_at": "2026-03-06T05:22:29.512Z",
  "updated_at": "2026-03-06T05:28:16.251Z"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.276Z] POST /api/users/7zfjCYSZi4s0JpzlLMkA2/media/images → 200 (33ms)
{
  "keys": [
    "profile/7zfjCYSZi4s0JpzlLMkA2/images/1772774896285_HUNfIIFfU56UJon3snZDo"
  ]
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.312Z] DELETE /api/users/7zfjCYSZi4s0JpzlLMkA2/media/images/profile%2F7zfjCYSZi4s0JpzlLMkA2%2Fimages%2F1772774896285_HUNfIIFfU56UJon3snZDo → 200 (32ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.346Z] POST /api/users/7zfjCYSZi4s0JpzlLMkA2/media/audio → 200 (35ms)
{
  "key": "profile/7zfjCYSZi4s0JpzlLMkA2/audio/1772774896355_lB_XwkXfuweJc2192tZPj"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.383Z] DELETE /api/users/7zfjCYSZi4s0JpzlLMkA2/media/audio → 200 (34ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.420Z] POST /api/users/UjIo6k7f9irUESw-oGTso/discord-link/verify → ERR (0ms) | ERROR: Skipped
Requires an active Discord link verification code

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.420Z] DELETE /api/users/UjIo6k7f9irUESw-oGTso/discord-link → 200 (33ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.456Z] POST /api/users/UjIo6k7f9irUESw-oGTso/change-password → ERR (0ms) | ERROR: Skipped
Requires current user password

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.456Z] POST /api/users/UjIo6k7f9irUESw-oGTso/change-username → ERR (0ms) | ERROR: Skipped
Requires current user password

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.456Z] GET /api/events?page=1&limit=5 → 200 (35ms)
{
  "data": [
    {
      "id": "86zpYVxQQp2myFIKqHX_k",
      "type": "weekly_mission",
      "title": "Weekly Mission Alpha",
      "description": "Primary weekly mission",
      "start_at": "2026-03-05T14:21:42.358Z",
      "end_at": "2026-03-05T16:21:42.358Z",
      "capacity": 10,
      "pinned": true,
      "signup_locked": false,
      "archived_at": null,
      "created_by": "UjIo6k7f9irUESw-oGTso",
      "recurrence_rule": null,
      "attachments": [],
      "series_id": null,
      "is_series_parent": false,
      "instance_date": null,
      "created_at": "2026-03-04T14:21:43.302Z",
      "updated_at": "2026-03-05T21:04:46.237Z"
    },
    {
      "id": "svcb5-3d0SLKq8LLvPLmS",
      "type": "social",
      "title": "Guild Social Night",
      "description": "Relaxed social event",
      "start_at": "2026-03-06T14:21:42.358Z",
      "end_at": "2026-03-06T16:21:42.358Z",
      "capacity": null,
      "pinned": false,
      "signup_locked": false,
      "archived_at": null,
      "created_by": "UjIo6k7f9irUESw-oGTso",
      "recurrence_rule": null,
      "attachments": [],
      "series_id": null,
      "is_series_parent": false,
      "instance_date": null,
      "created_at": "2026-03-04T14:21:43.302Z",
      "updated_at": "2026-03-04T14:21:43.302Z"
    },
    {
      "id": "q_zwi9FfCpvBIda6P4lfO",
      "type": "weekly_mission",
      "title": "Weekly Mission Beta",
      "description": "Secondary weekly mission",
      "start_at": "2026-03-07T14:21:42.358Z",
      "end_at": "2026-03-07T16:21:42.358Z",
      "capacity": 12,
      "pinned": false,
      "signup_locked": false,
      "archived_at": null,
      "created_by": "UjIo6k7f9irUESw-oGTso",
      "recurrence_rule": null,
      "attachments": [],
      "series_id": null,
      "is_series_parent": false,
      "instance_date": null,
      "created_at": "2026-03-04T14:21:43.302Z",
      "updated_at": "2026-03-04T14:21:43.302Z"
    },
    {
      "id": "rOZAs9DVucihHADgrJhnS",
      "type": "social",

... (truncated)

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.493Z] GET /api/events/86zpYVxQQp2myFIKqHX_k → 200 (33ms)
{
  "id": "86zpYVxQQp2myFIKqHX_k",
  "type": "weekly_mission",
  "title": "Weekly Mission Alpha",
  "description": "Primary weekly mission",
  "start_at": "2026-03-05T14:21:42.358Z",
  "end_at": "2026-03-05T16:21:42.358Z",
  "capacity": 10,
  "pinned": true,
  "signup_locked": false,
  "archived_at": null,
  "created_by": "UjIo6k7f9irUESw-oGTso",
  "recurrence_rule": null,
  "attachments": [],
  "series_id": null,
  "is_series_parent": false,
  "instance_date": null,
  "created_at": "2026-03-04T14:21:43.302Z",
  "updated_at": "2026-03-05T21:04:46.237Z",
  "participants": [
    {
      "id": "yeNzn6qIyuTofOlsShAsS",
      "event_id": "86zpYVxQQp2myFIKqHX_k",
      "user_id": "7zfjCYSZi4s0JpzlLMkA2",
      "joined_at": "2026-03-04T15:37:42.358Z"
    },
    {
      "id": "WTpTrB1SSF3GhC2Elgq8x",
      "event_id": "86zpYVxQQp2myFIKqHX_k",
      "user_id": "JkVomljm62XhSEjHaGhy1",
      "joined_at": "2026-03-04T14:21:42.358Z"
    },
    {
      "id": "puIYhoHS5YjFUcklogCLF",
      "event_id": "86zpYVxQQp2myFIKqHX_k",
      "user_id": "K9REXvKpPvP3hLppAtTRV",
      "joined_at": "2026-03-04T14:23:42.358Z"
    },
    {
      "id": "Nx6gijYAMvLax0A02aOsR",
      "event_id": "86zpYVxQQp2myFIKqHX_k",
      "user_id": "MxaorkmwMcmciiicz4gtk",
      "joined_at": "2026-03-04T14:26:42.358Z"
    },
    {
      "id": "nSNy73SZRNM5MGtT0FqQO",
      "event_id": "86zpYVxQQp2myFIKqHX_k",
      "user_id": "a_TG81KjhvZUM__qzh6Dn",
      "joined_at": "2026-03-04T15:38:42.358Z"
    },
    {
      "id": "-FVoZCUi7zAJSQBngQe1T",
      "event_id": "86zpYVxQQp2myFIKqHX_k",
      "user_id": "b62Nnp-yMfBiTA_sJlCVi",
      "joined_at": "2026-03-04T15:36:42.358Z"
    },
    {
      "id": "L5e7Q4rjnW6gygCcomEpJ",
      "event_id": "86zpYVxQQp2myFIKqHX_k",
      "user_id": "pmVTVkllSyvlpVsT_SPsm",
      "joined_at": "2026-03-04T14:25:42.358Z"
    },
    {
      "id": "fnqXc90UUnh_HtZmankUD",
      "event_id": "86zpYVxQQp2myFIKqHX_k",
      "user_id": "wAk37WinV8CldXSQDCCwT",
      "joined_at": "2026-
... (truncated)

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.528Z] POST /api/events → 500 (36ms) | ERROR: 500 Internal Server Error
{
  "error_code": "SERVER_ERROR",
  "message": "D1_ERROR: table events has no column named last_generated_date: SQLITE_ERROR",
  "request_id": "77731bc7-62ef-42be-b82e-6ec94fa160fb"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.567Z] PATCH /api/events/86zpYVxQQp2myFIKqHX_k → 200 (33ms)
{
  "id": "86zpYVxQQp2myFIKqHX_k",
  "type": "weekly_mission",
  "title": "API Updated Event 1772774896567",
  "description": "Primary weekly mission",
  "start_at": "2026-03-05T14:21:42.358Z",
  "end_at": "2026-03-05T16:21:42.358Z",
  "capacity": 10,
  "pinned": true,
  "signup_locked": false,
  "archived_at": null,
  "created_by": "UjIo6k7f9irUESw-oGTso",
  "recurrence_rule": null,
  "attachments": [],
  "series_id": null,
  "is_series_parent": false,
  "instance_date": null,
  "created_at": "2026-03-04T14:21:43.302Z",
  "updated_at": "2026-03-06T05:28:16.575Z"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.603Z] DELETE /api/events/86zpYVxQQp2myFIKqHX_k → 200 (32ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.637Z] DELETE /api/events/86zpYVxQQp2myFIKqHX_k/destroy → 500 (36ms) | ERROR: 500 Internal Server Error
{
  "error_code": "SERVER_ERROR",
  "message": "D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT",
  "request_id": "aff3e149-bb17-4ed8-be1f-c06d508acb47"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.676Z] POST /api/events/86zpYVxQQp2myFIKqHX_k/images → 200 (35ms)
{
  "keys": [
    "events/86zpYVxQQp2myFIKqHX_k/images/1772774896684_5cBHVWQRaw-I4JHu8Sl2K"
  ],
  "attachments": [
    "events/86zpYVxQQp2myFIKqHX_k/images/1772774896684_5cBHVWQRaw-I4JHu8Sl2K"
  ]
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.713Z] POST /api/events/86zpYVxQQp2myFIKqHX_k/join → 409 (34ms) | ERROR: 409 Conflict
{
  "error_code": "CONFLICT",
  "message": "Event is archived",
  "request_id": "371c2af6-84d2-4373-a3b3-d257c861273b"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.750Z] DELETE /api/events/86zpYVxQQp2myFIKqHX_k/leave → 200 (33ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.786Z] POST /api/events/86zpYVxQQp2myFIKqHX_k/participants → 201 (43ms)
{
  "id": "HhIPPW_iHHPfWyXWkmVqz",
  "event_id": "86zpYVxQQp2myFIKqHX_k",
  "user_id": "7zfjCYSZi4s0JpzlLMkA2",
  "joined_at": "2026-03-06T05:28:16.795Z"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.834Z] DELETE /api/events/86zpYVxQQp2myFIKqHX_k/participants/7zfjCYSZi4s0JpzlLMkA2 → 200 (41ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.880Z] GET /api/events/templates/list → 200 (39ms)
{
  "data": []
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:16.924Z] POST /api/events/templates → 500 (80ms) | ERROR: 500 Internal Server Error
{
  "error_code": "SERVER_ERROR",
  "message": "D1_ERROR: table events has no column named last_generated_date: SQLITE_ERROR",
  "request_id": "b73e24e6-e355-44a6-a33c-92428ed88e6a"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.007Z] PATCH /api/events/templates/:id → ERR (0ms) | ERROR: Skipped
Missing template id

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.007Z] POST /api/events/templates/:id/pause → ERR (0ms) | ERROR: Skipped
Missing template id

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.008Z] POST /api/events/templates/:id/resume → ERR (0ms) | ERROR: Skipped
Missing template id

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.008Z] DELETE /api/events/templates/:id → ERR (0ms) | ERROR: Skipped
Missing template id

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.008Z] GET /api/announcements?page=1&limit=5 → 200 (43ms)
{
  "data": [
    {
      "id": "dwdzdGVnIk5n7om0sMGv2",
      "title": "Welcome to Infini Guild",
      "body_json": "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Welcome!asdasd\"}]}]}",
      "pinned": true,
      "pinned_at": "2026-03-05T02:25:33.306Z",
      "status": "archived",
      "publish_at": "2026-03-04T14:21:00.000Z",
      "expires_at": null,
      "archived_at": null,
      "created_by": "UjIo6k7f9irUESw-oGTso",
      "created_at": "2026-03-04T14:21:43.319Z",
      "updated_at": "2026-03-05T02:25:33.306Z"
    },
    {
      "id": "s1ACBO2zz7uJCdngDTUxZ",
      "title": "API Announcement Updated 1772774550413",
      "body_json": "{\"content\":\"Updated by API tester\"}",
      "pinned": false,
      "pinned_at": null,
      "status": "archived",
      "publish_at": null,
      "expires_at": null,
      "archived_at": "2026-03-06T05:22:30.466Z",
      "created_by": "UjIo6k7f9irUESw-oGTso",
      "created_at": "2026-03-06T05:22:30.370Z",
      "updated_at": "2026-03-06T05:22:30.466Z"
    },
    {
      "id": "kGoAcF6MT1pYWH55leKqS",
      "title": "atestasad",
      "body_json": "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}",
      "pinned": false,
      "pinned_at": null,
      "status": "draft",
      "publish_at": null,
      "expires_at": null,
      "archived_at": null,
      "created_by": "UjIo6k7f9irUESw-oGTso",
      "created_at": "2026-03-05T19:25:08.433Z",
      "updated_at": "2026-03-05T19:25:08.433Z"
    },
    {
      "id": "s2eTY7pDsZcM7xiXnbtxt",
      "title": "Next War Prep",
      "body_json": "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Prepare your builds.\"}]}]}",
      "pinned": false,
      "pinned_at": null,
      "status": "draft",
      "publish_at": null,
      "expires_at": null,
      "archived_at": null,
      "created_by": "b62Nnp-yMfBiTA_sJlCVi",
      "created_at": "2026-03-04T14:21:43.319Z",
      "upd
... (truncated)

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.059Z] GET /api/announcements/dwdzdGVnIk5n7om0sMGv2 → 200 (33ms)
{
  "id": "dwdzdGVnIk5n7om0sMGv2",
  "title": "Welcome to Infini Guild",
  "body_json": "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Welcome!asdasd\"}]}]}",
  "pinned": true,
  "pinned_at": "2026-03-05T02:25:33.306Z",
  "status": "archived",
  "publish_at": "2026-03-04T14:21:00.000Z",
  "expires_at": null,
  "archived_at": null,
  "created_by": "UjIo6k7f9irUESw-oGTso",
  "created_at": "2026-03-04T14:21:43.319Z",
  "updated_at": "2026-03-05T02:25:33.306Z"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.094Z] POST /api/announcements → 201 (42ms)
{
  "id": "hereaIqH3vJIDpVsUaS9V",
  "title": "API Announcement 1772774897094",
  "body_json": "{\"content\":\"Created by API tester\"}",
  "pinned": false,
  "pinned_at": null,
  "status": "draft",
  "publish_at": null,
  "expires_at": null,
  "archived_at": null,
  "created_by": "UjIo6k7f9irUESw-oGTso",
  "created_at": "2026-03-06T05:28:17.102Z",
  "updated_at": "2026-03-06T05:28:17.101Z"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.140Z] PATCH /api/announcements/hereaIqH3vJIDpVsUaS9V → 200 (43ms)
{
  "id": "hereaIqH3vJIDpVsUaS9V",
  "title": "API Announcement Updated 1772774897140",
  "body_json": "{\"content\":\"Updated by API tester\"}",
  "pinned": false,
  "pinned_at": null,
  "status": "draft",
  "publish_at": null,
  "expires_at": null,
  "archived_at": null,
  "created_by": "UjIo6k7f9irUESw-oGTso",
  "created_at": "2026-03-06T05:28:17.102Z",
  "updated_at": "2026-03-06T05:28:17.148Z"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.187Z] DELETE /api/announcements/hereaIqH3vJIDpVsUaS9V → 200 (46ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.237Z] POST /api/announcements/hereaIqH3vJIDpVsUaS9V/images → 200 (39ms)
{
  "keys": [
    "announcement/hereaIqH3vJIDpVsUaS9V/images/1772774897245_vX-O9uVWSPpMJ_Y4BfS9W"
  ]
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.279Z] GET /api/gallery?limit=5 → 200 (38ms)
{
  "data": [
    {
      "id": "1TDRjG0Jj6FmmR-04cYg6",
      "type": "image",
      "url": "gallery/images/UjIo6k7f9irUESw-oGTso/1772774550602_1TDRjG0Jj6FmmR-04cYg6",
      "caption": "API test image",
      "uploaded_by": "UjIo6k7f9irUESw-oGTso",
      "uploaded_by_name": "admin",
      "like_count": 1,
      "comment_count": 0,
      "is_liked": true,
      "created_at": "2026-03-06T05:22:30.610Z"
    },
    {
      "id": "zsRb0LegizW9YljZ61mBT",
      "type": "image",
      "url": "gallery/images/seed/member_4.webp",
      "caption": "Seed image 4",
      "uploaded_by": "zVQx7pKp9WNanXdrrTq1l",
      "uploaded_by_name": "member_04",
      "like_count": 15,
      "comment_count": 4,
      "is_liked": false,
      "created_at": "2026-03-04T14:21:43.337Z"
    },
    {
      "id": "lRQL5185B-7PS6CFpL4TA",
      "type": "image",
      "url": "gallery/images/seed/member_1.webp",
      "caption": "Seed image 1",
      "uploaded_by": "JkVomljm62XhSEjHaGhy1",
      "uploaded_by_name": "member_01",
      "like_count": 6,
      "comment_count": 2,
      "is_liked": false,
      "created_at": "2026-03-04T14:21:43.337Z"
    },
    {
      "id": "iortUtDnQPPQGTJruAOUv",
      "type": "image",
      "url": "gallery/images/seed/member_6.webp",
      "caption": "Seed image 6",
      "uploaded_by": "MxaorkmwMcmciiicz4gtk",
      "uploaded_by_name": "member_06",
      "like_count": 3,
      "comment_count": 3,
      "is_liked": false,
      "created_at": "2026-03-04T14:21:43.337Z"
    },
    {
      "id": "eg33iSK3eoKnt27jm-4lb",
      "type": "image",
      "url": "gallery/images/seed/member_2.webp",
      "caption": "Seed image 2",
      "uploaded_by": "wAk37WinV8CldXSQDCCwT",
      "uploaded_by_name": "member_02",
      "like_count": 9,
      "comment_count": 2,
      "is_liked": false,
      "created_at": "2026-03-04T14:21:43.337Z"
    }
  ],
  "next_cursor": "5"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.321Z] POST /api/gallery/images → 201 (34ms)
{
  "data": [
    {
      "id": "D1YCi-1e-FlgrvqapSomF",
      "type": "image",
      "url": "gallery/images/UjIo6k7f9irUESw-oGTso/1772774897328_D1YCi-1e-FlgrvqapSomF",
      "caption": "API test image",
      "uploaded_by": "UjIo6k7f9irUESw-oGTso",
      "uploaded_by_name": null,
      "like_count": 0,
      "comment_count": 0,
      "is_liked": false,
      "created_at": "2026-03-06T05:28:17.337Z"
    }
  ]
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.358Z] POST /api/gallery/videos → 201 (39ms)
{
  "id": "0hbRicDfMabAK-d9bW7o7",
  "type": "video",
  "url": "https://example.com/video.mp4",
  "caption": "API test video",
  "uploaded_by": "UjIo6k7f9irUESw-oGTso",
  "uploaded_by_name": "admin",
  "like_count": 0,
  "comment_count": 0,
  "is_liked": false,
  "created_at": "2026-03-06T05:28:17.365Z"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.399Z] DELETE /api/gallery/0hbRicDfMabAK-d9bW7o7 → 200 (36ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.437Z] POST /api/gallery/D1YCi-1e-FlgrvqapSomF/like → 201 (36ms)
{
  "ok": true,
  "already_liked": false
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.475Z] GET /api/gallery/D1YCi-1e-FlgrvqapSomF/comments → 200 (39ms)
{
  "data": [],
  "next_cursor": null
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.517Z] POST /api/gallery/D1YCi-1e-FlgrvqapSomF/comments → 201 (39ms)
{
  "id": "pA9yWW8lyppP6U-xAHJiH",
  "gallery_item_id": "D1YCi-1e-FlgrvqapSomF",
  "user_id": "UjIo6k7f9irUESw-oGTso",
  "username": "admin",
  "body": "API test comment",
  "created_at": "2026-03-06T05:28:17.524Z",
  "updated_at": "2026-03-06T05:28:17.524Z"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.559Z] PATCH /api/gallery/D1YCi-1e-FlgrvqapSomF/comments/pA9yWW8lyppP6U-xAHJiH → 200 (38ms)
{
  "id": "pA9yWW8lyppP6U-xAHJiH",
  "gallery_item_id": "D1YCi-1e-FlgrvqapSomF",
  "user_id": "UjIo6k7f9irUESw-oGTso",
  "username": "admin",
  "body": "API test comment (edited)",
  "created_at": "2026-03-06T05:28:17.524Z",
  "updated_at": "2026-03-06T05:28:17.567Z"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.600Z] DELETE /api/gallery/D1YCi-1e-FlgrvqapSomF/comments/pA9yWW8lyppP6U-xAHJiH → 200 (40ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.642Z] GET /api/guild-war/active → 200 (40ms)
{
  "event": {
    "id": "58GvDIO61k3IIbugLow_8",
    "type": "guild_war",
    "title": "Guild War #2",
    "description": "Second seed guild war",
    "start_at": "2026-03-16T14:21:42.358Z",
    "end_at": "2026-03-16T17:21:42.358Z",
    "capacity": 20,
    "pinned": false,
    "signup_locked": false,
    "archived_at": null,
    "created_by": "UjIo6k7f9irUESw-oGTso",
    "recurrence_rule": null,
    "attachments": [],
    "series_id": null,
    "is_series_parent": false,
    "instance_date": null,
    "created_at": "2026-03-04T14:21:43.302Z",
    "updated_at": "2026-03-04T14:21:43.302Z"
  },
  "teams": [
    {
      "id": "n19MmiDexgo5KpDJok0MA",
      "war_history_id": "gsyAKKCFB3dg868XEn5m3",
      "team_name": "API Team A",
      "sort_order": 0,
      "notes": null,
      "is_locked": false,
      "members": [
        {
          "id": "3qwGcZ9wkr7p1iusH7gDl",
          "war_team_id": "n19MmiDexgo5KpDJok0MA",
          "user_id": "7zfjCYSZi4s0JpzlLMkA2",
          "role_tag": null,
          "sort_order": 0,
          "kills": null,
          "deaths": null,
          "assists": null,
          "damage": null,
          "healing": null,
          "building_damage": null,
          "credits": null,
          "damage_taken": null,
          "note": null
        }
      ]
    }
  ],
  "pool": [
    {
      "id": "iEFpHPEDQNWdrCCySA06O",
      "warHistoryId": "gsyAKKCFB3dg868XEn5m3",
      "userId": "pmVTVkllSyvlpVsT_SPsm"
    }
  ],
  "etag": "\"war-gsyAKKCFB3dg868XEn5m3-2026-03-06T05:22:31.487Z\""
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.684Z] POST /api/guild-war/save-teams → 200 (38ms)
{
  "id": "gsyAKKCFB3dg868XEn5m3",
  "event_id": "58GvDIO61k3IIbugLow_8",
  "war_name": "War Session B",
  "enemy_name": "Iron Vanguard",
  "result": "loss",
  "own_kills": 24,
  "own_towers": 2,
  "own_base_hp": 0,
  "own_credits": 8700,
  "own_distance": 3200,
  "enemy_kills": 34,
  "enemy_towers": 5,
  "enemy_base_hp": 55,
  "enemy_credits": 12100,
  "enemy_distance": 4600,
  "duration_minutes": null,
  "notes": "API test history update",
  "created_by": "b62Nnp-yMfBiTA_sJlCVi",
  "created_at": "2026-03-04T14:21:43.321Z",
  "updated_at": "2026-03-06T05:28:17.699Z"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.725Z] POST /api/guild-war/move → 200 (40ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.768Z] PATCH /api/guild-war/role-tag → 404 (41ms) | ERROR: 404 Not Found
{
  "error_code": "NOT_FOUND",
  "message": "Member not found in active teams",
  "request_id": "40034af6-4d2f-4373-9de3-fe5d84f99cfb"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.821Z] POST /api/guild-war/post-teams → 400 (44ms) | ERROR: 400 Bad Request
{
  "error_code": "VALIDATION_ERROR",
  "message": "Missing discord target for team composition dispatch",
  "request_id": "e1dbe62d-1538-4e3d-a6c2-2b9294cc8f7a"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.867Z] POST /api/guild-war/post-results → ERR (0ms) | ERROR: Skipped
Missing war history id for post-results

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.867Z] GET /api/guild-war/export?format=json → 200 (40ms)
{
  "exported_at": "2026-03-06T05:28:17.873Z",
  "filters": {
    "date_from": null,
    "date_to": null,
    "event_id": null
  },
  "total": 4,
  "data": [
    {
      "id": "gsyAKKCFB3dg868XEn5m3",
      "event_id": "58GvDIO61k3IIbugLow_8",
      "war_name": "War Session B",
      "enemy_name": "Iron Vanguard",
      "result": "loss",
      "own_kills": 24,
      "own_towers": 2,
      "own_base_hp": 0,
      "own_credits": 8700,
      "own_distance": 3200,
      "enemy_kills": 34,
      "enemy_towers": 5,
      "enemy_base_hp": 55,
      "enemy_credits": 12100,
      "enemy_distance": 4600,
      "duration_minutes": null,
      "notes": "API test history update",
      "created_by": "b62Nnp-yMfBiTA_sJlCVi",
      "created_at": "2026-03-04T14:21:43.321Z",
      "updated_at": "2026-03-06T05:28:17.736Z"
    },
    {
      "id": "fFjIRuqlySFXWqLC2Zp31",
      "event_id": "4kyRl8tivM34pV2BCLg4l",
      "war_name": "War Session C",
      "enemy_name": "Crimson Tide",
      "result": "win",
      "own_kills": 42,
      "own_towers": 7,
      "own_base_hp": 58,
      "own_credits": 14200,
      "own_distance": 5100,
      "enemy_kills": 31,
      "enemy_towers": 4,
      "enemy_base_hp": 0,
      "enemy_credits": 10500,
      "enemy_distance": 4200,
      "duration_minutes": null,
      "notes": "Clean sweep — great coordination",
      "created_by": "UjIo6k7f9irUESw-oGTso",
      "created_at": "2026-03-04T14:21:43.321Z",
      "updated_at": "2026-03-04T14:21:43.321Z"
    },
    {
      "id": "NKhtfX8qIQvdO6d2Erouz",
      "event_id": "en6cYcN9BI0vLjJa2EBFH",
      "war_name": "War Session A",
      "enemy_name": "Shadow Legion",
      "result": "win",
      "own_kills": 38,
      "own_towers": 6,
      "own_base_hp": 72,
      "own_credits": 12800,
      "own_distance": 4800,
      "enemy_kills": 27,
      "enemy_towers": 3,
      "enemy_base_hp": 0,
      "enemy_credits": 9300,
      "enemy_distance": 3900,
      "duration_minutes": null,
      "notes": "Solid frontli
... (truncated)

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:17.910Z] GET /api/guild-war/templates → 200 (85ms)
[
  {
    "id": "k5n1FBJMmE33MXRLi2oxu",
    "template_name": "Standard 4v4 Split",
    "description": "Default 4-player split formation with core/flex roles",
    "source_event_id": "en6cYcN9BI0vLjJa2EBFH",
    "team_count": 2,
    "member_count": 8,
    "created_by": "UjIo6k7f9irUESw-oGTso",
    "created_at": "2026-03-04T14:21:43.357Z",
    "updated_at": "2026-03-04T14:21:43.357Z"
  },
  {
    "id": "6A5OWtxSKVgZOQXRfsfa8",
    "template_name": "Defense Hold",
    "description": "Defensive formation prioritizing tower control",
    "source_event_id": "58GvDIO61k3IIbugLow_8",
    "team_count": 2,
    "member_count": 8,
    "created_by": "UjIo6k7f9irUESw-oGTso",
    "created_at": "2026-03-04T14:21:43.357Z",
    "updated_at": "2026-03-04T14:21:43.357Z"
  },
  {
    "id": "1TSq2bJfZF8vx5EKLMPA1",
    "template_name": "Rush Formation",
    "description": "Aggressive 5-player rush setup",
    "source_event_id": null,
    "team_count": 2,
    "member_count": 9,
    "created_by": "b62Nnp-yMfBiTA_sJlCVi",
    "created_at": "2026-03-04T14:21:43.357Z",
    "updated_at": "2026-03-04T14:21:43.357Z"
  }
]

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.005Z] POST /api/guild-war/templates → 201 (45ms)
{
  "id": "43DQHnmJpXAfvkdEOvXXc",
  "template_name": "api-template-1772774898005",
  "description": "API test guild war template",
  "source_event_id": "58GvDIO61k3IIbugLow_8",
  "team_count": 1,
  "member_count": 0,
  "created_by": "UjIo6k7f9irUESw-oGTso",
  "created_at": "2026-03-06T05:28:18.015Z",
  "updated_at": "2026-03-06T05:28:18.015Z"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.053Z] POST /api/guild-war/templates/apply → 200 (44ms)
{
  "ok": true,
  "war_history_id": "gsyAKKCFB3dg868XEn5m3"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.100Z] DELETE /api/guild-war/templates/43DQHnmJpXAfvkdEOvXXc → 200 (41ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.144Z] GET /api/guild-war/history?page=1&limit=5 → 200 (36ms)
{
  "data": [
    {
      "id": "gsyAKKCFB3dg868XEn5m3",
      "event_id": "58GvDIO61k3IIbugLow_8",
      "war_name": "War Session B",
      "enemy_name": "Iron Vanguard",
      "result": "loss",
      "own_kills": 24,
      "own_towers": 2,
      "own_base_hp": 0,
      "own_credits": 8700,
      "own_distance": 3200,
      "enemy_kills": 34,
      "enemy_towers": 5,
      "enemy_base_hp": 55,
      "enemy_credits": 12100,
      "enemy_distance": 4600,
      "duration_minutes": null,
      "notes": "API test history update",
      "created_by": "b62Nnp-yMfBiTA_sJlCVi",
      "created_at": "2026-03-04T14:21:43.321Z",
      "updated_at": "2026-03-06T05:28:18.067Z"
    },
    {
      "id": "fFjIRuqlySFXWqLC2Zp31",
      "event_id": "4kyRl8tivM34pV2BCLg4l",
      "war_name": "War Session C",
      "enemy_name": "Crimson Tide",
      "result": "win",
      "own_kills": 42,
      "own_towers": 7,
      "own_base_hp": 58,
      "own_credits": 14200,
      "own_distance": 5100,
      "enemy_kills": 31,
      "enemy_towers": 4,
      "enemy_base_hp": 0,
      "enemy_credits": 10500,
      "enemy_distance": 4200,
      "duration_minutes": null,
      "notes": "Clean sweep — great coordination",
      "created_by": "UjIo6k7f9irUESw-oGTso",
      "created_at": "2026-03-04T14:21:43.321Z",
      "updated_at": "2026-03-04T14:21:43.321Z"
    },
    {
      "id": "NKhtfX8qIQvdO6d2Erouz",
      "event_id": "en6cYcN9BI0vLjJa2EBFH",
      "war_name": "War Session A",
      "enemy_name": "Shadow Legion",
      "result": "win",
      "own_kills": 38,
      "own_towers": 6,
      "own_base_hp": 72,
      "own_credits": 12800,
      "own_distance": 4800,
      "enemy_kills": 27,
      "enemy_towers": 3,
      "enemy_base_hp": 0,
      "enemy_credits": 9300,
      "enemy_distance": 3900,
      "duration_minutes": null,
      "notes": "Solid frontline execution",
      "created_by": "UjIo6k7f9irUESw-oGTso",
      "created_at": "2026-03-04T14:21:43.321Z",
      "updated_at": "2026-03-05T06:3
... (truncated)

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.182Z] GET /api/guild-war/history/gsyAKKCFB3dg868XEn5m3 → 200 (37ms)
{
  "id": "gsyAKKCFB3dg868XEn5m3",
  "event_id": "58GvDIO61k3IIbugLow_8",
  "war_name": "War Session B",
  "enemy_name": "Iron Vanguard",
  "result": "loss",
  "own_kills": 24,
  "own_towers": 2,
  "own_base_hp": 0,
  "own_credits": 8700,
  "own_distance": 3200,
  "enemy_kills": 34,
  "enemy_towers": 5,
  "enemy_base_hp": 55,
  "enemy_credits": 12100,
  "enemy_distance": 4600,
  "duration_minutes": null,
  "notes": "API test history update",
  "created_by": "b62Nnp-yMfBiTA_sJlCVi",
  "created_at": "2026-03-04T14:21:43.321Z",
  "updated_at": "2026-03-06T05:28:18.067Z",
  "teams": [
    {
      "id": "Ic6JY35IGbIJKBQ49Q1My",
      "war_history_id": "gsyAKKCFB3dg868XEn5m3",
      "team_name": "API Team A",
      "sort_order": 0,
      "notes": null,
      "is_locked": false,
      "members": []
    }
  ],
  "pool": [
    {
      "id": "2lMJu9ynQY42X2UTxSn-b",
      "warHistoryId": "gsyAKKCFB3dg868XEn5m3",
      "userId": "7zfjCYSZi4s0JpzlLMkA2"
    }
  ],
  "member_stats": []
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.221Z] POST /api/guild-war/history → 500 (39ms) | ERROR: 500 Internal Server Error
{
  "error_code": "SERVER_ERROR",
  "message": "D1_ERROR: table war_history has no column named duration_minutes: SQLITE_ERROR",
  "request_id": "900ccd8e-b130-4016-95c6-f2a457c4297c"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.263Z] PATCH /api/guild-war/history/gsyAKKCFB3dg868XEn5m3 → 200 (38ms)
{
  "id": "gsyAKKCFB3dg868XEn5m3",
  "event_id": "58GvDIO61k3IIbugLow_8",
  "war_name": "War Session B",
  "enemy_name": "Iron Vanguard",
  "result": "loss",
  "own_kills": 24,
  "own_towers": 2,
  "own_base_hp": 0,
  "own_credits": 8700,
  "own_distance": 3200,
  "enemy_kills": 34,
  "enemy_towers": 5,
  "enemy_base_hp": 55,
  "enemy_credits": 12100,
  "enemy_distance": 4600,
  "duration_minutes": null,
  "notes": "API test history update",
  "created_by": "b62Nnp-yMfBiTA_sJlCVi",
  "created_at": "2026-03-04T14:21:43.321Z",
  "updated_at": "2026-03-06T05:28:18.271Z"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.303Z] PATCH /api/guild-war/history/gsyAKKCFB3dg868XEn5m3/member-stats/7zfjCYSZi4s0JpzlLMkA2 → 404 (37ms) | ERROR: 404 Not Found
{
  "error_code": "NOT_FOUND",
  "message": "Team member not found in selected war history",
  "request_id": "45f9f5f5-ba67-4c75-9ae1-374f8f25098c"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.343Z] GET /api/guild-war/analytics → 200 (38ms)
{
  "wars": [
    {
      "id": "gsyAKKCFB3dg868XEn5m3",
      "event_id": "58GvDIO61k3IIbugLow_8",
      "war_name": "War Session B",
      "enemy_name": "Iron Vanguard",
      "result": "loss",
      "own_kills": 24,
      "own_towers": 2,
      "own_base_hp": 0,
      "own_credits": 8700,
      "own_distance": 3200,
      "enemy_kills": 34,
      "enemy_towers": 5,
      "enemy_base_hp": 55,
      "enemy_credits": 12100,
      "enemy_distance": 4600,
      "duration_minutes": null,
      "notes": "API test history update",
      "created_by": "b62Nnp-yMfBiTA_sJlCVi",
      "created_at": "2026-03-04T14:21:43.321Z",
      "updated_at": "2026-03-06T05:28:18.271Z",
      "team_size": 0,
      "modifier": 9.5579,
      "modifier_breakdown": [
        {
          "factor": "kda",
          "ratio": 1.4167,
          "weight": 0.3,
          "contribution": 0.425
        },
        {
          "factor": "towers",
          "ratio": 2.5,
          "weight": 0.1,
          "contribution": 0.25
        },
        {
          "factor": "credits",
          "ratio": 1.3908,
          "weight": 0.3,
          "contribution": 0.4172
        },
        {
          "factor": "distance",
          "ratio": 1.4375,
          "weight": 0.15,
          "contribution": 0.2156
        },
        {
          "factor": "basehp",
          "ratio": 55,
          "weight": 0.15,
          "contribution": 8.25
        }
      ]
    },
    {
      "id": "fFjIRuqlySFXWqLC2Zp31",
      "event_id": "4kyRl8tivM34pV2BCLg4l",
      "war_name": "War Session C",
      "enemy_name": "Crimson Tide",
      "result": "win",
      "own_kills": 42,
      "own_towers": 7,
      "own_base_hp": 58,
      "own_credits": 14200,
      "own_distance": 5100,
      "enemy_kills": 31,
      "enemy_towers": 4,
      "enemy_base_hp": 0,
      "enemy_credits": 10500,
      "enemy_distance": 4200,
      "duration_minutes": null,
      "notes": "Clean sweep — great coordination",
      "created_by": "UjIo6k7f9irUESw-oG
... (truncated)

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.383Z] GET /api/wiki/categories → 200 (37ms)
[
  {
    "id": "FgJl4GLq2ywndSIiL4fg4",
    "name": "123",
    "slug": "123",
    "sort_order": 0,
    "parent_id": null,
    "created_at": "2026-03-05T06:26:17.233Z",
    "updated_at": "2026-03-05T06:26:17.233Z"
  },
  {
    "id": "eSducMw_MkQb0cgWu1uhG",
    "name": "General",
    "slug": "general",
    "sort_order": 0,
    "parent_id": null,
    "created_at": "2026-03-04T14:21:43.335Z",
    "updated_at": "2026-03-04T14:21:43.335Z"
  },
  {
    "id": "BTVEtoDWG-9Kb1_RoR-Xy",
    "name": "Builds",
    "slug": "builds",
    "sort_order": 1,
    "parent_id": null,
    "created_at": "2026-03-04T14:21:43.335Z",
    "updated_at": "2026-03-04T14:21:43.335Z"
  },
  {
    "id": "L_uQcjob2IUWYyrYGiwH7",
    "name": "War",
    "slug": "war",
    "sort_order": 2,
    "parent_id": null,
    "created_at": "2026-03-04T14:21:43.335Z",
    "updated_at": "2026-03-04T14:21:43.335Z"
  }
]

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.422Z] POST /api/wiki/categories → 201 (40ms)
{
  "id": "B5NzR75wpu9zwSTDO_b55",
  "name": "API Category 1772774898422",
  "slug": "api-category-1772774898422",
  "sort_order": 0,
  "parent_id": null,
  "created_at": "2026-03-06T05:28:18.428Z",
  "updated_at": "2026-03-06T05:28:18.428Z"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.464Z] PATCH /api/wiki/categories/B5NzR75wpu9zwSTDO_b55 → 200 (38ms)
{
  "id": "B5NzR75wpu9zwSTDO_b55",
  "name": "API Category Updated 1772774898464",
  "slug": "api-category-1772774898422",
  "sort_order": 0,
  "parent_id": null,
  "created_at": "2026-03-06T05:28:18.428Z",
  "updated_at": "2026-03-06T05:28:18.428Z"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.505Z] DELETE /api/wiki/categories/B5NzR75wpu9zwSTDO_b55 → 200 (41ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.550Z] GET /api/wiki/articles?page=1&limit=5 → 200 (50ms)
{
  "data": [
    {
      "id": "bV3Fq9kTO9P6tN2_YC5Ya",
      "title": "Getting Started",
      "slug": "getting-started",
      "category_id": "eSducMw_MkQb0cgWu1uhG",
      "body_json": "{\"content\":\"Welcome guide\"}",
      "sort_order": 0,
      "archived_at": null,
      "created_by": "UjIo6k7f9irUESw-oGTso",
      "updated_by": "updated_by",
      "created_at": "2026-03-04T14:21:43.336Z",
      "updated_at": "2026-03-04T14:21:43.336Z"
    },
    {
      "id": "K58Fwgj9BUrRi_m4r68X1",
      "title": "Class Build Basics",
      "slug": "class-build-basics",
      "category_id": "BTVEtoDWG-9Kb1_RoR-Xy",
      "body_json": "{\"content\":\"Build intro\"}",
      "sort_order": 1,
      "archived_at": null,
      "created_by": "b62Nnp-yMfBiTA_sJlCVi",
      "updated_by": "updated_by",
      "created_at": "2026-03-04T14:21:43.336Z",
      "updated_at": "2026-03-04T14:21:43.336Z"
    },
    {
      "id": "83q1Nz31CwwJAqQHZWwM1",
      "title": "War Rotation",
      "slug": "war-rotation",
      "category_id": "L_uQcjob2IUWYyrYGiwH7",
      "body_json": "{\"content\":\"Rotation strategy\"}",
      "sort_order": 2,
      "archived_at": null,
      "created_by": "7zfjCYSZi4s0JpzlLMkA2",
      "updated_by": "updated_by",
      "created_at": "2026-03-04T14:21:43.336Z",
      "updated_at": "2026-03-04T14:21:43.336Z"
    },
    {
      "id": "gRD2E-siq9dcrL4wnLQ6b",
      "title": "Support Role Notes",
      "slug": "support-role-notes",
      "category_id": "BTVEtoDWG-9Kb1_RoR-Xy",
      "body_json": "{\"content\":\"Support details\"}",
      "sort_order": 3,
      "archived_at": null,
      "created_by": "a_TG81KjhvZUM__qzh6Dn",
      "updated_by": "updated_by",
      "created_at": "2026-03-04T14:21:43.336Z",
      "updated_at": "2026-03-04T14:21:43.336Z"
    }
  ],
  "total": 4,
  "page": 1,
  "limit": 5,
  "total_pages": 1
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.602Z] GET /api/wiki/articles/getting-started → 200 (38ms)
{
  "id": "bV3Fq9kTO9P6tN2_YC5Ya",
  "title": "Getting Started",
  "slug": "getting-started",
  "category_id": "eSducMw_MkQb0cgWu1uhG",
  "body_json": "{\"content\":\"Welcome guide\"}",
  "sort_order": 0,
  "archived_at": null,
  "created_by": "UjIo6k7f9irUESw-oGTso",
  "updated_by": "updated_by",
  "created_at": "2026-03-04T14:21:43.336Z",
  "updated_at": "2026-03-04T14:21:43.336Z"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.642Z] POST /api/wiki/articles → 500 (39ms) | ERROR: 500 Internal Server Error
{
  "error_code": "SERVER_ERROR",
  "message": "D1_ERROR: table wiki_articles has no column named updated_by: SQLITE_ERROR",
  "request_id": "9a376af6-cb95-4a82-a033-ac2cb3bcb442"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.688Z] PATCH /api/wiki/articles/bV3Fq9kTO9P6tN2_YC5Ya → 500 (41ms) | ERROR: 500 Internal Server Error
{
  "error_code": "SERVER_ERROR",
  "message": "D1_ERROR: no such column: updated_by: SQLITE_ERROR",
  "request_id": "3745514a-0a95-4fb6-a58c-0d60bcc4bbed"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.731Z] DELETE /api/wiki/articles/bV3Fq9kTO9P6tN2_YC5Ya → 500 (43ms) | ERROR: 500 Internal Server Error
{
  "error_code": "SERVER_ERROR",
  "message": "D1_ERROR: no such column: updated_by: SQLITE_ERROR",
  "request_id": "8ac172a6-1afb-48c5-ad74-dc3037670e12"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.777Z] POST /api/wiki/articles/bV3Fq9kTO9P6tN2_YC5Ya/images → 200 (42ms)
{
  "keys": [
    "wiki/bV3Fq9kTO9P6tN2_YC5Ya/images/1772774898786_OzrgtR5ORhNJWYFTd2yUP"
  ]
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.822Z] GET /api/admin/invite-links → 200 (38ms)
[
  {
    "id": "Ehdvy0fZOQEkz6sSWCsXw",
    "code": "SEEDLIVE",
    "created_by": "UjIo6k7f9irUESw-oGTso",
    "max_uses": 100,
    "used_count": 2,
    "expires_at": "2026-04-03T14:21:42.358Z",
    "created_at": "2026-03-04T14:21:43.338Z",
    "revoked_at": null
  }
]

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.862Z] GET /api/admin/invite-links/stats → 200 (40ms)
{
  "total": 4,
  "active": 1,
  "revoked": 2,
  "expired": 1,
  "data": [
    {
      "id": "Ehdvy0fZOQEkz6sSWCsXw",
      "used_count": 2,
      "max_uses": 100,
      "expires_at": "2026-04-03T14:21:42.358Z",
      "revoked_at": null
    },
    {
      "id": "4w6FCL9Dp0zxtzYfdGFnb",
      "used_count": 10,
      "max_uses": 10,
      "expires_at": "2026-03-03T14:21:42.358Z",
      "revoked_at": null
    },
    {
      "id": "wDzK6g8SNXnqKrYUfBFd4",
      "used_count": 0,
      "max_uses": 10,
      "expires_at": null,
      "revoked_at": "2026-03-05T00:49:00.304Z"
    },
    {
      "id": "-zQIBY3ALbY3Ct9gk6Pm8",
      "used_count": 0,
      "max_uses": 1,
      "expires_at": null,
      "revoked_at": "2026-03-06T05:22:32.241Z"
    }
  ]
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.905Z] POST /api/admin/invite-links → 201 (39ms)
{
  "id": "kKfOQf7FE9CMcaZSr7YaV",
  "code": "3G6EJ653",
  "created_by": "UjIo6k7f9irUESw-oGTso",
  "max_uses": 1,
  "used_count": 0,
  "expires_at": null,
  "created_at": "2026-03-06T05:28:18.911Z",
  "revoked_at": null
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:18.947Z] DELETE /api/admin/invite-links/kKfOQf7FE9CMcaZSr7YaV → 200 (79ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.028Z] GET /api/admin/audit-log?page=1&limit=5 → 200 (45ms)
{
  "data": [
    {
      "id": "PrwJwJYmNPKwhU_luMqys",
      "entity_type": "invite_link",
      "action": "revoke",
      "actor_id": "UjIo6k7f9irUESw-oGTso",
      "entity_id": "kKfOQf7FE9CMcaZSr7YaV",
      "diff_title": "3G6EJ653",
      "detail_text": null,
      "created_at": "2026-03-06T05:28:18.954Z"
    },
    {
      "id": "PzXuKAVyoyeky4BDb-DZ9",
      "entity_type": "invite_link",
      "action": "create",
      "actor_id": "UjIo6k7f9irUESw-oGTso",
      "entity_id": "kKfOQf7FE9CMcaZSr7YaV",
      "diff_title": "3G6EJ653",
      "detail_text": "{\"max_uses\":1,\"expires_at\":null}",
      "created_at": "2026-03-06T05:28:18.913Z"
    },
    {
      "id": "AqJSAwYM9euYY_g7fu4Ob",
      "entity_type": "wiki_article",
      "action": "upload_images",
      "actor_id": "UjIo6k7f9irUESw-oGTso",
      "entity_id": "bV3Fq9kTO9P6tN2_YC5Ya",
      "diff_title": null,
      "detail_text": "{\"keys\":[\"wiki/bV3Fq9kTO9P6tN2_YC5Ya/images/1772774898786_OzrgtR5ORhNJWYFTd2yUP\"]}",
      "created_at": "2026-03-06T05:28:18.793Z"
    },
    {
      "id": "APLQYF4ENNwF28K15nw8J",
      "entity_type": "wiki_category",
      "action": "delete",
      "actor_id": "UjIo6k7f9irUESw-oGTso",
      "entity_id": "B5NzR75wpu9zwSTDO_b55",
      "diff_title": "API Category Updated 1772774898464",
      "detail_text": null,
      "created_at": "2026-03-06T05:28:18.515Z"
    },
    {
      "id": "a2nOtZDcUPcReL3bHaIaU",
      "entity_type": "wiki_category",
      "action": "update",
      "actor_id": "UjIo6k7f9irUESw-oGTso",
      "entity_id": "B5NzR75wpu9zwSTDO_b55",
      "diff_title": "API Category Updated 1772774898464",
      "detail_text": "{\"name\":\"API Category Updated 1772774898464\"}",
      "created_at": "2026-03-06T05:28:18.473Z"
    }
  ],
  "total": 159,
  "page": 1,
  "limit": 5,
  "total_pages": 32,
  "start_at": "2025-12-06T05:28:19.035Z",
  "end_at": "2026-03-06T05:28:19.035Z"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.077Z] GET /api/admin/audit-log/export?format=json → 200 (41ms)
{
  "exported_at": "2026-03-06T05:28:19.087Z",
  "start_at": "2025-12-06T05:28:19.083Z",
  "end_at": "2026-03-06T05:28:19.083Z",
  "total": 159,
  "data": [
    {
      "id": "PrwJwJYmNPKwhU_luMqys",
      "entity_type": "invite_link",
      "action": "revoke",
      "actor_id": "UjIo6k7f9irUESw-oGTso",
      "entity_id": "kKfOQf7FE9CMcaZSr7YaV",
      "diff_title": "3G6EJ653",
      "detail_text": null,
      "created_at": "2026-03-06T05:28:18.954Z"
    },
    {
      "id": "PzXuKAVyoyeky4BDb-DZ9",
      "entity_type": "invite_link",
      "action": "create",
      "actor_id": "UjIo6k7f9irUESw-oGTso",
      "entity_id": "kKfOQf7FE9CMcaZSr7YaV",
      "diff_title": "3G6EJ653",
      "detail_text": "{\"max_uses\":1,\"expires_at\":null}",
      "created_at": "2026-03-06T05:28:18.913Z"
    },
    {
      "id": "AqJSAwYM9euYY_g7fu4Ob",
      "entity_type": "wiki_article",
      "action": "upload_images",
      "actor_id": "UjIo6k7f9irUESw-oGTso",
      "entity_id": "bV3Fq9kTO9P6tN2_YC5Ya",
      "diff_title": null,
      "detail_text": "{\"keys\":[\"wiki/bV3Fq9kTO9P6tN2_YC5Ya/images/1772774898786_OzrgtR5ORhNJWYFTd2yUP\"]}",
      "created_at": "2026-03-06T05:28:18.793Z"
    },
    {
      "id": "APLQYF4ENNwF28K15nw8J",
      "entity_type": "wiki_category",
      "action": "delete",
      "actor_id": "UjIo6k7f9irUESw-oGTso",
      "entity_id": "B5NzR75wpu9zwSTDO_b55",
      "diff_title": "API Category Updated 1772774898464",
      "detail_text": null,
      "created_at": "2026-03-06T05:28:18.515Z"
    },
    {
      "id": "a2nOtZDcUPcReL3bHaIaU",
      "entity_type": "wiki_category",
      "action": "update",
      "actor_id": "UjIo6k7f9irUESw-oGTso",
      "entity_id": "B5NzR75wpu9zwSTDO_b55",
      "diff_title": "API Category Updated 1772774898464",
      "detail_text": "{\"name\":\"API Category Updated 1772774898464\"}",
      "created_at": "2026-03-06T05:28:18.473Z"
    },
    {
      "id": "i5J9dVHva3X0Qjs6vU2De",
      "entity_type": "wiki_category",
      "action"
... (truncated)

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.119Z] GET /api/admin/audit-archive/months → 200 (45ms)
{
  "months": [
    "2026-03"
  ],
  "source": "d1_legacy"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.166Z] GET /api/admin/audit-archive/download?month=2026-03&format=raw_ndjson_gz → 404 (45ms) | ERROR: 404 Not Found
{
  "error_code": "NOT_FOUND",
  "message": "Archive month not found",
  "request_id": "a7c52d22-a541-475e-8f93-272346c0d997"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.215Z] GET /api/admin/audit-archive/download/file → ERR (0ms) | ERROR: Skipped
Missing download token (run archive download first)

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.215Z] GET /api/admin/audit-archive/2025-01 → 200 (53ms)
{
  "month": "2025-01",
  "total": 0,
  "page": 1,
  "limit": 50,
  "total_pages": 1,
  "source": "d1_legacy",
  "manifest": null,
  "data": []
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.270Z] POST /api/admin/users → 201 (70ms)
{
  "ok": true,
  "user_id": "mUAsuijZAndEuYqCZsYs5",
  "username": "apitester_1772774899270",
  "temporary_password": "kWTgM7aEFepz"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.341Z] PATCH /api/admin/users/batch/role → 200 (42ms)
{
  "ok": true,
  "updated": 1
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.384Z] PATCH /api/admin/users/batch/deactivate → 200 (39ms)
{
  "ok": true,
  "updated": 1
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.426Z] PATCH /api/admin/users/batch/reactivate → 200 (42ms)
{
  "ok": true,
  "updated": 1
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.470Z] PATCH /api/admin/users/batch/delete → 200 (41ms)
{
  "ok": true,
  "updated": 0
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.514Z] PATCH /api/admin/users/mUAsuijZAndEuYqCZsYs5/role → 200 (42ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.559Z] PATCH /api/admin/users/mUAsuijZAndEuYqCZsYs5/deactivate → 200 (44ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.605Z] PATCH /api/admin/users/mUAsuijZAndEuYqCZsYs5/reactivate → 200 (42ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.650Z] POST /api/admin/users/mUAsuijZAndEuYqCZsYs5/reset-password → 200 (69ms)
{
  "ok": true,
  "temporary_password": "TempPass123!"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.721Z] GET /api/admin/roles → 500 (43ms) | ERROR: 500 Internal Server Error
{
  "error_code": "SERVER_ERROR",
  "message": "D1_ERROR: no such table: roles: SQLITE_ERROR",
  "request_id": "e0481213-ea36-49e6-be73-e833f694e61c"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.765Z] POST /api/admin/roles → 500 (44ms) | ERROR: 500 Internal Server Error
{
  "error_code": "SERVER_ERROR",
  "message": "D1_ERROR: no such table: roles: SQLITE_ERROR",
  "request_id": "cb659d98-8513-4024-80bc-ece7f9965187"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.811Z] PATCH /api/admin/roles/:id → ERR (0ms) | ERROR: Skipped
Missing admin role id

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.811Z] DELETE /api/admin/roles/:id → ERR (0ms) | ERROR: Skipped
Missing admin role id

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.811Z] GET /api/admin/bot-settings → 200 (41ms)
{
  "discord": {
    "guild_id": "",
    "notification_channel_id": "",
    "team_comp_channel_id": "",
    "default_toggles": {}
  },
  "wechat": {
    "room_ids": [],
    "default_toggles": {}
  }
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.855Z] GET /api/admin/bot-settings/discord/channels → 400 (42ms) | ERROR: 400 Bad Request
{
  "error_code": "VALIDATION_ERROR",
  "message": "Discord guild_id is required",
  "request_id": "a9e0ed2a-1cd6-4263-af8d-4302fd157137"
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.899Z] PATCH /api/admin/bot-settings → 200 (46ms)
{
  "ok": true
}

────────────────────────────────────────────────────────────────────────────────

[2026-03-06T05:28:19.948Z] POST /api/admin/bot-settings/test → 400 (86ms) | ERROR: 400 Bad Request
{
  "error_code": "VALIDATION_ERROR",
  "message": "Discord notification channel is not configured",
  "request_id": "4cbc8bdc-3f31-416c-8c26-d7db2e96b54c"
}