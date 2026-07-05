import { randomBytes } from "crypto";

const hex = (n: number) => randomBytes(n).toString("hex");

export const conId = (): string => `con_${hex(8)}`;
export const runId = (): string => `run_${hex(8)}`;
export const astId = (): string => `ast_${hex(8)}`;
export const sesId = (): string => `ses_${hex(8)}`;
export const scnId = (): string => `scn_${hex(8)}`;

/** The provisioned outbound credential for a connection (see PLAN §4.2). */
export const connectionSecret = (): string => `emu_conn_${hex(18)}`;
/** Mock session bearer artifact (display/accounting only, never the credential). */
export const sessionToken = (): string => `tok_${hex(12)}`;
