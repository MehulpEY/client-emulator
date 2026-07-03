"use client";

import { useMemo, useState } from "react";
import { Play, Cpu, Sparkles } from "lucide-react";
import type { EndpointView } from "@/lib/tools/registry";
import type { AuthType } from "@/lib/tools/types";
import { MethodBadge, StatusBadge, Chip, Spinner, CopyButton, JsonViewerButton } from "@/components/ui";
import { EndpointDocsButton } from "./EndpointDocs";
import { prettyJson } from "@/lib/format";
import { cn } from "@/lib/cn";

interface Props {
  toolId: string;
  basePath: string;
  auth: { type: AuthType; param?: string };
  endpoints: EndpointView[];
}

function pathParams(path: string): string[] {
  return Array.from(path.matchAll(/\{(\w+)\}/g)).map((m) => m[1]);
}

function buildQueryString(req: any): string {
  if (!req || typeof req !== "object" || Array.isArray(req)) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(req)) {
    if (v !== null && typeof v === "object") continue;
    sp.set(k, String(v));
  }
  return sp.toString();
}

export function EndpointConsole({ toolId, basePath, auth, endpoints }: Props) {
  const [sel, setSel] = useState(0);
  const ep = endpoints[sel];

  return (
    <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
      {/* Endpoint list */}
      <div className="panel overflow-hidden">
        <div className="panel-head"><span className="eyebrow">Endpoints</span><span className="chip">{endpoints.length}</span></div>
        <div className="emu-scroll max-h-[520px] overflow-y-auto">
          {endpoints.map((e, i) => (
            <button
              key={e.method + e.path}
              onClick={() => setSel(i)}
              className={cn("row flex w-full items-center gap-2 border-b border-hair px-3 py-2.5 text-left last:border-0", i === sel && "bg-surface-hover")}
              data-active={i === sel}
            >
              <MethodBadge method={e.method} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-bold">{e.operation}</span>
                <span className="mono block truncate text-[10.5px] text-text3">{e.path}</span>
              </span>
              {e.aiTool ? <Cpu size={12} className="shrink-0 text-accent-fg" /> : null}
            </button>
          ))}
        </div>
      </div>

      {/* Try-it console */}
      {ep ? <TryForm key={ep.method + ep.path} toolId={toolId} basePath={basePath} auth={auth} ep={ep} /> : null}
    </div>
  );
}

function TryForm({ toolId, basePath, auth, ep }: { toolId: string; basePath: string; auth: Props["auth"]; ep: EndpointView }) {
  const params = useMemo(() => pathParams(ep.path), [ep.path]);
  const [paramVals, setParamVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.map((p) => [p, String(ep.request?.[p] ?? "")]))
  );
  const isGet = ep.method === "GET";
  const [query, setQuery] = useState<string>(() => (isGet ? buildQueryString(ep.request) : ""));
  const [body, setBody] = useState<string>(() => (!isGet && ep.request ? prettyJson(ep.request) : ""));
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ status: number; ms: number; body: any } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function resolvedPath(): string {
    let p = ep.path;
    for (const [k, v] of Object.entries(paramVals)) p = p.replace(`{${k}}`, encodeURIComponent(v || `{${k}}`));
    return basePath + p;
  }

  async function send() {
    setBusy(true); setErr(null); setRes(null);
    const headers: Record<string, string> = {};
    let url = resolvedPath();
    const qs = new URLSearchParams(query);
    if (apiKey) {
      if (auth.type === "api_key_query") qs.set(auth.param || "api_key", apiKey);
      else if (auth.type === "bearer") headers["Authorization"] = `Bearer ${apiKey}`;
      else if (auth.type === "basic") headers["Authorization"] = `Basic ${btoa("emulator:" + apiKey)}`;
      else if (auth.type === "api_key_header") headers[auth.param || "x-api-key"] = apiKey;
    }
    const qstr = qs.toString();
    if (qstr) url += "?" + qstr;

    const init: RequestInit = { method: ep.method, headers };
    if (!isGet && body.trim()) {
      headers["content-type"] = "application/json";
      init.body = body;
    }
    const t0 = performance.now();
    try {
      const r = await fetch(url, init);
      const ms = Math.round(performance.now() - t0);
      const json = await r.json().catch(() => ({}));
      setRes({ status: r.status, ms, body: json });
    } catch (e: any) {
      setErr(e?.message || "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel flex flex-col overflow-hidden">
      <div className="panel-head">
        <div className="flex min-w-0 items-center gap-2">
          <MethodBadge method={ep.method} />
          <span className="mono truncate text-[12px] text-text2">{resolvedPath()}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {ep.aiTool ? <Chip variant="accent" icon={<Cpu size={11} />}>AI tool</Chip> : null}
          {ep.hasHandler ? <Chip variant="ok" icon={<Sparkles size={11} />}>dynamic</Chip> : null}
          <EndpointDocsButton ep={ep} auth={auth} />
        </div>
      </div>

      <div className="emu-scroll max-h-[560px] space-y-3 overflow-y-auto p-4">
        <p className="text-[12.5px] text-text2">{ep.summary}</p>

        {params.length > 0 && (
          <div>
            <div className="label mb-1.5">Path parameters</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {params.map((p) => (
                <label key={p} className="block">
                  <span className="mono mb-1 block text-[11px] text-text3">{p}</span>
                  <input className="field" value={paramVals[p] ?? ""} onChange={(e) => setParamVals((s) => ({ ...s, [p]: e.target.value }))} placeholder={p} />
                </label>
              ))}
            </div>
          </div>
        )}

        {isGet ? (
          <label className="block">
            <span className="label mb-1.5 block">Query string</span>
            <input className="field mono" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="key=value&key2=value2" />
          </label>
        ) : (
          <label className="block">
            <span className="mb-1.5 flex items-center justify-between">
              <span className="label">Request body (JSON)</span>
              {body.trim() ? <JsonViewerButton value={body} title="Request body" label="Format / validate" /> : null}
            </span>
            <textarea className="field mono min-h-[110px] text-[12px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder="{}" />
          </label>
        )}

        {auth.type !== "none" && (
          <label className="block">
            <span className="label mb-1.5 block">
              API key <span className="text-text3">{"->"} sent as {auth.type === "bearer" ? "Authorization: Bearer" : auth.type === "basic" ? "Basic auth" : auth.type === "api_key_query" ? `?${auth.param}` : auth.param}</span>
            </span>
            <input className="field mono" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="optional - open in dev mode until keys are seeded" />
          </label>
        )}

        <div className="flex items-center gap-2">
          <button className="btn-primary" onClick={send} disabled={busy}>
            {busy ? <Spinner label="Sending..." /> : <><Play size={14} /> Send request</>}
          </button>
          <CopyButton value={resolvedPath()} label="Copy URL" className="h-8 !text-[11px]" />
        </div>

        {err && <div className="border border-danger-line bg-danger-bg px-3 py-2 text-[12px] text-danger">{err}</div>}

        {res && (
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="label">Response</span>
              <StatusBadge status={res.status} />
              <span className="text-[11px] text-text3">{res.ms}ms</span>
              <JsonViewerButton value={res.body} title="Response body" className="ml-auto" />
              <CopyButton value={prettyJson(res.body)} label="Copy" className="h-6 !text-[11px]" />
            </div>
            <pre className="emu-scroll mono max-h-72 overflow-auto bg-surface-sunk p-3 text-[11.5px] leading-relaxed text-text2">{prettyJson(res.body)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
