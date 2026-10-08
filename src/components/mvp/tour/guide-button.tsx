"use client";

import { CircleHelp } from "lucide-react";
import { EVENTS, emit } from "../shell/events";

export function GuideButton() {
  return <button type="button" className="btn btn-secondary" onClick={() => emit(EVENTS.startTour)}><CircleHelp size={16} aria-hidden />Take a quick guide</button>;
}
