import { LIMITS } from "@guild/shared/config/limits";
import { TrashIcon } from "@portal/components/icons";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@portal/components/ui/card";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { Skeleton } from "@portal/components/ui/skeleton";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMemberAbsences } from "../../hooks/useMemberAbsences";
import { localDateKey } from "../../utils/datetime";
import { NativeDateTimeInput } from "./NativeDateTimeInput";
import "./AbsenceManagerCard.css";

type AbsenceManagerCardProps = {
  userId: string | undefined;
};

type AbsenceStatus = "past" | "upcoming" | "active";

export function AbsenceManagerCard({ userId }: AbsenceManagerCardProps) {
  const { t } = useTranslation("profile");
  const { absencesQuery, createMutation, deleteMutation } = useMemberAbsences(userId);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");

  const absences = absencesQuery.data?.data ?? [];
  const canSubmit = Boolean(startDate && endDate && startDate <= endDate);

  const handleAdd = () => {
    if (!canSubmit) return;
    createMutation.mutate(
      { start_date: startDate, end_date: endDate, note: note.trim() ? note.trim() : null },
      {
        onSuccess: () => {
          setStartDate("");
          setEndDate("");
          setNote("");
        },
      },
    );
  };

  /* 请假起止是日历日期，要和阅读者日历上的今天比，不是和 UTC 的今天比。 */
  const today = localDateKey();
  const statusOf = (start: string, end: string): AbsenceStatus => {
    if (end < today) return "past";
    if (start > today) return "upcoming";
    return "active";
  };

  return (
    <Card size="sm" className="absence-manager-card">
      <CardHeader>
        <CardTitle>{t("absence.title")}</CardTitle>
      </CardHeader>
      <CardContent className="absence-manager-card__content">
        {absencesQuery.isLoading ? (
          <div className="absence-manager-card__list" aria-label={t("absence.title")}>
            <Skeleton className="absence-manager-card__skeleton" />
            <Skeleton className="absence-manager-card__skeleton" />
          </div>
        ) : absences.length === 0 ? (
          <p className="absence-manager-card__empty">{t("absence.empty")}</p>
        ) : (
          <div className="absence-manager-card__list">
            {absences.map((absence) => {
              const status = statusOf(absence.start_date, absence.end_date);
              const deletePending = deleteMutation.isPending && deleteMutation.variables === absence.id;
              return (
                <div key={absence.id} className="absence-manager-card__row">
                  <div className="absence-manager-card__summary">
                    <Badge variant="secondary" data-status={status}>
                      {t(`absence.status.${status}`)}
                    </Badge>
                    <span className="absence-manager-card__dates">
                      {absence.start_date} – {absence.end_date}
                    </span>
                    {absence.note ? <span className="absence-manager-card__note">{absence.note}</span> : null}
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="absence-manager-card__delete"
                    loading={deletePending}
                    onClick={() => deleteMutation.mutate(absence.id)}
                    aria-label={t("absence.delete")}
                  >
                    <TrashIcon aria-hidden="true" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <div className="absence-manager-card__form">
          <NativeDateTimeInput
            label={t("absence.startDate")}
            value={startDate}
            onChange={(event) => setStartDate(event.currentTarget.value)}
          />
          <NativeDateTimeInput
            label={t("absence.endDate")}
            value={endDate}
            onChange={(event) => setEndDate(event.currentTarget.value)}
          />
          <div className="absence-manager-card__note-field">
            <Label htmlFor="absence-note">{t("absence.note")}</Label>
            <Input
              id="absence-note"
              value={note}
              maxLength={LIMITS.content.absenceNote.max}
              placeholder={t("absence.notePlaceholder")}
              onChange={(event) => setNote(event.currentTarget.value)}
            />
          </div>
          <Button
            type="button"
            className="absence-manager-card__submit"
            onClick={handleAdd}
            disabled={!canSubmit}
            loading={createMutation.isPending}
          >
            {t("absence.add")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
