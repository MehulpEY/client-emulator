import Link from "next/link";
import { Boxes } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <span className="grid h-12 w-12 place-items-center bg-accent"><Boxes size={24} className="text-accent-ink" /></span>
      <div className="text-[28px] font-bold">404</div>
      <p className="max-w-sm text-[13px] text-text2">That tool or page isn&apos;t part of the emulator.</p>
      <Link href="/tools" className="btn-primary mt-1">Browse the catalog</Link>
    </div>
  );
}
