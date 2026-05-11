import type { ReactNode } from "react";

type ActionButtonVariant = "neutral" | "primary" | "danger" | "dangerStrong";
type ActionButtonSize = "sm" | "md";
type IconButtonVariant = "neutral" | "primary" | "danger";
type IconButtonSize = "icon-sm" | "icon-md";
type SegmentedOption = { value: string; label: string; icon?: ReactNode; disabled?: boolean };

export function ToolLayout({
  title,
  description,
  actions,
  children
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="grid w-full gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-4xl">
          <h2 className="text-[23px] font-semibold leading-[1.14] tracking-normal text-[var(--ui-text)]">{title}</h2>
          <p className="mt-2 text-[13px] leading-5 text-[var(--ui-text-muted)]">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Panel({
  title,
  children,
  actions,
  className = ""
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={`rounded-[8px] border border-[var(--ui-border)] bg-[var(--ui-surface)] p-4 shadow-[0_1px_2px_var(--ui-shadow-soft)] ${className}`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--ui-text-muted)]">{title}</div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function TextArea(props: JSX.IntrinsicElements["textarea"]): JSX.Element {
  return (
    <textarea
      {...props}
      className={[
        "min-h-72 w-full rounded-[8px] border border-[var(--ui-border)] bg-[var(--ui-surface)] px-4 py-3.5 font-mono text-[13px] leading-6 text-[var(--ui-text)] outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-[var(--ui-text-faint)] focus:border-[var(--ui-border-strong)] focus:shadow-[0_0_0_3px_var(--ui-focus-ring)]",
        props.className ?? ""
      ].join(" ")}
    />
  );
}

export function TextInput(props: JSX.IntrinsicElements["input"]): JSX.Element {
  return (
    <input
      {...props}
      className={[
        "h-9 w-full rounded-[7px] border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 text-[13px] text-[var(--ui-text)] outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-[var(--ui-text-faint)] focus:border-[var(--ui-border-strong)] focus:shadow-[0_0_0_3px_var(--ui-focus-ring)]",
        props.className ?? ""
      ].join(" ")}
    />
  );
}

export function SearchField({
  icon,
  className = "",
  inputClassName = "",
  ...props
}: JSX.IntrinsicElements["input"] & { icon?: ReactNode; inputClassName?: string }): JSX.Element {
  return (
    <div
      className={[
        "inline-flex h-[34px] items-center gap-2 rounded-[7px] border border-[var(--ui-border)] bg-[var(--ui-surface)] px-2.5 text-[var(--ui-text-muted)] transition-[border-color,box-shadow,background-color] duration-150 focus-within:border-[var(--ui-border-strong)] focus-within:shadow-[0_0_0_3px_var(--ui-focus-ring)]",
        className
      ].join(" ")}
    >
      {icon}
      <input
        {...props}
        className={[
          "min-w-0 border-0 bg-transparent text-[13px] text-[var(--ui-text)] outline-none placeholder:text-[var(--ui-text-faint)]",
          inputClassName
        ].join(" ")}
      />
    </div>
  );
}

export function SelectField(props: JSX.IntrinsicElements["select"]): JSX.Element {
  return (
    <select
      {...props}
      className={[
        "h-9 w-full rounded-[7px] border border-[var(--ui-border)] bg-[var(--ui-surface)] px-3 text-[13px] text-[var(--ui-text)] outline-none transition-[border-color,box-shadow,background-color] duration-150 focus:border-[var(--ui-border-strong)] focus:shadow-[0_0_0_3px_var(--ui-focus-ring)]",
        props.className ?? ""
      ].join(" ")}
    />
  );
}

export function CodeBlock({ children, className = "" }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <pre
      className={`whitespace-pre-wrap rounded-[8px] border border-[var(--ui-border)] bg-[var(--ui-surface-soft)] px-4 py-3.5 font-mono text-[13px] leading-6 text-[var(--ui-text)] ${className}`}
    >
      {children}
    </pre>
  );
}

export function PillTag({
  children,
  icon,
  tone = "neutral",
  className = ""
}: {
  children: ReactNode;
  icon?: ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  className?: string;
}): JSX.Element {
  const toneClass = {
    neutral: "border-[var(--ui-border)] bg-[var(--ui-surface-soft)] text-[var(--ui-text-muted)]",
    accent: "border-[var(--ui-primary-soft-strong)] bg-[var(--ui-primary-soft)] text-[var(--ui-primary)]",
    success: "border-[rgba(32,180,134,0.22)] bg-[rgba(32,180,134,0.1)] text-[#157b61]",
    warning: "border-[rgba(230,160,46,0.22)] bg-[rgba(230,160,46,0.12)] text-[#94610f]",
    danger: "border-[rgba(194,65,45,0.22)] bg-[rgba(194,65,45,0.1)] text-[#a73424]"
  }[tone];

  return (
    <span className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium tracking-normal ${toneClass} ${className}`}>
      {icon}
      <span>{children}</span>
    </span>
  );
}

export function ActionButton({
  variant = "neutral",
  size = "sm",
  className = "",
  ...props
}: JSX.IntrinsicElements["button"] & { variant?: ActionButtonVariant; size?: ActionButtonSize }): JSX.Element {
  const variantClass = {
    neutral:
      "border-[var(--ui-border)] bg-[var(--ui-control-bg)] text-[var(--ui-text)] [@media(hover:hover)]:hover:border-[var(--ui-border-strong)] [@media(hover:hover)]:hover:bg-[var(--ui-control-bg-hover)]",
    primary:
      "border-[var(--ui-primary-soft-strong)] bg-[var(--ui-primary-soft)] text-[var(--ui-primary)] [@media(hover:hover)]:hover:bg-[var(--ui-primary-soft-hover)]",
    danger:
      "border-[var(--ui-border)] bg-[var(--ui-control-bg-quiet)] text-[var(--ui-danger)] [@media(hover:hover)]:hover:border-[var(--ui-danger-soft-strong)] [@media(hover:hover)]:hover:bg-[var(--ui-danger-soft)]",
    dangerStrong:
      "border-[var(--ui-danger-soft-strong)] bg-[var(--ui-danger-soft)] text-[var(--ui-danger)] [@media(hover:hover)]:hover:bg-[var(--ui-control-bg-danger-hover)]"
  }[variant];
  const sizeClass = {
    sm: "min-h-8 px-3 text-[12px]",
    md: "min-h-9 px-3.5 text-[13px]"
  }[size];

  return (
    <button
      {...props}
      className={[
        "inline-flex items-center justify-center gap-1.5 rounded-[7px] border font-semibold transition-[background-color,border-color,color,transform,opacity] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45",
        sizeClass,
        variantClass,
        className
      ].join(" ")}
    />
  );
}

export function IconButton({
  variant = "neutral",
  size = "icon-md",
  className = "",
  ...props
}: JSX.IntrinsicElements["button"] & { variant?: IconButtonVariant; size?: IconButtonSize; "aria-label": string }): JSX.Element {
  const variantClass = {
    neutral:
      "border-transparent bg-transparent text-[var(--ui-text-muted)] [@media(hover:hover)]:hover:border-[var(--ui-border)] [@media(hover:hover)]:hover:bg-[var(--ui-control-bg-hover)] [@media(hover:hover)]:hover:text-[var(--ui-text)]",
    primary:
      "border-transparent bg-transparent text-[var(--ui-primary)] [@media(hover:hover)]:hover:border-[var(--ui-primary-soft-strong)] [@media(hover:hover)]:hover:bg-[var(--ui-primary-soft)]",
    danger:
      "border-transparent bg-transparent text-[var(--ui-danger)] [@media(hover:hover)]:hover:border-[var(--ui-danger-soft-strong)] [@media(hover:hover)]:hover:bg-[var(--ui-danger-soft)]"
  }[variant];
  const sizeClass = {
    "icon-sm": "h-6 w-6 rounded-[6px]",
    "icon-md": "h-[30px] w-[30px] rounded-[7px]"
  }[size];

  return (
    <button
      {...props}
      className={[
        "inline-flex shrink-0 items-center justify-center border p-0 transition-[background-color,border-color,color,transform,opacity] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45",
        sizeClass,
        variantClass,
        className
      ].join(" ")}
    />
  );
}

export function SegmentedControl({
  value,
  options,
  onChange,
  ariaLabel,
  className = ""
}: {
  value: string;
  options: SegmentedOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}): JSX.Element {
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value));

  return (
    <div
      className={[
        "inline-grid relative isolate rounded-[8px] border border-[var(--ui-border)] bg-[var(--ui-surface-soft)] p-0.5",
        className
      ].join(" ")}
      role="tablist"
      aria-label={ariaLabel}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(74px, 1fr))` }}
    >
      <span
        className="absolute bottom-0.5 top-0.5 z-0 rounded-[6px] bg-[var(--ui-surface)] shadow-[0_1px_2px_var(--ui-shadow-medium)] transition-transform duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
        aria-hidden="true"
        style={{ left: "2px", width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${activeIndex * 100}%)` }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          disabled={option.disabled}
          className={[
            "relative z-10 inline-flex h-[30px] min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[6px] border-0 bg-transparent px-2.5 text-[13px] font-medium leading-none tracking-normal text-[var(--ui-text-muted)] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45",
            value === option.value ? "text-[var(--ui-text)]" : "[@media(hover:hover)]:hover:text-[var(--ui-text)]"
          ].join(" ")}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span className="segmented-control-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export function StatusStrip({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="rounded-[8px] border border-[var(--ui-primary-soft-strong)] bg-[var(--ui-primary-soft)] px-3.5 py-2.5 text-[12px] leading-5 text-[var(--ui-text)]">
      {children}
    </div>
  );
}
