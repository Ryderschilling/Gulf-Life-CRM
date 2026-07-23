interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export default function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    <div className="flex items-center justify-between mb-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "#1f2941" }}>
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm mt-0.5" style={{ color: "#9aa1b0" }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
