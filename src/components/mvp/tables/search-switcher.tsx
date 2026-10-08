"use client";

import { useRouter } from "next/navigation";
import type { TableTab } from "@/mvp/crm/contracts";

export function SearchSwitcher({value,tab,options}:{value:string;tab:TableTab;options:{id:string;label:string}[]}) {
  const router=useRouter();
  return <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold">Search
    <select aria-label="Search" className="control h-11 w-full px-3 font-normal" value={value} onChange={event=>router.push(`/crm?${new URLSearchParams({run:event.target.value,tab})}`)}>
      <option value="none" disabled>Choose a search</option>{options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}<option value="all">All searches · combined view</option>
    </select>
  </label>;
}
