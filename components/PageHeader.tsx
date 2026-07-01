import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-2 text-[22px] font-bold tracking-[-0.01em] sm:text-[26px]">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-[13px] text-text2">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
