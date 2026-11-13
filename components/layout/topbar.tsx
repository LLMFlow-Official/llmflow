import Controllers from "./controllers";
import FlowMenu from "./flow_menu";
import Logo from "./logo";
import Settings from "./settings";

/** Top bar: logo and flows on the left, editing tools in the middle, settings on the right. */
export default function Topbar() {
    return (
        <div className="absolute top-2 left-2 right-2 z-50 flex flex-wrap items-start gap-2 pointer-events-none">
            <Logo />
            <FlowMenu />
            <div className="flex-1 flex justify-center min-w-0 order-last sm:order-0 basis-full sm:basis-auto">
                <Controllers />
            </div>
            <Settings />
        </div>
    );
}
