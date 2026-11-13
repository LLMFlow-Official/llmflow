import { ImageResponse } from "next/og";

// Rendered once at build time (static export).
export const dynamic = "force-static";
export const alt = "LLM Flow: build and test AI workflows without code";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#ef4444", color: "white", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="16" y="16" width="6" height="6" rx="1" />
            <rect x="2" y="16" width="6" height="6" rx="1" />
            <rect x="9" y="2" width="6" height="6" rx="1" />
            <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
            <path d="M12 12V8" />
          </svg>
          <div style={{ fontSize: 110, fontWeight: 800 }}>LLM Flow</div>
        </div>
        <div style={{ fontSize: 40, marginTop: 36, maxWidth: 1000, lineHeight: 1.3 }}>
          Build, test and compare AI workflows with OpenAI, Claude and Gemini. No code needed.
        </div>
      </div>
    ),
    size
  );
}
