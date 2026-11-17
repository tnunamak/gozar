import test from 'node:test';
import {exercise} from './real-durable-testing-effects.test.mjs';

// Reuse the real LocalAPI/CAS/nonce-proof fixture, including runtime consent,
// same-operation replay, suspend/resume, generation-fenced Stop and foreign rules.
// No canned provider replies or alternate operation IDs bypass the failing path.
test('durable resume recovers a stale operation journal without a second write',
 t=>exercise(t,{resumeJournal:true}));
