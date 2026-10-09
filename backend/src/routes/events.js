// Tests and interviews read from Gmail (table interview_event, view v_upcoming_events).
import { Router } from 'express';
import { q, q1, run } from '../db.js';
import { uid } from '../auth.js';

const r = Router();
const OUTCOMES = ['Scheduled', 'Done', 'Passed', 'Not selected', 'Cancelled'];

// what's coming up for the signed-in person (or the demo data when nobody is signed in)
r.get('/events/upcoming', (req, res) => {
  res.json(q('SELECT * FROM v_upcoming_events WHERE user_id IS ? LIMIT 20', [uid(req)]));
});

// mark how a round went
r.patch('/events/:id', (req, res) => {
  const outcome = String(req.body?.outcome || '');
  if (!OUTCOMES.includes(outcome)) return res.status(400).json({ error: `Outcome must be one of: ${OUTCOMES.join(', ')}.` });
  const { changes } = run('UPDATE interview_event SET outcome = ? WHERE event_id = ? AND user_id IS ?', [outcome, Number(req.params.id), uid(req)]);
  if (!changes) return res.status(404).json({ error: 'That test or interview was not found.' });
  res.json({ ok: true });
});

r.delete('/events/:id', (req, res) => {
  run('DELETE FROM interview_event WHERE event_id = ? AND user_id IS ?', [Number(req.params.id), uid(req)]);
  res.json({ ok: true });
});

export const eventsFor = (appId, userId) => q(
  `SELECT e.*, k.full_name AS hr_name, k.phone AS hr_phone FROM interview_event e
     LEFT JOIN contact k ON k.contact_id = e.contact_id
    WHERE e.app_id = ? AND e.user_id IS ? ORDER BY COALESCE(e.scheduled_at, e.due_by, e.created_at)`, [appId, userId]);

export default r;
