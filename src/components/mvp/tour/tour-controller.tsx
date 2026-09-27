"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { driver, type Driver } from "driver.js";
import { apiJson } from "../api-client";
import { EVENTS, emit, safeStorage } from "../shell/events";
import { useToast } from "../shell/toast";
import { TOUR_STEPS, progressText, stepPath, tourSelector, type TourStep } from "./steps";

/**
 * Cross-page guided tour (docs/mvp/13 §8) on top of driver.js.
 *
 * - The current step is kept in localStorage, so the tour survives navigation and reloads.
 * - Each step belongs to one page: the controller navigates there, waits for the `data-tour` element,
 *   then shows one driver.js popover ("Step n of 12", Back / Next, ✕ and Esc end the tour).
 * - Starts by itself the first time the app is opened in a browser; Help → Take the tour restarts it.
 * - Without leads, lead steps point at "Load sample leads" (or offer it in the popover).
 */

interface TourState {
  active: boolean;
  index: number;
  leadId: string | null;
}

export const TOUR_STATE_KEY = "mvp.tour.state";
export const TOUR_SEEN_KEY = "mvp.tour.seen";
const ELEMENT_WAIT_MS = 4000;
const INACTIVE: TourState = { active: false, index: 0, leadId: null };

function readState(): TourState {
  try {
    const raw = safeStorage.get(TOUR_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TourState>;
      if (parsed.active && typeof parsed.index === "number" && parsed.index >= 0 && parsed.index < TOUR_STEPS.length) {
        return { active: true, index: parsed.index, leadId: typeof parsed.leadId === "string" ? parsed.leadId : null };
      }
    }
  } catch {
    // ignore a broken value
  }
  // First visit in this browser: start the tour.
  if (typeof window !== "undefined" && !safeStorage.get(TOUR_SEEN_KEY)) return { active: true, index: 0, leadId: null };
  return INACTIVE;
}

function visible(element: Element | null): element is HTMLElement {
  return Boolean(element && (element as HTMLElement).getClientRects().length > 0);
}

/** Wait until the step's element (or its empty-state fallback) is on screen. */
async function waitForTarget(step: TourStep, timeoutMs: number, isCancelled: () => boolean): Promise<{ element: HTMLElement | null; empty: boolean }> {
  const started = Date.now();
  for (;;) {
    if (isCancelled()) return { element: null, empty: false };
    const main = step.element ? document.querySelector(tourSelector(step.element)) : null;
    if (visible(main)) return { element: main, empty: false };
    const fallback = step.emptyElement ? document.querySelector(tourSelector(step.emptyElement)) : null;
    if (visible(fallback)) return { element: fallback, empty: true };
    if (!step.element || Date.now() - started > timeoutMs) return { element: null, empty: Boolean(step.needsLeads) };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function findLeadId(): Promise<string | null> {
  try {
    const data = await apiJson<{ items: { id: string }[] }>("/api/mvp/leads?tab=all&status=all&sort=score&limit=1");
    return data.items[0]?.id ?? null;
  } catch {
    return null;
  }
}

export function TourController() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const toast = useToast();
  const [state, setState] = useState<TourState>(readState);
  const stateRef = useRef(state);
  const driverRef = useRef<Driver | null>(null);
  const closingInternally = useRef(false);

  const update = useCallback((next: TourState) => {
    stateRef.current = next;
    setState(next);
    if (next.active) safeStorage.set(TOUR_STATE_KEY, JSON.stringify(next));
    else safeStorage.remove(TOUR_STATE_KEY);
  }, []);

  const closeDriver = useCallback(() => {
    const current = driverRef.current;
    driverRef.current = null;
    if (!current) return;
    closingInternally.current = true;
    try {
      current.destroy();
    } finally {
      closingInternally.current = false;
    }
  }, []);

  const end = useCallback(
    (finished: boolean) => {
      closeDriver();
      safeStorage.set(TOUR_SEEN_KEY, "1");
      update(INACTIVE);
      if (finished) toast.show({ message: "Tour finished. Take it again any time from Help.", tone: "success" });
    },
    [closeDriver, toast, update],
  );

  // Remember that the tour was offered in this browser.
  // An auto-started tour (first visit) is only in React state: save it too, so a reload keeps it.
  useEffect(() => {
    if (!state.active) return;
    safeStorage.set(TOUR_SEEN_KEY, "1");
    if (!safeStorage.get(TOUR_STATE_KEY)) safeStorage.set(TOUR_STATE_KEY, JSON.stringify(stateRef.current));
  }, [state.active]);

  useEffect(() => {
    const start = () => {
      closeDriver();
      update({ active: true, index: 0, leadId: null });
    };
    window.addEventListener(EVENTS.startTour, start);
    return () => window.removeEventListener(EVENTS.startTour, start);
  }, [closeDriver, update]);

  useEffect(() => () => closeDriver(), [closeDriver]);

  const loadSample = useCallback(async () => {
    end(false);
    try {
      const ticket = await apiJson<{ ticketId: string; runId: string | null }>("/api/mvp/sample", { method: "POST" });
      toast.show({ message: "Loading sample leads… Take the tour again from Help when they are ready." });
      router.push(ticket.runId ? `/find?run=${ticket.runId}` : `/find?ticket=${encodeURIComponent(ticket.ticketId)}`);
      emit(EVENTS.refreshStatus);
    } catch (error) {
      toast.show({ message: error instanceof Error ? error.message : "Sample leads could not be loaded.", tone: "error" });
    }
  }, [end, router, toast]);

  useEffect(() => {
    if (!state.active) {
      closeDriver();
      return;
    }
    const index = state.index;
    const step = TOUR_STEPS[index];
    let cancelled = false;
    const isCancelled = () => cancelled;

    void (async () => {
      if (!step) {
        end(true);
        return;
      }
      let leadId = state.leadId;
      if (step.page === "lead" && !leadId) {
        leadId = await findLeadId();
        if (cancelled) return;
        if (leadId) {
          update({ ...stateRef.current, leadId });
          return; // re-runs with the lead id
        }
      }
      const path = stepPath(step, leadId);
      if (path && pathname !== path) {
        closeDriver();
        router.push(path);
        return; // re-runs on the new page
      }

      const target = await waitForTarget(step, ELEMENT_WAIT_MS, isCancelled);
      if (cancelled) return;
      const noLeads = Boolean(step.needsLeads && (target.empty || (step.page === "lead" && !leadId)));
      const offerSampleButton = noLeads && !target.element;
      const last = index === TOUR_STEPS.length - 1;

      closeDriver();
      const instance = driver({
        animate: true,
        allowClose: true,
        overlayOpacity: 0.45,
        stagePadding: 6,
        stageRadius: 10,
        smoothScroll: true,
        popoverClass: "mvp-tour",
        showProgress: true,
        steps: [
          {
            element: target.element ?? undefined,
            popover: {
              title: step.title,
              description: noLeads && step.emptyDescription ? step.emptyDescription : step.description,
              side: step.side,
              align: "start",
              progressText: progressText(index),
              showButtons: ["next", "previous", "close"],
              disableButtons: index === 0 ? ["previous"] : [],
              prevBtnText: "Back",
              nextBtnText: last ? "Finish" : "Next",
              doneBtnText: last ? "Finish" : "Next",
              onPopoverRender: (popover) => {
                if (!offerSampleButton) return;
                const button = document.createElement("button");
                button.type = "button";
                button.className = "tour-sample-btn";
                button.textContent = "Load sample leads";
                button.addEventListener("click", () => void loadSample());
                popover.description.appendChild(document.createElement("br"));
                popover.description.appendChild(button);
              },
            },
          },
        ],
        onNextClick: () => {
          if (last) end(true);
          else update({ ...stateRef.current, index: index + 1 });
        },
        onPrevClick: () => {
          if (index > 0) update({ ...stateRef.current, index: index - 1 });
        },
        onCloseClick: () => end(false),
        onDestroyStarted: () => {
          // Esc or a click on the dark overlay: end the tour ("Skip").
          if (!closingInternally.current) end(false);
        },
      });
      driverRef.current = instance;
      instance.drive(0);
    })();

    return () => {
      cancelled = true;
    };
  }, [state, pathname, router, update, closeDriver, end, loadSample]);

  return null;
}
