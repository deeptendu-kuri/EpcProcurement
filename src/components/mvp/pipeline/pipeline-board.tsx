"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarClock, GripVertical } from "lucide-react";
import { marketName } from "@/mvp/config/markets";
import type { LeadListItem } from "@/mvp/types";
import { SampleBadge } from "../badges";
import { STATUS_LABELS, formatDate } from "../labels";
import { ScorePill } from "../leads/leads-table";
import { useLeadActions } from "../leads/use-lead-actions";
import { BOARD_STATUSES, DRAG_TYPE, columnSummary, groupByStatus, isBoardStatus, type BoardStatus } from "./board-state";

const COLUMN_HINT: Record<BoardStatus, string> = {
  new: "Not looked at yet",
  accepted: "Worth following",
  contacted: "First contact made",
  rfq: "They asked for a quote",
  quoted: "Quote sent",
  won: "Deal won",
  lost: "Deal lost",
};

function BoardCard({
  lead,
  status,
  busy,
  onMove,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  lead: LeadListItem;
  status: BoardStatus;
  busy: boolean;
  onMove: (to: BoardStatus) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  const country = lead.projectCountry ?? lead.buyerCountry;
  return (
    <li
      draggable={!busy}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, lead.id);
        event.dataTransfer.setData("text/plain", lead.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      data-lead-id={lead.id}
      className={`board-card group ${dragging ? "opacity-40" : ""} ${busy ? "opacity-70" : ""}`}
    >
      <div className="flex items-start gap-2">
        <GripVertical size={14} className="mt-0.5 shrink-0 cursor-grab text-[#c3c7cf] group-hover:text-[#9ca3af]" aria-hidden />
        <div className="min-w-0 flex-1">
          <Link href={`/buyers/${lead.id}`} className="block text-[0.8125rem] font-semibold leading-snug text-[#111827] hover:underline">
            {lead.buyerName}
            {lead.projectName ? <span className="font-normal text-[#6b7280]"> → {lead.projectName}</span> : null}
          </Link>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[#6b7280]">
            {country ? <span>{marketName(country)}</span> : null}
            {lead.closingDate ? (
              <span className="inline-flex items-center gap-0.5">
                <CalendarClock size={11} aria-hidden /> {formatDate(lead.closingDate)}
              </span>
            ) : null}
            {lead.isSample ? <SampleBadge /> : null}
          </p>
        </div>
        <ScorePill score={lead.score} />
      </div>
      {lead.nextAction ? <p className="mt-2 rounded-md bg-[var(--subtle)] px-2 py-1 text-xs text-[#374151]">Next: {lead.nextAction}</p> : null}
      <label className="mt-2 flex items-center gap-1.5 text-xs text-[#6b7280]">
        <span className="sr-only">Move {lead.buyerName} to</span>
        <span aria-hidden>Move to</span>
        <select
          value={status}
          disabled={busy}
          onChange={(event) => {
            if (isBoardStatus(event.target.value)) onMove(event.target.value);
          }}
          className="control h-7 min-h-0 flex-1 px-1.5 text-xs"
        >
          {BOARD_STATUSES.map((value) => (
            <option key={value} value={value}>{STATUS_LABELS[value]}</option>
          ))}
        </select>
      </label>
    </li>
  );
}

/**
 * Pipeline board (docs/mvp/13 §5): one column per status. Move a card by native drag and drop, or with its
 * status menu (keyboard and touch). Moves are optimistic, roll back on error, offer Undo, and each one
 * records an activity on the lead (PATCH /api/mvp/leads/[id]).
 */
export function PipelineBoard({ items }: { items: LeadListItem[] }) {
  const actions = useLeadActions();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<BoardStatus | null>(null);
  const columns = groupByStatus(items, actions.statusOf);
  const byId = new Map(items.map((item) => [item.id, item]));

  const move = (id: string, to: BoardStatus) => {
    const lead = byId.get(id);
    if (!lead) return;
    const from = actions.statusOf(id, lead.status);
    if (from === to) return;
    void actions.move(id, from, to, lead.buyerName);
  };

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 lg:-mx-6 lg:px-6" data-tour="pipeline-board">
      <ol className="flex min-w-max snap-x gap-3" aria-label="Pipeline">
        {BOARD_STATUSES.map((status) => {
          const cards = columns[status];
          const { count, averageScore } = columnSummary(cards);
          return (
            <li
              key={status}
              aria-label={`${STATUS_LABELS[status]}: ${count} ${count === 1 ? "buyer" : "buyers"}`}
              onDragOver={(event) => {
                if (!draggingId) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (overColumn !== status) setOverColumn(status);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverColumn(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData(DRAG_TYPE) || event.dataTransfer.getData("text/plain") || draggingId;
                setOverColumn(null);
                setDraggingId(null);
                if (id) move(id, status);
              }}
              className={`board-column snap-start ${overColumn === status ? "board-column-over" : ""}`}
            >
              <div className="flex items-center justify-between gap-2 px-1 pb-2" data-tour={status === BOARD_STATUSES[0] ? "pipeline-first-column" : undefined}>
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-[0.8125rem] font-semibold text-[#111827]">
                    <span className={`status-dot status-${status}`} aria-hidden />
                    {STATUS_LABELS[status]}
                    <span className="count-badge">{count}</span>
                  </h2>
                  <p className="text-xs text-[#9ca3af]">{COLUMN_HINT[status]}</p>
                </div>
                {averageScore !== null ? <span className="text-xs tabular-nums text-[#9ca3af]" title="Average buyer fit">avg {averageScore}</span> : null}
              </div>
              <ul className="flex min-h-24 flex-col gap-2">
                {cards.map((lead) => (
                  <BoardCard
                    key={lead.id}
                    lead={lead}
                    status={status}
                    busy={actions.isBusy(lead.id)}
                    dragging={draggingId === lead.id}
                    onDragStart={() => setDraggingId(lead.id)}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setOverColumn(null);
                    }}
                    onMove={(to) => move(lead.id, to)}
                  />
                ))}
                {!cards.length ? <li className="board-empty">{draggingId ? "Drop here" : "No buyers"}</li> : null}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
