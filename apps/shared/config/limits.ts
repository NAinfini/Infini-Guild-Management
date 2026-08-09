export const LIMITS = {
  requestBody: {
    ordinary: 1024 * 1024,
    upload: 32 * 1024 * 1024,
  },
  media: {
    // Every persisted image is canonical WebP. Animated media uses video.
    allowedImageTypes: ["image/webp"] as const,
    viewImageBounds: {
      landscape: { width: 1920, height: 1080 },
      portrait: { width: 1080, height: 1920 },
      square: { width: 1080, height: 1080 },
    },
    quotas: {
      profile: 10,
      announcement: 10,
      gallery: 20,
      wiki: 10,
    },
    configurableQuotaMax: 100,
    maxFileSize: {
      siteLogo: 2 * 1024 * 1024,
      classIcon: 512 * 1024,
      profileImage: 5 * 1024 * 1024,
      profileAudio: 20 * 1024 * 1024,
      announcementImage: 5 * 1024 * 1024,
      wikiImage: 5 * 1024 * 1024,
      eventImage: 5 * 1024 * 1024,
      galleryImage: 10 * 1024 * 1024,
      storageImage: 5 * 1024 * 1024,
    },
  },
  content: {
    username: { min: 1, max: 50 },
    password: { min: 8, max: 128 },
    eventTitle: { min: 1, max: 200 },
    eventDescription: { max: 5000 },
    eventAttachments: { max: 5 },
    // Quota slots describe team composition and are independent of per-member classes.
    eventClassQuotas: { max: 20 },
    eventParticipantsBatch: { max: 99 },
    announcementTitle: { min: 1, max: 200 },
    announcementBody: { min: 1, max: 500000 },
    wikiCategoryName: { min: 1, max: 120 },
    /* 一次批量改分类最多能带多少行。分类编辑器一次提交的是所有改动过的行，
       所以这同时也是分类目录的规模上限——超过这个数就该分页而不是整屏编辑。 */
    wikiCategoryBatch: { min: 1, max: 200 },
    wikiArticleTitle: { min: 1, max: 200 },
    wikiArticleBody: { min: 1, max: 500000 },
    profileBio: { max: 2000 },
    profileTitleHtml: { max: 2000 },
    profileNotes: { max: 2000 },
    profileImages: { max: 10 },
    profileVideoUrls: { max: 10 },
    profileImagesDeleteBatch: { min: 1, max: 10 },
    absenceNote: { max: 200 },
    absenceSpanDays: { max: 366 },
    absencesPerUser: { max: 20 },
    storageName: { max: 50 },
    storageCategoryName: { max: 50 },
    storageDescription: { max: 500 },
    storageItemName: { max: 100 },
    storageItemDescription: { max: 2000 },
    storageNote: { max: 200 },
    storageImagesPerItem: { max: 5 },
    storageTransactionQuantity: { max: 1_000_000 },
    warName: { min: 1, max: 200 },
    warEnemyName: { max: 200 },
    warNotes: { max: 2000 },
    roleName: { min: 1, max: 80 },
    classLabel: { min: 1, max: 80 },
    classesPerProfile: { max: 20 },
    classTagLabel: { min: 1, max: 80 },
    /* 职业标签目录的规模上限。标签是「治疗」「坦克」这种角色词汇，是个小而稳定的
       集合；真需要几十个说明它已经不是角色而是别的东西了。 */
    classTags: { max: 50 },
    /* 一个标签最多能装几个职业。跟 classCatalogSize 取同一个数——理论上管理员可以
       把整个目录塞进一个标签，那是他的自由，不该由这里替他判断合不合理。 */
    classesPerTag: { max: 200 },
    /* 一次重排请求里最多能带多少个职业 id。重排的请求体必须是完整目录，
       所以这同时也是职业目录的规模上限——超过这个数就该分页而不是整表重排。 */
    classCatalogSize: { max: 200 },
    /* 徽章目录的规模上限，和 classCatalogSize 同一个理由：重排请求带的是整张表。 */
    badgeCatalogSize: { max: 200 },
  },
  pagination: {
    admin: 50,
    announcements: 50,
    events: 100,
    gallery: 24,
    guildWar: 20,
    storage: 24,
    users: 500,
    wiki: 50,
  },
  rateLimit: {
    auth: { maxRequests: 5, windowMs: 60_000 },
    usernameCheck: { maxRequests: 15, windowMs: 60_000 },
    mutations: { maxRequests: 80, windowMs: 60_000 },
    uploads: { maxRequests: 20, windowMs: 60_000 },
    credentials: { maxRequests: 5, windowMs: 60_000 },
    reads: { maxRequests: 120, windowMs: 60_000 },
  },
  websocket: {
    maxConnections: 1500,
    connectionsPerAccount: 12,
    handshakes: { maxRequests: 30, windowMs: 60_000 },
  },
  cache: {
    mediaMaxAgeSeconds: 3600,
  },
} as const;

export type Limits = typeof LIMITS;

// Keep one logical upload inside the request ceiling after multipart overhead.
// Images always carry two mandatory variants; audio carries only `full`.
const MAX_CONFIGURABLE_MEDIA_PAYLOAD_BYTES =
  LIMITS.requestBody.upload - LIMITS.requestBody.ordinary;
export const MAX_CONFIGURABLE_IMAGE_VARIANT_BYTES =
  Math.floor(MAX_CONFIGURABLE_MEDIA_PAYLOAD_BYTES / 2);
export const MAX_CONFIGURABLE_AUDIO_BYTES = MAX_CONFIGURABLE_MEDIA_PAYLOAD_BYTES;
