import type { Goal } from "../lib/vaults";
import { formatSol } from "../lib/amounts";
import { useLocale } from "../i18n/locale";
import { GoalActions } from "./GoalActions";

export function GoalCard({
  goal,
  chainTime,
  onChanged,
}: {
  goal: Goal;
  chainTime: bigint | null;
  onChanged: () => void;
}) {
  const { t, locale } = useLocale();
  const progress =
    Number((goal.available * 10_000n) / goal.targetLamports) / 100;
  const locked =
    goal.unlockAt > 0n && (chainTime === null || chainTime < goal.unlockAt);
  const date =
    goal.unlockAt > 0n ? new Date(Number(goal.unlockAt) * 1000) : null;
  const unlock =
    date && !Number.isNaN(date.getTime())
      ? date.toLocaleString(locale === "zh" ? "zh-CN" : "en")
      : t("timeOutOfRange");
  return (
    <article className="panel goal-card">
      <div className="row">
        <h3>{goal.name}</h3>
        <span className={`tag ${locked ? "locked" : ""}`}>
          {locked
            ? t("lockedTag")
            : goal.unlockAt === 0n
              ? t("flexibleTag")
              : t("unlockedTag")}
        </span>
      </div>
      <p className="goal-amount">
        {formatSol(goal.available)} <small>SOL</small>
      </p>
      <div className="row muted">
        <span>{t("targetOf", { amount: formatSol(goal.targetLamports) })}</span>
        <span>{Math.min(progress, 100).toFixed(1)}%</span>
      </div>
      <progress
        max="100"
        value={Math.min(progress, 100)}
        aria-label={t("progressLabel", { name: goal.name })}
      />
      <p className="muted">
        {goal.unlockAt === 0n
          ? t("withdrawAnytime")
          : t("unlocksAt", { time: unlock })}
      </p>
      <GoalActions
        goal={goal}
        chainTime={chainTime}
        locked={locked}
        onChanged={onChanged}
      />
      <details>
        <summary>{t("accountInfo")}</summary>
        <p className="address">{goal.address}</p>
        <p className="muted">
          {t("rentNote", { amount: formatSol(goal.reserve) })}
        </p>
      </details>
    </article>
  );
}
