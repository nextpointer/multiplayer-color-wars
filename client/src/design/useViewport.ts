import { useEffect, useState } from "react";

export function getEffectiveViewport() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const forceLandscape = w < h && w < 900;
  return {
    width: forceLandscape ? h : w,
    height: forceLandscape ? w : h,
    forceLandscape,
  };
}

export function useViewport() {
  const [v, setV] = useState(getEffectiveViewport);
  useEffect(() => {
    const on = () => setV(getEffectiveViewport());
    on();
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  return v;
}
