import type { CSSProperties } from "react";

export function CloudField({ style }: { style?: CSSProperties }) {
  const blobs = [
    { w: "38%", h: "22%", left: "-4%", bottom: "-6%" },
    { w: "28%", h: "18%", left: "22%", bottom: "-4%" },
    { w: "34%", h: "20%", right: "10%", bottom: "-8%" },
    { w: "26%", h: "16%", right: "-6%", bottom: "-2%" },
  ];
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", ...style }}>
      {blobs.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: b.w,
            height: b.h,
            left: (b as any).left,
            right: (b as any).right,
            bottom: b.bottom,
            background: "#FFFFFF",
            borderRadius: "50%",
            filter: "blur(0.2px)",
          }}
        />
      ))}
    </div>
  );
}

export function PlumPattern({ style }: { style?: CSSProperties }) {
  const shapes = [
    { size: "38vmin", top: "-8%", left: "-6%", rotate: 18, r: "18%" },
    { size: "30vmin", top: "20%", right: "-10%", rotate: -12, r: "50%" },
    { size: "26vmin", bottom: "12%", left: "10%", rotate: 28, r: "22%" },
    { size: "34vmin", bottom: "-10%", right: "-4%", rotate: -22, r: "50%" },
  ];
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", ...style }}>
      {shapes.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: s.size,
            height: s.size,
            top: (s as any).top,
            left: (s as any).left,
            right: (s as any).right,
            bottom: (s as any).bottom,
            borderRadius: s.r,
            background: "var(--cw-plum-pattern)",
            opacity: 0.1,
            transform: `rotate(${s.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}

export function TintPattern({
  corner = "top-right",
  style,
}: {
  corner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  seed?: number;
  style?: CSSProperties;
}) {
  const pos: Record<string, CSSProperties> = {
    "top-left": { top: "-18vmin", left: "-18vmin" },
    "top-right": { top: "-18vmin", right: "-18vmin" },
    "bottom-left": { bottom: "-18vmin", left: "-18vmin" },
    "bottom-right": { bottom: "-18vmin", right: "-18vmin" },
  };
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", ...style }}>
      <div
        style={{
          position: "absolute",
          width: "55vmin",
          height: "55vmin",
          borderRadius: "50%",
          background: "#FFFFFF",
          opacity: 0.05,
          ...pos[corner],
        }}
      />
    </div>
  );
}
