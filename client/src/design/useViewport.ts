import { useEffect, useState } from "react";

export function getEffectiveViewport() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    width: w,
    height: h,
    forceLandscape: false,
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
