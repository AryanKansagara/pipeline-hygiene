// node scripts/qa-sync.mjs : signs up a throwaway account, round-trips an org and a snapshot through the same tables the app syncs to, then deletes the account
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => l.split('=')))
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } })
const email = `qa-pipeline-hygiene-${Date.now()}@example.com`, password = 'qa-' + Math.random().toString(36).slice(2) + 'X9!'
const ok = (label, r) => { if (r.error) { console.log('FAIL', label, r.error.message); process.exitCode = 1 } else console.log('ok  ', label) }
const up = await sb.auth.signUp({ email, password }); ok('sign up ' + email, up)
if (!up.data.session) ok('sign in', await sb.auth.signInWithPassword({ email, password }))
const id = crypto.randomUUID(), vid = crypto.randomUUID()
ok('upsert org', await sb.from('projects').upsert({ id, app: 'pipeline-hygiene', name: 'QA org', data: { project: { id, name: 'QA org', config: { staleDays: 14, approved: { '006QA': 1798675200000 } } } }, updated_at: new Date().toISOString() }))
ok('insert snapshot', await sb.from('project_versions').insert({ id: vid, project_id: id, label: 'Q3 2026', data: { id: vid, label: 'Week of Nov 6, 2026', asOf: 1793923200000, score: 78 } }))
const rows = await sb.from('projects').select('id,name,data').eq('app', 'pipeline-hygiene'); ok('read back', rows)
console.log(rows.data?.length === 1 && rows.data[0].data.project.config.approved['006QA'] === 1798675200000 ? 'ok   round trip matches' : 'FAIL round trip')
const vs = await sb.from('project_versions').select('id').in('project_id', [id]); console.log(vs.data?.length === 1 ? 'ok   snapshot round trip' : 'FAIL snapshot')
ok('delete account', await sb.rpc('delete_my_account'))
const after = await sb.auth.signInWithPassword({ email, password }); console.log(after.error ? 'ok   account gone (' + after.error.message + ')' : 'FAIL account still exists')
