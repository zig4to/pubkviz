"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Pokliče `onChange`, ko se v sobi kaj spremeni. Vir signala je sprožilec v
 * bazi (`kviz_ping_*` → realtime.send na javni kanal `kviz:<roomId>`, prazen
 * dogodek „changed“). Ker telefoni radi zaspijo in izgubijo websocket, je tu
 * še rezerva: osvežitev ob vrnitvi v zavihek in vsakih `fallbackMs`.
 * Sunki signalov (npr. ocenjevanje vseh odgovorov) se zložijo v en klic.
 */
export function useRoomPing(roomId: string | null, onChange: () => void, fallbackMs = 6000) {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });

  useEffect(() => {
    if (!roomId) return;
    const supabase = createClient();
    let timer: number | undefined;
    const fire = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => cb.current(), 120);
    };

    const channel = supabase
      .channel(`kviz:${roomId}`, { config: { private: false } })
      .on("broadcast", { event: "changed" }, fire)
      .subscribe((status) => {
        // Po (ponovni) povezavi preberi stanje — vmes smo lahko kaj zamudili.
        if (status === "SUBSCRIBED") fire();
      });

    const onVisible = () => {
      if (document.visibilityState === "visible") fire();
    };
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") cb.current();
    }, fallbackMs);

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [roomId, fallbackMs]);
}
