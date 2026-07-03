"use client";

import { useMemo, useState, type ReactNode } from "react";
import { BookText, KeyRound, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import type { EndpointView } from "@/lib/tools/registry";
import type { AuthType, EndpointParam } from "@/lib/tools/types";
import { Modal, MethodBadge, Chip, CopyButton, JsonViewerButton } from "@/components/ui";
import { prettyJson } from "@/lib/format";

type AuthInfo = { type: AuthType; param?: string };

/** Normalized row the table renders, from either authored params or derivation. */
interface Field {
  name: string;
  location: "path" | "query" | "header" | "body";
  type: string;
  /** Enum values joined, or a format hint - what the caller may actually send. */
  values: string;
  example: string;
  required: boolean;
  description?: string;
  default?: string;
}

function pathParams(path: string): string[] {
  return Array.from(path.matchAll(/\{(\w+)\}/g)).map((m) => m[1]);
}

function jsType(v: any): string {
  if (Array.isArray(v)) return "array";
  if (v === null) return "null";
  const t = typeof v;
  if (t === "number") return Number.isInteger(v) ? "integer" : "number";
  return t; // string | boolean | object
}

/** Best-effort human "format" for an example value - this is what tells a caller
 *  what to actually send (a sha256, an ISO date, an uppercase enum token, ...). */
function inferFormat(v: any): string {
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  if (typeof v === "boolean") return "boolean (true / false)";
  if (Array.isArray(v)) return `array of ${v.length ? jsType(v[0]) : "any"}`;
  if (v && typeof v === "object") return "object";
  if (typeof v !== "string") return typeof v;
  const s = v;
  if (/^[a-f0-9]{64}$/i.test(s)) return "sha256 hash (64 hex)";
  if (/^[a-f0-9]{40}$/i.test(s)) return "sha1 hash (40 hex)";
  if (/^[a-f0-9]{32}$/i.test(s)) return "md5 hash (32 hex)";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return "uuid";
  if (/^eyJ[\w-]+\.[\w-]+/.test(s)) return "JWT (bearer token)";
  if (/^https?:\/\//i.test(s)) return "url";
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return "email";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return "IPv4 address";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return "date-time (ISO 8601)";
  if (/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(s)) return "date-time (dd/MM/yyyy HH:mm:ss)";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "date (YYYY-MM-DD)";
  if (/^CVE-\d{4}-\d+$/i.test(s)) return "CVE id";
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(s)) return "enum token (uppercase)";
  if (/^\d+$/.test(s)) return "numeric string";
  return "string";
}

function compact(v: any): string {
  if (v === undefined) return "";
  if (typeof v === "string") return v.length > 60 ? v.slice(0, 57) + "..." : v;
  try {
    const s = JSON.stringify(v);
    return s.length > 60 ? s.slice(0, 57) + "..." : s;
  } catch {
    return String(v);
  }
}

// ---- authored params -> fields --------------------------------------------
function fieldsFromParams(params: EndpointParam[]): Field[] {
  return params.map((p) => ({
    name: p.name,
    location: p.in,
    type: p.type || (p.enum ? "enum" : "string"),
    values: p.enum && p.enum.length ? p.enum.join("  |  ") : (p.format || "-"),
    example: p.example != null ? String(p.example) : "",
    required: !!p.required,
    description: p.description,
    default: p.default != null ? String(p.default) : undefined,
  }));
}

// ---- fallback: derive fields from the example request ----------------------
function flattenBody(obj: any, prefix: string, out: Field[]): void {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    const first = obj[0];
    out.push({ name: `${prefix}[]`, location: "body", type: "array", values: inferFormat(obj), example: compact(obj), required: false });
    if (first && typeof first === "object" && !Array.isArray(first)) flattenBody(first, `${prefix}[].`, out);
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    const name = `${prefix}${k}`;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push({ name, location: "body", type: "object", values: "object", example: compact(v), required: false });
      flattenBody(v, `${name}.`, out);
    } else if (Array.isArray(v)) {
      const first = v[0];
      out.push({ name: `${name}[]`, location: "body", type: "array", values: inferFormat(v), example: compact(v), required: false });
      if (first && typeof first === "object" && !Array.isArray(first)) flattenBody(first, `${name}[].`, out);
    } else {
      out.push({ name, location: "body", type: jsType(v), values: inferFormat(v), example: compact(v), required: false });
    }
  }
}

function fieldsFromDerivation(ep: EndpointView): Field[] {
  const fields: Field[] = [];
  const params = pathParams(ep.path);
  const req = ep.request;

  for (const p of params) {
    const ex = req && typeof req === "object" && !Array.isArray(req) ? req[p] : undefined;
    fields.push({ name: p, location: "path", type: ex === undefined ? "string" : jsType(ex), values: ex === undefined ? "string" : inferFormat(ex), example: ex === undefined ? "" : compact(ex), required: true });
  }

  if (req && typeof req === "object") {
    if (ep.method === "GET") {
      if (!Array.isArray(req)) {
        for (const [k, v] of Object.entries(req)) {
          if (params.includes(k)) continue;
          fields.push({ name: k, location: "query", type: jsType(v), values: inferFormat(v), example: compact(v), required: false });
        }
      }
    } else {
      const bodyRows: Field[] = [];
      flattenBody(req, "", bodyRows);
      for (const r of bodyRows) if (!params.includes(r.name)) fields.push(r);
    }
  }
  return fields;
}

function authLine(auth: AuthInfo): string {
  switch (auth.type) {
    case "api_key_header": return `Send your key in the \`${auth.param || "x-api-key"}\` request header.`;
    case "api_key_query": return `Append \`?${auth.param || "api_key"}=<key>\` to the request URL.`;
    case "bearer": return "Send `Authorization: Bearer <key>`.";
    case "basic": return "HTTP Basic auth - username `emulator`, password `<key>`.";
    case "none": return "No authentication required.";
    default: return "No authentication required.";
  }
}

const LOC_LABEL: Record<Field["location"], string> = { path: "path", query: "query", header: "header", body: "body" };

function FieldTable({ fields }: { fields: Field[] }) {
  const hasDesc = fields.some((f) => f.description);
  return (
    <div className="emu-scroll overflow-x-auto border border-hair">
      <table className="w-full min-w-[560px] border-collapse text-left text-[11.5px]">
        <thead>
          <tr className="border-b border-hair bg-surface-sunk text-[10px] uppercase tracking-wide text-text3">
            <th className="px-2.5 py-1.5 font-semibold">Name</th>
            <th className="px-2.5 py-1.5 font-semibold">In</th>
            <th className="px-2.5 py-1.5 font-semibold">Type</th>
            <th className="px-2.5 py-1.5 font-semibold">Accepted values / format</th>
            {hasDesc ? <th className="px-2.5 py-1.5 font-semibold">Description</th> : <th className="px-2.5 py-1.5 font-semibold">Example</th>}
          </tr>
        </thead>
        <tbody>
          {fields.map((f, i) => (
            <tr key={f.location + f.name + i} className="border-b border-hair/60 align-top last:border-0">
              <td className="px-2.5 py-1.5 whitespace-nowrap">
                <span className="mono font-bold text-text">{f.name}</span>
                {f.required ? <span className="ml-1.5 border border-danger-line bg-danger-bg px-1 py-px text-[9px] font-bold uppercase text-danger">req</span> : null}
              </td>
              <td className="px-2.5 py-1.5"><span className="mono text-text3">{LOC_LABEL[f.location]}</span></td>
              <td className="px-2.5 py-1.5 text-text3">{f.type}</td>
              <td className="px-2.5 py-1.5">
                <span className="mono text-text2">{f.values}</span>
                {f.default !== undefined ? <span className="ml-1.5 text-[10px] text-text3">default: {f.default}</span> : null}
              </td>
              {hasDesc ? (
                <td className="px-2.5 py-1.5 text-text2">
                  {f.description || ""}
                  {f.example ? <span className="mono ml-1 block text-[10.5px] text-text3">e.g. {f.example}</span> : null}
                </td>
              ) : (
                <td className="px-2.5 py-1.5"><span className="mono break-all text-text3">{f.example || "-"}</span></td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ icon, title, children }: { icon?: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        {icon ? <span className="text-accent-fg">{icon}</span> : null}
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-text2">{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function EndpointDocsButton({ ep, auth }: { ep: EndpointView; auth: AuthInfo }) {
  const [open, setOpen] = useState(false);
  const authored = !!(ep.params && ep.params.length);
  const fields = useMemo(
    () => (ep.params && ep.params.length ? fieldsFromParams(ep.params) : fieldsFromDerivation(ep)),
    [ep],
  );
  const pathF = fields.filter((f) => f.location === "path");
  const queryF = fields.filter((f) => f.location === "query");
  const headerF = fields.filter((f) => f.location === "header");
  const bodyF = fields.filter((f) => f.location === "body");
  const isGet = ep.method === "GET";

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-ghost h-7 !text-[11px]" title="API reference for this endpoint">
        <BookText size={12} /> Docs
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="xl"
        icon={<BookText size={14} />}
        title={
          <div className="flex min-w-0 items-center gap-2">
            <MethodBadge method={ep.method} />
            <span className="mono truncate text-[12px] text-text2">{ep.fullPath}</span>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip variant="muted">operation: {ep.operation}</Chip>
            {ep.aiTool ? <Chip variant="accent">AI tool</Chip> : null}
            {ep.hasHandler ? <Chip variant="ok">dynamic response</Chip> : null}
          </div>

          {ep.summary ? <p className="text-[12.5px] leading-relaxed text-text2">{ep.summary}</p> : null}

          <Section icon={<KeyRound size={13} />} title="Authentication">
            <p className="text-[12px] text-text2">{authLine(auth)}</p>
            {auth.type !== "none" ? (
              <p className="text-[11px] text-text3">If no keys are seeded for this tool, endpoints stay open (any / no key works) so you can test immediately.</p>
            ) : null}
          </Section>

          {pathF.length > 0 && (
            <Section title="Path parameters">
              <FieldTable fields={pathF} />
            </Section>
          )}

          {queryF.length > 0 && (
            <Section title="Query parameters">
              <FieldTable fields={queryF} />
            </Section>
          )}

          {headerF.length > 0 && (
            <Section icon={<KeyRound size={13} />} title="Request headers">
              <FieldTable fields={headerF} />
            </Section>
          )}

          {bodyF.length > 0 && (
            <Section icon={<ArrowUpFromLine size={13} />} title="Request body (JSON)">
              <FieldTable fields={bodyF} />
              {ep.request && !isGet ? (
                <div className="mt-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="label">Example body</span>
                    <div className="flex items-center gap-1.5">
                      <JsonViewerButton value={ep.request} title="Example request body" />
                      <CopyButton value={prettyJson(ep.request)} label="Copy" className="h-6 !text-[11px]" />
                    </div>
                  </div>
                  <pre className="emu-scroll mono max-h-56 overflow-auto bg-surface-sunk p-3 text-[11px] leading-relaxed text-text2">{prettyJson(ep.request)}</pre>
                </div>
              ) : null}
            </Section>
          )}

          {fields.length === 0 && (
            <p className="text-[12px] text-text3">This endpoint takes no parameters - call it directly.</p>
          )}

          <Section icon={<ArrowDownToLine size={13} />} title="Response">
            {ep.responseExample ? (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="label">Example response</span>
                  <JsonViewerButton value={ep.responseExample} title="Example response" />
                </div>
                <pre className="emu-scroll mono max-h-72 overflow-auto bg-surface-sunk p-3 text-[11px] leading-relaxed text-text2">{prettyJson(ep.responseExample)}</pre>
              </div>
            ) : (
              <p className="text-[12px] text-text3">
                {ep.hasHandler
                  ? "Responses are generated dynamically from your input (deterministic - the same input yields the same result). Use Send request in the console to see a live response."
                  : "No static example. Use Send request in the console to see a live response."}
              </p>
            )}
          </Section>

          <p className="border-t border-hair pt-3 text-[10.5px] leading-relaxed text-text3">
            {authored
              ? "Accepted values reflect what this emulated endpoint recognizes. Required is marked; unmarked fields are optional filters that fall back to a default."
              : "Parameters are derived from a representative example, so types and formats reflect real accepted values. Required is marked for path parameters; body / query fields are typically optional. The live handler may accept more."}
          </p>
        </div>
      </Modal>
    </>
  );
}

export default EndpointDocsButton;
