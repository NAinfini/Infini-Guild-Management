import { Group, Modal, NumberInput, Text } from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { DiceFiveFilledIcon, TrashIcon } from "@portal/components/icons";
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

type DiceRollerModalProps = {
  opened: boolean;
  onClose: () => void;
};

export function DiceRollerModal({ opened, onClose }: DiceRollerModalProps) {
  const { t } = useTranslation("tools");
  const [diceCount, setDiceCount] = useState(1);
  const [diceSides, setDiceSides] = useState(6);
  const [diceResults, setDiceResults] = useState<number[]>([]);
  const [diceHistory, setDiceHistory] = useLocalStorage<DiceHistoryEntry[]>({ key: "tools.diceHistory", defaultValue: [] });
  const [isRolling, setIsRolling] = useState(false);
  const rollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rollDice = useCallback(() => {
    if (isRolling || diceCount < 1 || diceSides < 2) return;
    setIsRolling(true);

    rollIntervalRef.current = setInterval(() => {
      setDiceResults(
        Array.from({ length: diceCount }, () => Math.floor(Math.random() * diceSides) + 1),
      );
    }, ROLL_ANIM_INTERVAL);

    rollTimeoutRef.current = setTimeout(() => {
      if (rollIntervalRef.current) clearInterval(rollIntervalRef.current);
      const finalResults = Array.from({ length: diceCount }, () => Math.floor(Math.random() * diceSides) + 1);
      setDiceResults(finalResults);
      setIsRolling(false);
      const total = finalResults.reduce((sum, value) => sum + value, 0);
      setDiceHistory((previous) => [
        { count: diceCount, sides: diceSides, results: finalResults, total, timestamp: Date.now() },
        ...previous.slice(0, 49),
      ]);
    }, ROLL_ANIM_DURATION);
  }, [diceCount, diceSides, isRolling, setDiceHistory]);

  useEffect(() => {
    return () => {
      if (rollIntervalRef.current) clearInterval(rollIntervalRef.current);
      if (rollTimeoutRef.current) clearTimeout(rollTimeoutRef.current);
    };
  }, []);

  const diceTotal = useMemo(() => diceResults.reduce((sum, value) => sum + value, 0), [diceResults]);
  const hasRolled = diceResults.length > 0;
  /* 没投过时也把骰位摆出来。原先结果区是投掷后才出现的，打开弹窗看到的是
     两个输入框、一颗孤零零的按钮，再加一段空的历史——整个弹窗中间是空的，
     而且第一次投掷会把下面的内容整体顶下去。 */
  const stageFaces: Array<number | null> = hasRolled
    ? diceResults
    : Array.from({ length: Math.max(1, Math.min(diceCount, 20)) }, () => null);

  return (
    <Modal title={t("dice.title")} opened={opened} onClose={onClose} size={560}>
      <div className="dice">
        <div className="dice__config">
          <NumberInput
            label={t("dice.count")}
            value={diceCount}
            onChange={(value) => setDiceCount(typeof value === "number" ? Math.max(1, Math.min(value, 20)) : 1)}
            min={1}
            max={20}
            disabled={isRolling}
            className="dice__input"
          />
          <NumberInput
            label={t("dice.sides")}
            value={diceSides}
            onChange={(value) => setDiceSides(typeof value === "number" ? Math.max(2, Math.min(value, 1000)) : 6)}
            min={2}
            max={1000}
            disabled={isRolling}
            className="dice__input"
          />
        </div>

        <div
          className={`dice__stage${isRolling ? " dice__stage--rolling" : ""}`}
          aria-live="polite"
        >
          <div className="dice__notation">{diceCount}d{diceSides}</div>
          <div className="dice__results-dice">
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
          {/* 总计常驻。原先只有多颗骰子且投掷结束时才出现，每次投掷都让弹窗抖一下高度。 */}
          <div className="dice__total">
            <Text size="sm" c="dimmed">{t("dice.total")}</Text>
            <Text className="dice__total-value">{hasRolled && !isRolling ? diceTotal : "—"}</Text>
          </div>
        </div>

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
          <Group justify="space-between" align="center">
            <Text size="xs" fw={600} c="dimmed" className="dice__section-label">{t("dice.history")}</Text>
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
          </Group>
          {diceHistory.length === 0 ? (
            <div className="dice__history-empty">
              <Text size="sm" c="dimmed">{t("dice.noHistory")}</Text>
            </div>
          ) : (
            <div className="dice__history-list">
              {diceHistory.map((entry) => (
                <div key={entry.timestamp} className="dice__history-item">
                  {/* 原先整行是一句 {{count}}d{{sides}} → … = … 的插值字符串：
                      灰字挤成一行读不出重点，而且 count 是 i18next 的复数保留参数。
                      拆成骰式／点数／总计三段，各自对齐。 */}
                  <span className="dice__history-notation">{entry.count}d{entry.sides}</span>
                  <span className="dice__history-rolls">{entry.results.join(" · ")}</span>
                  <span className="dice__history-total">{entry.total}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
