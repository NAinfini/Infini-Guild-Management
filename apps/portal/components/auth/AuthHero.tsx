import { NotificationOutlined, TeamOutlined, ThunderboltOutlined } from "../../utils/icons";
import { GradientText, GrainyBackground, LampHeading } from "@infini-dev-kit/frontend/components";
import { Stack, Text } from "@mantine/core";

type AuthHeroProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
};

const HIGHLIGHTS = [
  {
    key: "internal",
    icon: <NotificationOutlined />,
    title: "Internal Workspace",
    description: "For guild coordination and operations only.",
  },
  {
    key: "access",
    icon: <TeamOutlined />,
    title: "Authorized Access",
    description: "Use your assigned guild account to continue.",
  },
  {
    key: "data",
    icon: <ThunderboltOutlined />,
    title: "Operational Data",
    description: "Events, roster, and war records are managed here.",
  },
] as const;

export function AuthHero({ eyebrow, title, subtitle }: AuthHeroProps) {
  return (
    <aside className="auth-hero" aria-label="Portal introduction">
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
          {HIGHLIGHTS.map((item) => (
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
