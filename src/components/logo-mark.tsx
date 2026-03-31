import { useId } from "react";

type LogoMarkProps = {
  as?: "div" | "span" | "h1";
  ariaLabel?: string;
  className?: string;
  variant?: "hero" | "nav" | "compact";
};

function LogoMarkAi() {
  const gradientId = useId().replace(/:/g, "");

  return (
    <span className="logo-mark-ai" aria-hidden="true">
      <svg className="logo-mark-ai-svg" viewBox="0 0 84 100" role="presentation">
        <defs>
          <linearGradient id={gradientId} x1="6" x2="78" y1="12" y2="88" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#24cc6e" />
            <stop offset="55%" stopColor="#46ec86" />
            <stop offset="100%" stopColor="#8effb4" />
          </linearGradient>
        </defs>

        <path
          className="logo-mark-ai-a-shape"
          d="M0 84L19 16H45L64 84H50L45 67H19L14 84H0ZM23 55H41L32 27L23 55Z"
          fill={`url(#${gradientId})`}
        />

        <g className="logo-mark-ai-candle-svg" fill={`url(#${gradientId})`} transform="translate(0 4)">
          <rect className="logo-mark-ai-candle-wick" height="88" rx="0" width="3" x="72.5" y="2" />
          <rect className="logo-mark-ai-candle-body" height="68" rx="0" width="16" x="66" y="12" />
        </g>
      </svg>
    </span>
  );
}

export function LogoMark({
  as = "span",
  ariaLabel = "trAIder",
  className = "",
  variant = "nav"
}: LogoMarkProps) {
  const Component = as;

  return (
    <Component
      aria-label={ariaLabel}
      className={`logo-mark logo-mark-${variant}${className ? ` ${className}` : ""}`}
    >
      <span className="logo-mark-text logo-mark-text-left">tr</span>
      <LogoMarkAi />
      <span className="logo-mark-text logo-mark-text-right">der</span>
    </Component>
  );
}
