# Final Implementation Plan

**Based on:** Full Codebase Audit (2026-03-05)
**Target:** 13-week systematic refactor
**Repos:** Infini-Guild-Management, Infini-Dev-Kit, Infini-Demo

---

## Executive Summary

**Audit Findings:**
- 718 files, 399 logical nodes, 100% coverage
- 6 themes with perfect token consistency
- ~673 hardcoded strings need i18n
- 1 redundant package (dayjs - REMOVED)
- 0 components replaceable by Mantine
- Dashboard needs icons (6 cards, 13 pages)
- API layer needs type safety improvements

**Status:** Architecture is lean and well-designed. Only refinements needed.

---

## Phase A: Foundation (Weeks 1-3)

### Week 1: Date Library Migration ✅
- [x] Replace dayjs with date-fns in AnnouncementsPage
- [x] Replace dayjs with date-fns in EventMonthView
- [x] Remove dayjs from package.json
- [ ] Run `pnpm install` to update lockfile
- [ ] Test all date operations

### Week 2: i18n Critical Path
**Priority:** API errors, Auth, Notifications

**Files to update:**
1. `apps/portal/api/client.ts`
   - Move error messages to `i18n/en/common.json`
   - Add error code mapping system

2. `apps/portal/components/auth/AuthHero.tsx`
   - Extract to `i18n/en/auth.json`

3. `apps/portal/components/feature/admin/AdminMemberMediaTab.tsx`
   - Extract notifications to `i18n/en/common.json`

**Deliverable:** All user-facing errors internationalized

### Week 3: Icon System Setup
**Priority:** Dashboard cards

**Add icons to:**
- ActiveMembersCard → IconUsers
- LastWarCard → IconSwords
- MySignupsCard → IconCalendarEvent
- NotificationsCard → IconBell
- UpcomingEventsCard → IconCalendar

**Pattern:**
```tsx
import { IconUsers } from "@tabler/icons-react";

<InfiniCard>
  <Group>
    <IconUsers size={20} style={{ color: 'var(--infini-color-primary)' }} />
    <Title>Active Members</Title>
  </Group>
</InfiniCard>
```

---

## Phase B: API Layer (Weeks 4-6)

### Week 4: Type Safety
**Replace generic payloads with Zod schemas**

**Files:**
- `api/mutations/announcements.ts`
- `api/mutations/guild-war.ts`
- `api/mutations/users.ts`
- `api/mutations/wiki.ts`

**Pattern:**
```ts
import { z } from "zod";

const UpdateAnnouncementSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  pinned: z.boolean().optional(),
});

export function updateAnnouncement(
  id: string,
  payload: z.infer<typeof UpdateAnnouncementSchema>
) {
  const validated = UpdateAnnouncementSchema.parse(payload);
  return apiRequest(`/announcements/${id}`, {
    method: "PATCH",
    bodyJson: validated
  });
}
```

### Week 5: Error Handling
**Remove hardcoded error messages**

1. Backend: Return structured error codes
2. Frontend: Map codes to i18n keys
3. Remove `sanitizeErrorMessage()` function

### Week 6: Caching Strategy
**Remove custom ETag cache**

1. Delete `etagCache` Map from `api/client.ts`
2. Configure TanStack Query cache:
```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min
      gcTime: 10 * 60 * 1000,   // 10 min
    },
  },
});
```

---

## Phase C: i18n Completion (Weeks 7-9)

### Week 7: Admin UI
**Add i18n to all admin components**

**Files (15 total):**
- AdminAuditSection.tsx
- AdminBotSection.tsx
- AdminInviteSection.tsx
- AdminMemberDetailModal.tsx
- AdminRolesSection.tsx
- AdminSystemSection.tsx
- AdminUsersSection.tsx
- (8 more)

**Pattern:**
```tsx
const { t } = useTranslation("admin");

<TextInput
  label={t("label.discordGuildId")}
  aria-label={t("label.discordGuildId")}
/>
```

### Week 8: Pages
**Add i18n to 13 pages missing imports**

**Pages:**
- AdminPage, AnnouncementsPage, DashboardPage
- EventsPage, GalleryPage, GuildWarPage
- LoginPage, RegisterPage, SettingsPage
- RosterPage, ToolsPage, WikiPage, MyProfilePage

### Week 9: Validation
**Automated extraction and testing**

1. Run i18n extraction tool
2. Verify all `t()` usage
3. Add missing zh translations
4. Test language switching

---

## Phase D: Visual Enhancement (Weeks 10-11)

### Week 10: Page Header Icons
**Add icons to all 13 pages**

**Mapping:**
```tsx
AdminPage → IconSettings
AnnouncementsPage → IconSpeakerphone
DashboardPage → IconLayoutDashboard
EventsPage → IconCalendarEvent
GalleryPage → IconPhoto
GuildWarPage → IconSwords
RosterPage → IconUsers
ToolsPage → IconTool
WikiPage → IconBook
SettingsPage → IconSettings
MyProfilePage → IconUserCircle
```

### Week 11: Action Buttons & Status Icons
**Add leftSection icons to buttons**

**Common patterns:**
- Create → IconPlus
- Edit → IconEdit
- Delete → IconTrash
- Save → IconDeviceFloppy
- Cancel → IconX
- Upload → IconUpload
- Download → IconDownload
- Search → IconSearch
- Filter → IconFilter

**Status indicators:**
- Victory → IconCircleCheck (green)
- Defeat → IconCircleX (red)
- Upcoming → IconClock (blue)
- Completed → IconCheck (green)

---

## Phase E: Polish & Optimization (Weeks 12-13)

### Week 12: Bundle Optimization
**Analyze and reduce bundle size**

1. Run `vite-bundle-visualizer`
2. Add tree-shaking hints
3. Lazy load heavy components
4. Measure improvements

**Expected savings:**
- dayjs removal: ~2.5MB ✅
- Tree-shaking: ~1-2MB
- Lazy loading: ~3-5MB

### Week 13: Final Validation
**Cross-theme testing and documentation**

1. Test all 6 themes in portal
2. Verify icon visibility in all themes
3. Test i18n switching (en/zh)
4. Update Dev Kit docs
5. Create migration guide

---

## Success Metrics

**Code Quality:**
- [ ] 0 hardcoded user-facing strings
- [ ] 0 `Record<string, unknown>` in API
- [ ] 100% icon coverage on actions
- [ ] <500KB bundle size reduction

**User Experience:**
- [ ] Full i18n support (en/zh)
- [ ] Visual hierarchy with icons
- [ ] Consistent theme application
- [ ] Fast page loads (<2s)

**Developer Experience:**
- [ ] Type-safe API calls
- [ ] Clear error messages
- [ ] Documented patterns
- [ ] Migration guide

---

## Risk Mitigation

**High Risk:**
- API type changes may break existing calls
- **Mitigation:** Incremental rollout, comprehensive testing

**Medium Risk:**
- i18n extraction may miss edge cases
- **Mitigation:** Manual review + automated tools

**Low Risk:**
- Icon additions are purely additive
- **Mitigation:** None needed

---

## Next Steps

1. Run `pnpm install` to remove dayjs
2. Start Week 2: i18n critical path
3. Weekly progress reviews
4. Adjust timeline as needed

**Estimated completion:** 2026-05-30 (13 weeks from 2026-03-05)
