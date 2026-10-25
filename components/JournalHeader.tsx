import type { CSSProperties, ReactNode } from "react";
import tokens from "@/miniprogram/styles/web-baseline.json";

/** Same title/meta hierarchy as native; only native reserves the capsule's own area. */
export default function JournalHeader({ title, onBack, description, actions, className = "" }: {
  title: string; eyebrow: string; onBack?: () => void; description?: ReactNode; actions?: ReactNode; className?: string;
}) {
  return <header className={`journal-heading ${onBack ? "has-back" : ""} ${className}`} style={{ "--heading-size": `${tokens.headingSize}px` } as CSSProperties}>
    <div className="heading-row">{onBack && <button type="button" className="heading-back" onClick={onBack} aria-label="返回上一页">‹</button>}<div className="heading-copy"><h1 className="heading-title">{title}</h1></div></div>
    {(description || actions) && <div className="heading-meta"><div className="heading-description">{description}</div><div className="heading-actions">{actions}</div></div>}
  </header>;
}
