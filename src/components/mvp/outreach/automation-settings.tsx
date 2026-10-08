"use client";
import { useEffect,useState } from 'react';
import { apiJson } from '../api-client';
import { DemoFunnelSetup,type FunnelSettings } from './demo-funnel-setup';

/** Account setup lives here; browsing a lead never activates outreach. */
export function AutomationSettings({initial,calendarResult}:{initial:FunnelSettings;calendarResult?:string}) {
  const [settings,setSettings]=useState(initial);
  useEffect(()=>{let disposed=false;const timer=setInterval(()=>{void apiJson<{settings:FunnelSettings}>('/api/mvp/automation').then(data=>{if(!disposed)setSettings(data.settings);}).catch(()=>{});},10_000);return()=>{disposed=true;clearInterval(timer);};},[]);
  return <DemoFunnelSetup settings={settings} onChange={setSettings} returnTo='/settings?tab=automation' calendarResult={calendarResult}/>;
}
