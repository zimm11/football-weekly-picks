import type { CSSProperties } from "react";
import { disabledOpacity } from "./pressState";
import { colors, fonts } from "./theme";
import type { WebSelectProps } from "./WebSelect";

export type { WebSelectProps };

/**
 * See WebSelect.tsx. A chevron is drawn over the control, since `appearance: none` removes the browser's.
 *
 * The text is 16px in both shapes: iOS Safari zooms the page when a control with smaller text takes focus.
 *
 * A `<select>` is as wide as its longest option. The compact pill should be as wide as the chosen one, so an
 * unseen copy of that label sets the width and the `<select>` is laid over it; when the row is too narrow
 * the label ends in an ellipsis.
 */
export function WebSelect({ label, value, choices, onChange, disabled, compact, minWidth }: WebSelectProps) {
  const text: CSSProperties = {
    fontFamily: compact ? fonts.semibold : fonts.body,
    fontSize: 16,
    paddingLeft: compact ? 16 : 12,
    paddingRight: 36,
  };
  const chosen = choices.find((choice) => choice.value === value)?.label ?? value;
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        minWidth: 0,
        opacity: disabled ? disabledOpacity : 1,
        ...(compact ? { overflow: "hidden", borderRadius: 100 } : null),
      }}
    >
      {compact && (
        <span
          aria-hidden="true"
          style={{
            ...text,
            boxSizing: "border-box",
            minWidth,
            minHeight: 44,
            whiteSpace: "nowrap",
            visibility: "hidden",
          }}
        >
          {chosen}
        </span>
      )}
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        style={{
          ...text,
          appearance: "none",
          WebkitAppearance: "none",
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 44,
          margin: 0,
          textOverflow: "ellipsis",
          borderRadius: compact ? 100 : 10,
          border: compact ? "none" : `1px solid ${colors.input}`,
          backgroundColor: compact ? colors.raised : colors.field,
          color: colors.foreground,
          cursor: disabled ? "default" : "pointer",
          colorScheme: "dark",
          ...(compact
            ? { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }
            : { flex: 1 }),
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
