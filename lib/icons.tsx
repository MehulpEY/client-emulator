import {
  ShieldHalf, Radar, Laptop, ScrollText, Network, KeyRound, FileLock2, ShieldAlert,
  Gauge, Workflow, GraduationCap, BadgeCheck, Microscope, MousePointerClick, Lock,
  Smartphone, Contact, Boxes, CloudCog, type LucideIcon, HelpCircle,
} from "lucide-react";
import type { CategoryId } from "./tools/types";
import { CATEGORY_MAP } from "./tools/categories";

const ICONS: Record<string, LucideIcon> = {
  ShieldHalf, Radar, Laptop, ScrollText, Network, KeyRound, FileLock2, ShieldAlert,
  Gauge, Workflow, GraduationCap, BadgeCheck, Microscope, MousePointerClick, Lock,
  Smartphone, Contact, Boxes, CloudCog,
};

export function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? HelpCircle;
}

export function CategoryIcon({ id, size = 16, className }: { id: CategoryId; size?: number; className?: string }) {
  const Icon = iconFor(CATEGORY_MAP[id]?.icon ?? "Boxes");
  return <Icon size={size} className={className} />;
}
