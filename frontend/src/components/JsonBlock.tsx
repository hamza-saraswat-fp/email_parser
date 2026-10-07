export function JsonBlock({ value, maxHeight = "24rem" }: { value: unknown; maxHeight?: string }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre
      className="overflow-auto rounded bg-slate-900 p-3 text-xs leading-relaxed text-slate-100"
      style={{ maxHeight }}
    >
      {text}
    </pre>
  );
}
