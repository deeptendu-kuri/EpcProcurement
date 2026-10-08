/** Narrow supervised local recovery. Never run against a listening app or cloud DB. */
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
const root=fileURLToPath(new URL('..',import.meta.url));
const listening=await new Promise(resolve=>{
  const socket=net.connect({host:'127.0.0.1',port:3007});
  socket.setTimeout(1500);socket.once('connect',()=>{socket.destroy();resolve(true);});
  socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(true);});
});
assert.equal(listening,false,'Stop every local demo server before opening PGlite.');
const db=await PGlite.create(path.join(root,'tmp/automation-demo-db-20261003'));
try {
  await db.transaction(async tx=>{
    const control=(await tx.query('select enabled,worker_lease,worker_until,last_tick_at,last_error from funnel_control where id=1 for update')).rows[0];
    const pending=(await tx.query("select id,kind,state from funnel_messages where direction='out' and state in ('queued','sending')")).rows;
    const active=(await tx.query('select id,state,paused,event_id,meet_url from funnel_threads where not paused')).rows;
    console.log(JSON.stringify({localServerStopped:true,control,pending,active},null,2));
    if(!process.argv.includes('--execute'))return;
    assert.equal(control.enabled,true);assert.ok(control.worker_lease);
    assert.equal(pending.length,0,'Never clear a lease with pending/in-flight deliveries.');
    assert.equal(active.length,1);
    assert.equal(active[0].id,'2ae0a415-1516-48dd-8c87-2c2ffab5832c');
    assert.equal(active[0].state,'awaiting_time');
    assert.equal(active[0].event_id,null);assert.equal(active[0].meet_url,null);
    // Both known servers have exited. The sole unpaused thread cannot book or
    // deliver in awaiting_time, and no outgoing provider call is pending.
    const changed=(await tx.query('update funnel_control set worker_lease=null,worker_until=null where id=1 and worker_lease=$1 returning id',[control.worker_lease])).rows;
    assert.equal(changed.length,1);
    console.log(JSON.stringify({abandonedLocalLeaseReleased:true,noMessagesReplayed:true,noThreadsResumed:true,noCalendarWrites:true}));
  });
} finally {await db.close();}
