import { Network } from "lucide-react";
import { Card } from "../ui/card";

export const versionData = {
  version: "2.0.0",
  introVersion: "2",
}

export default function Logo() {
  return (
    <Card className="bg-brand text-brand-foreground px-3 py-2.5 select-none border-0 shadow-lg pointer-events-auto shrink-0">
      <div className="flex relative items-center">
        <Network size={28} aria-hidden />
        <h1 className="ml-2 scroll-m-20 text-2xl font-extrabold tracking-tight leading-9 hidden @4xl:block">
          LLM Flow
        </h1>
        <span className="text-[12px] font-extrabold absolute top-0 right-0 -mt-1.5 tracking-tighter hidden @4xl:block">
          v{versionData.version}
        </span>
        <a href="https://github.com/TheJenos" target="_blank" rel="noopener noreferrer" className="text-[12px] font-extrabold absolute bottom-0 right-0 translate-y-1 tracking-tighter hidden @4xl:block hover:underline">
          from Jenos
        </a>
      </div>
    </Card>
  );
}