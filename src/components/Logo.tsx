// Znak aplikacije „Garaža pub kviz“: garaža (streha + vrata) z vprašajem v
// vratih na prelivu cyan → vijolična (enako kot src/app/icon.svg in
// public/icon.svg — ob spremembi posodobi vse tri).
export default function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="kviz-logo-g" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
          <stop stopColor="#06B6D4" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="149" fill="url(#kviz-logo-g)" />
      <g
        transform="translate(256 256) scale(11) translate(-12 -12)"
        stroke="#fff"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M2 21V9.5L12 3l10 6.5V21" />
        <path d="M6 21V10.5h12V21" />
        <path d="M10.25 14.69a1.8 1.8 0 0 1 3.5.6c0 1.2-1.8 1.8-1.8 1.8" />
        <path d="M12 19.5h.01" />
      </g>
    </svg>
  );
}
