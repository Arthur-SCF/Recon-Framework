-- Migration 012: Remove naabu_full step from all pipeline templates.
-- naabu now supports configurable port ranges (top_ports: 1000/5000/full),
-- making a separate naabu_full step redundant.

-- 1. Remove from live pipeline_steps (running targets)
DELETE FROM pipeline_steps WHERE step_id = 'naabu_full';

-- 2. Patch pipeline_templates seed JSON: remove the naabu_full entry
--    (it always follows naabu as the second step in the Port Scanning group)
UPDATE pipeline_templates
SET config = REPLACE(
    REPLACE(
        config,
        ',
       {"step_id":"naabu_full","position":2,"enabled":false}',
        ''
    ),
    ',
       {"step_id":"naabu_full","position":2,"enabled":true}',
    ''
)
WHERE config LIKE '%naabu_full%';
