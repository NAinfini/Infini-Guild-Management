import { NotificationOutlined, TeamOutlined, ThunderboltOutlined } from "../../utils/icons";
import { GradientText, GrainyBackground, LampHeading } from "@infini-dev-kit/frontend/components";
import { Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

type AuthHeroProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
};

export function AuthHero({ eyebrow, title, subtitle }: AuthHeroProps) {
  const { t } = useTranslation("auth");
  const highlights = [
    {
      key: "internal",
      icon: <NotificationOutlined />,
      title: t("hero.highlight.internal.title"),
      description: t("hero.highlight.internal.description"),
    },
    {
      key: "access",
      icon: <TeamOutlined />,
      title: t("hero.highlight.access.title"),
      description: t("hero.highlight.access.description"),
    },
    {
      key: "data",
      icon: <ThunderboltOutlined />,
      title: t("hero.highlight.data.title"),
      description: t("hero.highlight.data.description"),
    },
  ] as const;

  return (
    <aside className="auth-hero" aria-label={t("hero.ariaLabel")}>
      <GrainyBackground className="auth-hero__mesh" />
      <div className="auth-hero__content">
        <div className="auth-hero__logo" aria-hidden>
          IF
        </div>
        <Text className="auth-hero__eyebrow">{eyebrow}</Text>
        <LampHeading className="auth-hero__title">
          <GradientText>{title}</GradientText>
        </LampHeading>
        <Text className="auth-hero__subtitle">{subtitle}</Text>

        <Stack gap={12} className="auth-hero__highlights">
          {highlights.map((item) => (
            <div key={item.key} className="auth-hero__highlight">
              <span className="auth-hero__highlight-icon" aria-hidden>
                {item.icon}
              </span>
              <div>
                <Text fw={700}>{item.title}</Text>
                <Text>{item.description}</Text>
              </div>
            </div>
          ))}
        </Stack>
      </div>
    </aside>
  );
}
