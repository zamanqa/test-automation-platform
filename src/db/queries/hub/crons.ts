import type { Database } from '@db/connection';

// USED BY (files that import this one):
//   tests/customer-api/orders/orders.spec.ts
//   tests/hub-e2e/cron/cron.spec.ts
//   tests/unified-api/orders/orders.spec.ts

/**
 * Cron and queue control on the hub database.
 *
 * These change GLOBAL state (every company, and anyone else using the dev
 * database). Always register resetAllCrons with the cleanup fixture so it runs
 * even when the test fails, and never run two suites that touch crons at once.
 */

/** Queue worker the Unified API tests enable. */
export const QUEUE_WORKER_COMMAND = 'php artisan queue:work --stop-when-empty --max-jobs=1000 --max-time=3000';

/** Queue worker the old Customer API tests enable (customers_api queue only). */
export const CUSTOMER_API_QUEUE_WORKER_COMMAND =
  'php artisan queue:work --stop-when-empty --max-jobs=100 --max-time=3000 --queue=customers_api';

/** Queues the recurring-payment cron test needs workers for (see enableQueueWorkers). */
export const RECURRING_PAYMENT_QUEUES = ['rp', 'invoiceCharge'];

/**
 * Turns on every cron whose command works on one of these queues ("... --queue=rp ...").
 * By queue name, not the full command text: the hub changes the worker commands now and then
 * (2026-09-28: the rp worker is "php artisan ... --queue=rp" and "python queue-repeater.py ... --queue=rp --company-ids=...").
 */
export function enableQueueWorkers(hub: Database, queues: string[]) {
  return hub.query(
    `UPDATE public.cms_crons SET active = true
      WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) AS q WHERE command ~ ('--queue=' || q || '( |$)'))`,
    [queues],
  );
}

/** Turns EVERY hub cron on (active = true, running = false). Global change — pair with resetAllCrons in cleanup. */
export function enableAllCrons(hub: Database) {
  return hub.query('UPDATE public.cms_crons SET active = true, running = false');
}

/** Number of queued jobs in the given queues (public.jobs). queues e.g. ['rp', 'invoiceCharge']. */
export async function countJobs(hub: Database, queues: string[]): Promise<number> {
  const row = await hub.one<{ count: string }>('SELECT COUNT(*) AS count FROM public.jobs WHERE queue = ANY($1)', [queues]);
  return Number(row.count);
}

/** Removes queued-but-never-attempted jobs of several queues. */
export function deleteStaleJobsOf(hub: Database, queues: string[]) {
  return hub.query('DELETE FROM public.jobs WHERE queue = ANY($1) AND attempts = 0', [queues]);
}

/** Turns EVERY hub cron off. Global change — always add resetAllCrons to cleanup right after. */
export function disableAllCrons(hub: Database) {
  return hub.query('UPDATE public.cms_crons SET active = false, running = false');
}

/** Turns on only the crons whose `command` text is in `commands` (constants above in this file). */
export function enableCrons(hub: Database, commands: string[]) {
  return hub.query('UPDATE public.cms_crons SET active = true WHERE command = ANY($1)', [commands]);
}

/**
 * Undo step after a cron test: turns EVERY hub cron back ON (active = true, running = false).
 * Owner's rule (2026-09-28): never leave cms_crons disabled after testing.
 */
export function resetAllCrons(hub: Database) {
  return enableAllCrons(hub);
}

/** Removes queued-but-never-attempted jobs so an old backlog does not delay the test's job. */
export function deleteStaleJobs(hub: Database, queue: string) {
  return hub.query('DELETE FROM public.jobs WHERE queue = $1 AND attempts = 0', [queue]);
}
