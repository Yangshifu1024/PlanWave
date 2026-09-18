/** PlanWave 标识（内联 SVG，currentColor）。 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M10.5 16.5l3.5 3.5 7-7.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
