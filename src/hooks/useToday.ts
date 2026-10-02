import { useEffect, useState } from "react";
import { todayHbDate } from "../lib/wallet";

export function useToday() {
  const [today, setToday] = useState(() => todayHbDate());
  useEffect(() => {
    const update = () => setToday(todayHbDate());
    const timer = window.setInterval(update, 60000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  return today;
}
