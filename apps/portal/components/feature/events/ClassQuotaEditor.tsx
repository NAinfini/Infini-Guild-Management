import type { ClassCatalogItem, ClassTag, EventClassQuotaInput } from "@guild/shared";
import { LIMITS } from "@guild/shared/config/limits";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";
import { PlusIcon, TrashIcon } from "@portal/components/icons";
import { useClassCatalog, useClassTags } from "@portal/hooks/data/useClassData";
import { useTranslation } from "react-i18next";
import { ClassIconStrip } from "./ClassIconStrip";
import { ClassPickerPopover } from "./ClassPickerPopover";
import "./ClassQuotaEditor.css";

const MAX_QUOTAS = LIMITS.content.eventClassQuotas.max;
const MAX_LABEL = LIMITS.content.classTagLabel.max;

type Catalog = ClassCatalogItem[];
type CatalogQuota = Extract<EventClassQuotaInput, { tag_id: string }>;

function isCatalogQuota(quota: EventClassQuotaInput): quota is CatalogQuota {
  return "tag_id" in quota;
}

/*
 * 职业配额编辑器，活动表单和周期模板表单共用。
 *
 * 一格配额指的是一组职业，而不是单个职业——「要 2 个治疗，牵丝霖破竹风都行」。
 * 这一组有两种来法：
 *   - 目录标签：在后台职业页建好的公用标签，多个活动共用，改一次到处生效。
 *   - 一次性组：就地起个名字、勾几个职业，只服务这一个活动／模板，不进目录。
 * 一次性组是给「这次副本特殊，临时要两个能拉怪的」这种情况留的口子，免得为了一次活动
 * 往目录里塞一个以后再没人用的标签。代价是它没有身份：每次保存整组重建，别处引用不到。
 *
 * 配额跟 capacity 是两件事，这里不做任何跟 capacity 的联动校验（见
 * apps/shared/schemas/event.ts 里同一条注释）：配额是 capacity 的子集，管理员完全
 * 可以先配好需求再决定放多少人。
 *
 * 同一个目录标签只能出现一次——服务端会因为重复项直接拒收整个请求，所以下拉里已经用掉的
 * 标签要摘掉，不能让人先配出一份必然保存失败的表单。不同标签之间重叠是允许的，一次性组
 * 之间同名也是允许的（它们天生互不相同）。
 */
type ClassQuotaEditorProps = {
  value: EventClassQuotaInput[];
  onChange: (next: EventClassQuotaInput[]) => void;
  disabled?: boolean;
};

export function ClassQuotaEditor({ value, onChange, disabled = false }: ClassQuotaEditorProps) {
  const { t } = useTranslation("events");
  const catalog = useClassCatalog();
  const tags = useClassTags();

  const used = new Set(value.flatMap((quota) => (isCatalogQuota(quota) ? [quota.tag_id] : [])));
  const unusedTags = tags.filter((tag) => !used.has(tag.id));
  const atMax = value.length >= MAX_QUOTAS;

  return (
    <div className="quota-editor">
      <p className="quota-editor__label">{t("quota.editor.label")}</p>

      {value.map((quota, index) => (
        <QuotaRow
          /* 一次性组没有 id，行的身份只能是位置。这里不支持拖动排序，增删都发生在
             数组末尾或原位，用下标当 key 不会串行。 */
          key={index}
          quota={quota}
          disabled={disabled}
          tags={tags}
          unusedTags={unusedTags}
          catalog={catalog}
          onChange={(next) => onChange(value.map((entry, position) => (position === index ? next : entry)))}
          onRemove={() => onChange(value.filter((_, position) => position !== index))}
        />
      ))}

      <div className="quota-editor__actions">
        <Button
          variant="secondary"
          size="xs"
          disabled={disabled || atMax || unusedTags.length === 0}
          onClick={() => {
            const next = unusedTags[0];
            if (next) {
              onChange([...value, { tag_id: next.id, required: 1 }]);
            }
          }}
        >
          <PlusIcon size={14} />
          {t("quota.editor.add")}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled || atMax}
          onClick={() => onChange([...value, { tag: { label: "", class_ids: [] }, required: 1 }])}
        >
          <PlusIcon size={14} />
          {t("quota.editor.addOneTime")}
        </Button>
        {atMax ? (
          <span className="quota-editor__hint">{t("quota.editor.maxReached", { max: MAX_QUOTAS })}</span>
        ) : tags.length === 0 ? (
          <span className="quota-editor__hint">{t("quota.editor.noTags")}</span>
        ) : null}
      </div>
    </div>
  );
}

function QuotaRow({
  quota,
  disabled,
  tags,
  unusedTags,
  catalog,
  onChange,
  onRemove,
}: {
  quota: EventClassQuotaInput;
  disabled: boolean;
  tags: ClassTag[];
  unusedTags: ClassTag[];
  catalog: Catalog;
  onChange: (next: EventClassQuotaInput) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("events");
  const tag = isCatalogQuota(quota) ? tags.find((entry) => entry.id === quota.tag_id) : undefined;
  const label = isCatalogQuota(quota)
    ? tag?.label ?? t("quota.editor.unknownTag")
    : quota.tag.label || t("quota.editor.oneTimeUnnamed");

  return (
    <div className="quota-editor__row">
      {isCatalogQuota(quota) ? (
        <CatalogTagSelect
          quota={quota}
          label={label}
          unusedTags={unusedTags}
          disabled={disabled}
          onChange={onChange}
        />
      ) : (
        <Input
          className="quota-editor__name"
          aria-label={t("quota.editor.oneTimeLabel")}
          placeholder={t("quota.editor.oneTimePlaceholder")}
          maxLength={MAX_LABEL}
          disabled={disabled}
          value={quota.tag.label}
          onChange={(event) => onChange({ ...quota, tag: { ...quota.tag, label: event.currentTarget.value } })}
        />
      )}
      {isCatalogQuota(quota) ? (
        /* 目录标签的职业只能在后台职业页改，这一格是只读的——虚线框就是「看，别点」。 */
        <div
          className="quota-editor__cell quota-editor__cell--readonly"
          role="group"
          aria-label={t("quota.editor.classes")}
        >
          <ClassIconStrip
            classIds={tag?.class_ids ?? []}
            catalog={catalog}
            emptyLabel={t("quota.editor.emptyTag")}
          />
        </div>
      ) : (
        <ClassPickerPopover
          classIds={quota.tag.class_ids}
          catalog={catalog}
          tags={tags}
          disabled={disabled}
          onChange={(classIds) => onChange({ ...quota, tag: { ...quota.tag, class_ids: classIds } })}
        />
      )}
      <Input
        className="quota-editor__count"
        aria-label={t("quota.editor.requiredLabel")}
        type="number"
        min={1}
        max={999}
        /* 上下箭头去掉：一行就这么宽，两个 12px 的箭头点不准，直接输数字反而快。
           min/max/clampBehavior 还在，键盘上下键也还能用，能改的范围没变。 */
        disabled={disabled}
        value={String(quota.required)}
        onChange={(event) => {
          const parsed = Number.parseInt(event.currentTarget.value, 10);
          if (Number.isFinite(parsed) && parsed >= 1) {
            onChange({ ...quota, required: Math.floor(parsed) });
          }
        }}
      />
      <Button
        variant="destructive"
        size="icon-sm"
        disabled={disabled}
        aria-label={t("quota.editor.remove", { label })}
        onClick={onRemove}
      >
        <TrashIcon size={16} />
      </Button>
    </div>
  );
}

function CatalogTagSelect({
  quota,
  label,
  unusedTags,
  disabled,
  onChange,
}: {
  quota: CatalogQuota;
  label: string;
  unusedTags: ClassTag[];
  disabled: boolean;
  onChange: (next: EventClassQuotaInput) => void;
}) {
  const { t } = useTranslation("events");
  return (
    <select
      className="quota-editor__name"
      aria-label={t("quota.editor.tagLabel")}
      value={quota.tag_id}
      /* 当前行自己的标签要留在选项里，否则这一行的 Select 会显示成空的。 */
      disabled={disabled}
      onChange={(event) => {
        if (event.currentTarget.value) {
          onChange({ ...quota, tag_id: event.currentTarget.value });
        }
      }}
    >
      <option value={quota.tag_id}>{label}</option>
      {unusedTags.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
    </select>
  );
}
