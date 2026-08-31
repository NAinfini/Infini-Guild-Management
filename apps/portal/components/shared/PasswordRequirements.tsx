import { LIMITS } from "@guild/shared/config/limits";
import { PASSWORD_RULES, passwordRuleChecks } from "@guild/shared/utils/password-policy";
import { IconCheck, IconCircle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import "./PasswordRequirements.css";

export function PasswordRequirements({ id, password, confirmation }: { id: string; password: string; confirmation: string }) {
  const { t } = useTranslation("auth");
  const checks = { ...passwordRuleChecks(password), match: password.length > 0 && password === confirmation };
  return (
    <div id={id} className="password-requirements">
      <p className="password-requirements__title">{t("passwordRules.title")}</p>
      <ul className="password-requirements__list">
        {[...PASSWORD_RULES, "match" as const].map((rule) => {
          const met = password.length > 0 && checks[rule];
          const Icon = met ? IconCheck : IconCircle;
          return (
            <li key={rule} data-password-rule={rule} data-met={met}>
              <Icon size={15} aria-hidden="true" />
              <span>{t(`passwordRules.${rule}`, LIMITS.content.password)}</span>
              <span className="sr-only">{t(met ? "passwordRules.met" : "passwordRules.unmet")}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
