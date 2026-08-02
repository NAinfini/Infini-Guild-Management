import { z } from "zod";
import { LIMITS } from "../config/limits";
import { CLASS_VECTOR_ICON_IDS } from "../constants/class-icons";

export const classIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => !/[\u0000-\u001F\u007F]/.test(value), {
    message: "Class ID must not contain control characters",
  });

export const classColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, {
  message: "Class color must be a six-digit hex value",
});

export const classVectorIconSchema = z.enum(CLASS_VECTOR_ICON_IDS);
export const classIconTypeSchema = z.enum(["vector", "image"]);

export const classCatalogItemSchema = z.object({
  id: classIdSchema,
  label: z.string().trim().min(1).max(80),
  color: classColorSchema,
  icon_type: classIconTypeSchema,
  vector_icon: classVectorIconSchema,
  icon_key: z.string().min(1).nullable(),
  sort_order: z.number().int().min(0).max(100_000),
  created_at: z.string(),
  updated_at: z.string(),
}).superRefine((value, context) => {
  if (value.icon_type === "image" && !value.icon_key) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["icon_key"],
      message: "Image classes require an icon key",
    });
  }
  if (value.icon_type === "vector" && value.icon_key !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["icon_key"],
      message: "Vector classes cannot reference an image key",
    });
  }
});

export const createClassCatalogItemSchema = z.object({
  label: z.string().trim().min(1).max(80),
  color: classColorSchema,
  vector_icon: classVectorIconSchema,
  sort_order: z.number().int().min(0).max(100_000).optional(),
}).strict();

export const updateClassCatalogItemSchema = createClassCatalogItemSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one class field is required",
  });

/*
 * 整表重排。请求体带的是**完整**的职业 id 顺序，不是「被拖动的那一个」的新位置。
 *
 * 为什么不做成「只报被移动那一项」：sort_order 是稀疏的（新建时取 max + 10），
 * 只报一项就得让服务端去猜前后项之间还剩不剩空位，空位用完还得重新发号——
 * 那是一套隐藏在服务端的重编号逻辑，客户端看不见也测不到。
 * 直接把整个顺序发上来，服务端按下标 * 10 重写一遍，一次 D1 batch 落库，
 * 前后端对「最终顺序是什么」不存在第二种解释。
 */
export const reorderClassCatalogSchema = z.object({
  order: z.array(classIdSchema)
    .min(1)
    .max(LIMITS.content.classCatalogSize.max)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Class order must not list the same class twice",
    }),
}).strict();

export type ClassCatalogItem = z.infer<typeof classCatalogItemSchema>;
export type CreateClassCatalogItemInput = z.infer<typeof createClassCatalogItemSchema>;
export type UpdateClassCatalogItemInput = z.infer<typeof updateClassCatalogItemSchema>;
export type ReorderClassCatalogInput = z.infer<typeof reorderClassCatalogSchema>;
