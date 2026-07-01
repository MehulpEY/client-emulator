import Link from "next/link";
import { Terminal, ArrowRight } from "lucide-react";
import { Panel, CopyButton, Chip } from "@/components/ui";

/** Quick-start: how an agent points at the emulator. */
export function GettingStarted({ baseUrl }: { baseUrl: string }) {
  const example = `curl "${baseUrl}/api/mock/abuseipdb/api/v2/check?ipAddress=118.25.6.39" \\\n  -H "Key: <your-emulator-api-key>"`;
  return (
    <Panel title="Point Your Agents Here" icon={<Terminal size={14} />}
      actions={<Link href="/tools" className="btn-ghost">Browse tools <ArrowRight size={13} /></Link>}>
      <p className="text-[12.5px] text-text2">
        Each tool is reachable at <span className="mono text-text">{baseUrl}/api/mock/&lt;tool&gt;</span>.
        Swap a client integration&apos;s base URL for the emulator and every call returns a realistic mock —
        logged here for inspection.
      </p>
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label">Example request</span>
          <CopyButton value={example.replace(/\\\n  /g, " ")} label="Copy" className="h-6 !text-[11px]" />
        </div>
        <pre className="emu-scroll mono overflow-x-auto bg-surface-sunk p-3 text-[11.5px] leading-relaxed text-text2">{example}</pre>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Chip variant="accent">52 tools</Chip>
        <Chip variant="ok">8 high-fidelity</Chip>
        <Chip>API-key gated</Chip>
        <Chip>Request logging</Chip>
        <Chip>Latency &amp; fault injection</Chip>
      </div>
    </Panel>
  );
}
