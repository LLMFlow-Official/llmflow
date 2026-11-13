"use client"

/** Last-resort screen when even the root layout fails. */
export default function GlobalError({ error }: { error: Error }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 12 }}>
        <p style={{ fontWeight: 600 }}>LLM Flow could not start.</p>
        <p style={{ fontSize: 12, color: "#666", maxWidth: 480, textAlign: "center" }}>{error.message}</p>
        <button onClick={() => location.reload()}>Reload</button>
      </body>
    </html>
  )
}
