// ============================================================================
// Normalizer registry (W3, PLAN §4.4). One normalizer per tool that fetches
// inventory; everything else falls back to the generic contract (PLAN §6 W6)
// so scaffold adapters normalize without touching this workstream.
// ============================================================================

import type { Normalizer } from "../types";
import crowdstrike from "./crowdstrike";
import qualys from "./qualys";
import meraki from "./meraki";
import entra from "./entra";
import trellix from "./trellix";
import zscalerZia from "./zscaler-zia";
import generic from "./generic";

const REGISTRY: Record<string, Normalizer> = {
  crowdstrike,
  qualys,
  "cisco-meraki": meraki,
  "entra-id": entra,
  "trellix-epo": trellix,
  "zscaler-zia": zscalerZia,
};

/** The tool's normalizer, or the generic-contract fallback. */
export function normalizerFor(toolId: string): Normalizer {
  return REGISTRY[toolId] ?? generic;
}
