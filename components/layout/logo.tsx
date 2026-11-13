import { Network } from "lucide-react";
import { Card } from "../ui/card";

export const versionData = {
  version: "2.0.0",
  introVersion: "2",
}

export default function Logo() {
  return (
    <Card className="bg-red-500 text-white p-3 select-none border-0 shadow-lg pointer-events-auto shrink-0">
      <div className="flex relative items-center">
        <Network size={32} aria-hidden />
        <h1 className="ml-2 scroll-m-20 text-2xl font-extrabold tracking-tight lg:text-3xl leading-9 hidden md:block">
          LLM Flow
        </h1>
        <span className="text-[12px] font-extrabold text-gray-200 absolute top-0 right-0 -mt-1 tracking-tighter hidden md:block">
          v{versionData.version}
        </span>
        <a href="https://github.com/TheJenos" className="text-[12px] font-extrabold text-gray-200 absolute bottom-0 right-0 translate-y-1/2 tracking-tighter mt-1 hidden md:block">
          from Jenos
        </a>
      </div>
    </Card>
  );
}