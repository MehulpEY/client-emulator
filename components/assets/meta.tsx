// Shared presentation metadata for the asset inventory UI (PLAN §6 W8).
// One place maps each asset class to its label + lucide icon so the tabs,
// table rows and drawer all agree.

import { Boxes, CloudCog, Contact, Laptop, Radar, ShieldAlert, type LucideIcon } from "lucide-react";
import type { AssetType } from "@/lib/adapters/types";

export interface AssetTypeMeta {
  /** Singular, sentence case - drawer chip. */
  label: string;
  /** Tab label. */
  plural: string;
  icon: LucideIcon;
}

export const ASSET_TYPE_ORDER: AssetType[] = ["device", "user", "vulnerability", "software", "saas_app", "alert"];

/** The big-three classes stay in the tab row even at zero count. */
export const ALWAYS_VISIBLE_TYPES: AssetType[] = ["device", "user", "vulnerability"];

export const ASSET_TYPE_META: Record<AssetType, AssetTypeMeta> = {
  device: { label: "Device", plural: "Devices", icon: Laptop },
  user: { label: "User", plural: "Users", icon: Contact },
  vulnerability: { label: "Vulnerability", plural: "Vulnerabilities", icon: ShieldAlert },
  software: { label: "Software", plural: "Software", icon: Boxes },
  saas_app: { label: "SaaS app", plural: "SaaS apps", icon: CloudCog },
  alert: { label: "Alert", plural: "Alerts", icon: Radar },
};

/** True when a scalar reads as an identifier (serial / mac / id / version) - rendered mono. */
export function idLike(v: unknown): boolean {
  if (typeof v === "number") return true;
  return typeof v === "string" && v.length > 0 && v.length <= 72 && !/\s/.test(v);
}
