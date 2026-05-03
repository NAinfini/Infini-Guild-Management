# Database Seed Gaps Analysis

## Summary
Analyzed all portal pages against the D1 database seed data to identify missing mock data.

## All Gaps Fixed ✅

### 1. War Member Stats
Added 8 stat fields to all war team members: kills, deaths, assists, damage, healing, buildingDamage, credits, damageTaken.

### 2. Sessions
Added 2 active sessions (admin + mod_1).

### 3. Moderator Profiles (was MISSING)
**Issue**: mod_1, mod_2, mod_3 had NO member_profiles rows, breaking roster display, war MVP name resolution, and user detail modals.
**Fixed**: Added 3 moderator profiles with power, classes, and availability.

### 4. Wiki Articles — TipTap Content
**Issue**: Articles used `{content: "text"}` instead of proper TipTap `{type: "doc", content: [...]}` format.
**Fixed**: All articles now use full TipTap JSON with headings, paragraphs, bullet lists, and bold/italic marks. Added 3 new articles for sub-categories (8 total).

### 5. Wiki Sub-Categories
**Issue**: All 3 categories were top-level. Wiki tree component's nesting was never exercised.
**Fixed**: Added 5 sub-categories: FAQ (under General), DPS Builds & Support Builds (under Builds), Offense & Defense (under War).

### 6. Recurring Event Templates
**Issue**: Zero events had `isSeriesParent: true` or `recurrenceRule`. RecurringTemplatesTab showed empty.
**Fixed**: Added 3 recurring templates — Weekly Raid Night (weekly, Wed+Fri), Bi-Weekly War Practice (biweekly, Sat), Monthly Guild Meeting (monthly, 1st).

### 7. War History Duration
**Issue**: All 4 war records had null `durationMinutes`.
**Fixed**: Added realistic durations: 42, 55, 38, 60 minutes.

### 8. Event Attachments
**Issue**: All events had empty `attachments: '[]'`.
**Fixed**: Added mock attachment paths to 2 events (Weekly Mission Alpha, Guild War #1).

### 9. Gallery Volume
**Issue**: Only 10 items (7 images + 3 videos). Pagination barely exercised.
**Fixed**: Increased to 28 items (20 images + 8 videos) with varied uploaders including moderators.

## Data Coverage Summary

| Entity | Seeded | Quality | Notes |
|--------|--------|---------|-------|
| Users | 19 (1 admin, 3 mods, 15 members) | ✅ Excellent | Includes inactive users, vacations |
| Member Profiles | 19 (1 admin + 3 mods + 15 members) | ✅ Excellent | All users have profiles |
| Events | 17 (14 regular + 3 recurring templates) | ✅ Excellent | All types, pinned, archived, locked, recurring |
| Event Participants | ~120 | ✅ Excellent | Varied participation |
| Announcements | 4 | ✅ Good | All statuses (draft, scheduled, published, archived) |
| War History | 4 | ✅ Excellent | Win/loss/draw, full stats, durations |
| War Teams | 8 (2 per war) | ✅ Excellent | Alpha/Bravo naming |
| War Team Members | 32 | ✅ Excellent | Full stats (8 fields each) |
| War Pool Members | 12 | ✅ Good | Backup members |
| War Templates | 3 | ✅ Excellent | Standard, Rush, Defense formations |
| Wiki Categories | 8 (3 top + 5 sub) | ✅ Excellent | Nested tree structure |
| Wiki Articles | 8 | ✅ Excellent | Rich TipTap content, articles in sub-categories |
| Gallery Items | 28 (20 images + 8 videos) | ✅ Good | Pagination exercised |
| Gallery Likes | ~100+ | ✅ Good | Varied engagement |
| Gallery Comments | ~40+ | ✅ Good | Realistic comments |
| Invite Links | 3 | ✅ Excellent | Active, expired, revoked |
| Sessions | 2 | ✅ Good | Admin + mod_1 |
| Audit Log | 10 | ✅ Excellent | Varied actions |
| Roles | 3 | ✅ Excellent | Admin, Moderator, Member |
| Role Permissions | 60 | ✅ Excellent | Full RBAC matrix |

## Test Credentials

```
Admin:     admin / admin123
Mod 1:     mod_1 / moderator123
Mod 2:     mod_2 / moderator223
Mod 3:     mod_3 / moderator323
Member 1:  member_01 / member1234
Member 2:  member_02 / member2234
...
Member 15: member_15 / member15234
```
