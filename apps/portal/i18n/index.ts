import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enCommon from "./en/common.json";
import enAuth from "./en/auth.json";
import enDashboard from "./en/dashboard.json";
import enEvents from "./en/events.json";
import enProfile from "./en/profile.json";
import enRoster from "./en/roster.json";
import enSettings from "./en/settings.json";
import enAnnouncements from "./en/announcements.json";
import enWiki from "./en/wiki.json";
import enGallery from "./en/gallery.json";
import enGuildWar from "./en/guild-war.json";
import enAdmin from "./en/admin.json";
import enTools from "./en/tools.json";
import enEditor from "./en/editor.json";
import zhCommon from "./zh/common.json";
import zhAuth from "./zh/auth.json";
import zhDashboard from "./zh/dashboard.json";
import zhEvents from "./zh/events.json";
import zhProfile from "./zh/profile.json";
import zhRoster from "./zh/roster.json";
import zhSettings from "./zh/settings.json";
import zhAnnouncements from "./zh/announcements.json";
import zhWiki from "./zh/wiki.json";
import zhGallery from "./zh/gallery.json";
import zhGuildWar from "./zh/guild-war.json";
import zhAdmin from "./zh/admin.json";
import zhTools from "./zh/tools.json";
import zhEditor from "./zh/editor.json";

const locale = localStorage.getItem("locale") ?? (navigator.language.startsWith("zh") ? "zh" : "en");

void i18n.use(initReactI18next).init({
  lng: locale,
  fallbackLng: "en",
  defaultNS: "common",
  ns: [
    "common",
    "auth",
    "dashboard",
    "events",
    "roster",
    "profile",
    "settings",
    "announcements",
    "wiki",
    "gallery",
    "guild-war",
    "admin",
    "tools",
    "editor",
  ],
  resources: {
    en: {
      common: enCommon,
      auth: enAuth,
      dashboard: enDashboard,
      events: enEvents,
      roster: enRoster,
      profile: enProfile,
      settings: enSettings,
      announcements: enAnnouncements,
      wiki: enWiki,
      gallery: enGallery,
      "guild-war": enGuildWar,
      admin: enAdmin,
      tools: enTools,
      editor: enEditor,
    },
    zh: {
      common: zhCommon,
      auth: zhAuth,
      dashboard: zhDashboard,
      events: zhEvents,
      roster: zhRoster,
      profile: zhProfile,
      settings: zhSettings,
      announcements: zhAnnouncements,
      wiki: zhWiki,
      gallery: zhGallery,
      "guild-war": zhGuildWar,
      admin: zhAdmin,
      tools: zhTools,
      editor: zhEditor,
    },
  },
  interpolation: { escapeValue: false },
});

export default i18n;
