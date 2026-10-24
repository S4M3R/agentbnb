/** The AgentBnB mark: a house with the agent's typing dots inside. */
export function LogoMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path
        d="M16 3.6 4.9 12.3a2 2 0 0 0-.8 1.6v11.5a3 3 0 0 0 3 3h17.8a3 3 0 0 0 3-3V13.9a2 2 0 0 0-.8-1.6Z"
        fill="currentColor"
      />
      <circle cx="11" cy="19.5" r="1.9" fill="#fff" />
      <circle cx="16" cy="19.5" r="1.9" fill="#fff" />
      <circle cx="21" cy="19.5" r="1.9" fill="#fff" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-rausch ${className}`}>
      <LogoMark />
      <span className="text-[22px] font-bold tracking-[-0.04em]">agentbnb</span>
    </span>
  );
}
