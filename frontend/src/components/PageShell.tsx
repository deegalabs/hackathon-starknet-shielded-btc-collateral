import { type ReactNode } from "react";

interface PageShellProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}

/**
 * Consistent page wrapper for all routes.
 * max-w-4xl, centred, uniform heading / subtitle style.
 */
export function PageShell({ title, subtitle, action, children }: PageShellProps) {
  return (
    <div className="max-w-4xl mx-auto w-full space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted mt-1 leading-relaxed">{subtitle}</p>
          )}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}
