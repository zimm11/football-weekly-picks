import { colors, fonts } from "./theme";
import type { WebSelectProps } from "./WebSelect";

export type { WebSelectProps };

/** See WebSelect.tsx. A chevron is drawn over the control, since `appearance: none` removes the browser's. */
export function WebSelect({ label, value, choices, onChange, disabled, compact }: WebSelectProps) {
  return (
    <div style={{ position: "relative", display: "flex", opacity: disabled ? 0.45 : 1 }}>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          flex: 1,
          minWidth: 0,
          minHeight: 44,
          margin: 0,
          paddingLeft: compact ? 16 : 12,
          paddingRight: 36,
          borderRadius: compact ? 100 : 10,
          border: compact ? "none" : `1px solid ${colors.input}`,
          backgroundColor: compact ? colors.raised : `${colors.background}99`,
          color: colors.foreground,
          fontFamily: compact ? fonts.semibold : fonts.body,
          fontSize: compact ? 14 : 16,
          cursor: disabled ? "default" : "pointer",
          colorScheme: "dark",
        }}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 256 256"
        style={{ position: "absolute", right: 14, top: "50%", marginTop: -7, pointerEvents: "none" }}
      >
        <polyline
          points="208 96 128 176 48 96"
          fill="none"
          stroke={colors.mutedForeground}
          strokeWidth="16"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
