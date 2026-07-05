import type { ReactNode } from "react";
import Link from "next/link";
import { Terminal, ArrowRight } from "lucide-react";
import { Panel, CopyButton, Chip } from "@/components/ui";
import { toolCount } from "@/lib/tools/registry";

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="tnum mt-px grid h-5 w-5 shrink-0 place-items-center rounded-sm border border-hair bg-sunk text-[11px] font-semibold text-text2">
        {n}
      </span>
      <span className="min-w-0 text-[12.5px] leading-relaxed text-text2">{children}</span>
    </li>
  );
}

const link = "font-semibold text-text underline decoration-hair underline-offset-2 hover:text-accent-fg hover:decoration-accent";

/** Quick start: the adapter loop — connect, test, fetch, correlate, call the gateway. */
export function GettingStarted({ baseUrl }: { baseUrl: string }) {
  const example = `curl -s "${baseUrl}/api/gateway/<connection-id>/devices/entities/devices/v2"`;
  return (
    <Panel title="Adapter quick start" icon={<Terminal size={14} />}
      actions={<Link href="/adapters" className="btn-ghost">Open adapters <ArrowRight size={13} /></Link>}>
      <ol className="space-y-2.5">
        <Step n={1}><Link href="/adapters" className={link}>Open Adapters</Link> and add a connection — pick an adapter and fill in its connection form.</Step>
        <Step n={2}>Test it — a real heartbeat probes the tool and the status lands on <span className="text-ok">connected</span>.</Step>
        <Step n={3}>Fetch now — run a discovery cycle and watch records land in the fetch history.</Step>
        <Step n={4}>See <Link href="/assets" className={link}>Assets</Link> correlate — the same fleet reported by several adapters merges by serial → mac → hostname (devices) or email (users).</Step>
        <Step n={5}>Call the gateway — one URL per connection, credentials injected and sessions reused for you:</Step>
      </ol>
      <div className="mt-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label">Example gateway call</span>
          <CopyButton value={example} label="Copy" className="h-6 !text-[11px]" />
        </div>
        <pre className="emu-scroll mono overflow-x-auto rounded bg-sunk p-3 text-[11.5px] leading-relaxed text-text2">{example}</pre>
      </div>
      <ol className="mt-2.5 space-y-2.5">
        <Step n={6}>Subscribe to <Link href="/events" className={link}>events</Link> — webhook deliveries are HMAC-signed, and generators keep synthetic activity flowing.</Step>
      </ol>
      <p className="mt-3 text-[11.5px] leading-relaxed text-text3">
        Every tool also stays directly reachable at <span className="mono text-text2">{baseUrl}/api/mock/&lt;tool&gt;</span> with an API key.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Chip variant="accent">{toolCount()} adapters</Chip>
        <Chip variant="ok">Correlated assets</Chip>
        <Chip>Session reuse</Chip>
        <Chip>Scheduled discovery</Chip>
        <Chip>Fault injection</Chip>
      </div>
    </Panel>
  );
}
