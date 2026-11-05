import { render } from "solid-js/web";
import { createSignal, onMount } from "solid-js";

function App() {
  const [status, setStatus] = createSignal("Checking device…");

  onMount(async () => {
    const lines: string[] = [];
    lines.push(`Secure context: ${isSecureContext}`);
    lines.push(`WebGPU: ${"gpu" in navigator}`);
    if ("gpu" in navigator) {
      const adapter = await navigator.gpu.requestAdapter();
      lines.push(`GPU adapter: ${adapter ? "yes" : "none"}`);
    }
    lines.push(`WebCodecs VideoEncoder: ${typeof VideoEncoder !== "undefined"}`);
    lines.push(`OPFS: ${!!navigator.storage?.getDirectory}`);
    setStatus(lines.join("\n"));
  });

  return (
    <main style={{ padding: "24px", "font-family": "system-ui, sans-serif" }}>
      <h1>RippleFlow</h1>
      <pre>{status()}</pre>
    </main>
  );
}

render(() => <App />, document.getElementById("root")!);
