interface RatingButtonProps {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

/**
 * The 👍/👎 toggle shared by the proposal card and the rated-recipes list.
 * `aria-pressed` carries the selection state; `aria-label` names the action —
 * the icon child is decorative.
 */
export function RatingButton({ label, active, disabled, onClick, children }: RatingButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center rounded-lg border p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-purple-400/60 bg-purple-500/30 text-purple-200"
          : "border-white/10 bg-white/5 text-blue-100/60 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
