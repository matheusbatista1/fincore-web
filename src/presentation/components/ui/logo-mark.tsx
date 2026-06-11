/** FinCore brand mark — ported 1:1 from the prototype (ui.jsx LogoMark). */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="mark"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="fcg" x1="6" y1="4" x2="34" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9B79FF" />
          <stop offset="0.55" stopColor="#7C5CFF" />
          <stop offset="1" stopColor="#5733D4" />
        </linearGradient>
        <linearGradient id="fcs" x1="8" y1="6" x2="20" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="36" height="36" rx="11" fill="url(#fcg)" />
      <rect x="2" y="2" width="36" height="18" rx="11" fill="url(#fcs)" />
      <rect x="11" y="22" width="5.2" height="8" rx="2.6" fill="#fff" fillOpacity="0.55" />
      <rect x="17.4" y="16" width="5.2" height="14" rx="2.6" fill="#fff" fillOpacity="0.78" />
      <rect x="23.8" y="10" width="5.2" height="20" rx="2.6" fill="#fff" />
      <path
        d="M25 9.4 L26.4 6.2 L29.6 7.6"
        stroke="#fff"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
