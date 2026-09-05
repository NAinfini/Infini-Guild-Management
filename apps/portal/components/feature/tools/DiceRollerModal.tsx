import { DiceFiveFilledIcon, TrashIcon } from "@portal/components/icons";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@portal/components/ui/dialog";
import { Input } from "@portal/components/ui/input";
import { Label } from "@portal/components/ui/label";
import { useLocalStorageState } from "@portal/hooks/useLocalStorageState";
import { useReducedMotionPreference } from "@portal/hooks/useReducedMotionPreference";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const ROLL_ANIM_DURATION = 1200;
const ROLL_ANIM_INTERVAL = 60;

interface DiceHistoryEntry {
  count: number;
  sides: number;
  results: number[];
  total: number;
  timestamp: number;
}

type RollAnnouncement = {
  id: number;
  message: string;
};

type DiceRollerModalProps = {
  opened: boolean;
  onClose: () => void;
};

export function DiceRollerModal({ opened, onClose }: DiceRollerModalProps) {
  const { t } = useTranslation(["tools", "common"]);
  const [diceCount, setDiceCount] = useState(1);
  const [diceSides, setDiceSides] = useState(6);
  const [diceResults, setDiceResults] = useState<number[]>([]);
  const [diceHistory, setDiceHistory] = useLocalStorageState<DiceHistoryEntry[]>("tools.diceHistory", []);
  const [isRolling, setIsRolling] = useState(false);
  const [rollAnnouncement, setRollAnnouncement] = useState<RollAnnouncement | null>(null);
  const prefersReducedMotion = useReducedMotionPreference();
  const rollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announcementIdRef = useRef(0);

  const createResults = useCallback(
    () => Array.from({ length: diceCount }, () => Math.floor(Math.random() * diceSides) + 1),
    [diceCount, diceSides],
  );

  const completeRoll = useCallback((finalResults: number[]) => {
    const total = finalResults.reduce((sum, value) => sum + value, 0);
    setDiceResults(finalResults);
    setIsRolling(false);
    setDiceHistory((previous) => [
      { count: diceCount, sides: diceSides, results: finalResults, total, timestamp: Date.now() },
      ...previous.slice(0, 49),
    ]);
    announcementIdRef.current += 1;
    setRollAnnouncement({
      id: announcementIdRef.current,
      message: t("dice.resultAnnouncement", {
        notation: `${diceCount}d${diceSides}`,
        results: finalResults.join(", "),
        total,
      }),
    });
  }, [diceCount, diceSides, setDiceHistory, t]);

  const rollDice = useCallback(() => {
    if (isRolling || diceCount < 1 || diceSides < 2) return;

    if (prefersReducedMotion) {
      completeRoll(createResults());
      return;
    }

    setIsRolling(true);

    rollIntervalRef.current = setInterval(() => {
      setDiceResults(createResults());
    }, ROLL_ANIM_INTERVAL);

    rollTimeoutRef.current = setTimeout(() => {
      if (rollIntervalRef.current) clearInterval(rollIntervalRef.current);
      rollIntervalRef.current = null;
      rollTimeoutRef.current = null;
      completeRoll(createResults());
    }, ROLL_ANIM_DURATION);
  }, [completeRoll, createResults, diceCount, diceSides, isRolling, prefersReducedMotion]);

  useEffect(() => {
    if (!prefersReducedMotion || !isRolling) return;
    if (rollIntervalRef.current) clearInterval(rollIntervalRef.current);
    if (rollTimeoutRef.current) clearTimeout(rollTimeoutRef.current);
    rollIntervalRef.current = null;
    rollTimeoutRef.current = null;
    completeRoll(createResults());
  }, [completeRoll, createResults, isRolling, prefersReducedMotion]);

  useEffect(() => {
    return () => {
      if (rollIntervalRef.current) clearInterval(rollIntervalRef.current);
      if (rollTimeoutRef.current) clearTimeout(rollTimeoutRef.current);
    };
  }, []);

  const diceTotal = useMemo(() => diceResults.reduce((sum, value) => sum + value, 0), [diceResults]);
  const hasRolled = diceResults.length > 0;
  const stageFaces: Array<number | null> = hasRolled
    ? diceResults
    : Array.from({ length: Math.max(1, Math.min(diceCount, 20)) }, () => null);

  return (
    <Dialog open={opened} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="dice__dialog" closeLabel={t("common:action.close")}>
        <DialogHeader>
          <DialogTitle>{t("dice.title")}</DialogTitle>
        </DialogHeader>
      <div className="dice">
        <div className="dice__config">
          <div className="dice__field">
            <Label htmlFor="dice-count">{t("dice.count")}</Label>
            <Input
              id="dice-count"
              type="number"
              value={diceCount}
              onChange={(event) => setDiceCount(Math.max(1, Math.min(event.currentTarget.valueAsNumber || 1, 20)))}
              min={1}
              max={20}
              disabled={isRolling}
              className="dice__input"
            />
          </div>
          <div className="dice__field">
            <Label htmlFor="dice-sides">{t("dice.sides")}</Label>
            <Input
              id="dice-sides"
              type="number"
              value={diceSides}
              onChange={(event) => setDiceSides(Math.max(2, Math.min(event.currentTarget.valueAsNumber || 2, 1000)))}
              min={2}
              max={1000}
              disabled={isRolling}
              className="dice__input"
            />
          </div>
        </div>

        <div
          className={`dice__stage${isRolling ? " dice__stage--rolling" : ""}`}
        >
          <div className="dice__notation">{diceCount}d{diceSides}</div>
          <div className="dice__results-dice" aria-hidden={isRolling || undefined}>
            {stageFaces.map((value, index) => (
              <div
                key={index}
                className={
                  `dice__die${isRolling ? " dice__die--spinning" : ""}`
                  + (value === null ? " dice__die--empty" : "")
                }
              >
                {value ?? "·"}
              </div>
            ))}
          </div>
          <div className="dice__total">
            <span className="dice__total-label">{t("dice.total")}</span>
            <span className="dice__total-value">{hasRolled && !isRolling ? diceTotal : "—"}</span>
          </div>
        </div>

        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {rollAnnouncement ? (
            <span key={rollAnnouncement.id}>{rollAnnouncement.message}</span>
          ) : null}
        </span>

        <button
          type="button"
          className={`dice__roll-btn${isRolling ? " dice__roll-btn--rolling" : ""}`}
          onClick={rollDice}
          disabled={isRolling}
        >
          <DiceFiveFilledIcon size={20} className={isRolling ? "dice__icon-spin" : ""} />
          <span>{isRolling ? t("dice.rolling") : t("dice.roll")}</span>
        </button>

        <div className="dice__history-section">
          <div className="dice__history-header">
            <span className="dice__section-label">{t("dice.history")}</span>
            {diceHistory.length > 0 && (
              <button
                type="button"
                className="dice__clear-btn"
                onClick={() => setDiceHistory([])}
              >
                <TrashIcon size={13} />
                <span>{t("dice.clearHistory")}</span>
              </button>
            )}
          </div>
          {diceHistory.length === 0 ? (
            <div className="dice__history-empty">
              <span className="dice__history-empty-copy">{t("dice.noHistory")}</span>
            </div>
          ) : (
            <div className="dice__history-list">
              {diceHistory.map((entry) => (
                <div key={entry.timestamp} className="dice__history-item">
                  <span className="dice__history-notation">{entry.count}d{entry.sides}</span>
                  <span className="dice__history-rolls">{entry.results.join(" · ")}</span>
                  <span className="dice__history-total">{entry.total}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </DialogContent>
    </Dialog>
  );
}
