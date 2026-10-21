import type { ReactNode } from "react";

/**
 * A console panel: a titled card with an optional action on the right of
 * its header (the `.panel` / `.panel-header` look in globals.css).
 */
export function Panel({
  title,
  icon,
  action,
  className = "",
  children,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article className={className ? `panel ${className}` : "panel"}>
      <div className="panel-header">
        <div>
          {icon}
          <h2>{title}</h2>
        </div>
        {action && <div className="panel-action">{action}</div>}
      </div>
      {children}
    </article>
  );
}
