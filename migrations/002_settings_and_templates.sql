-- ============================================================
-- Migration 002 — Settings table + pipeline template seed data
-- Forward-only: never modify this file.
-- ============================================================

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('telegram.enabled',             'false'),
    ('telegram.bot_token',           NULL),
    ('telegram.chat_id',             NULL),
    ('telegram.notify_new_hosts',    'true'),
    ('telegram.notify_host_changes', 'true'),
    ('telegram.notify_scan_complete','true'),
    ('telegram.notify_errors',       'true');

-- ── Pipeline templates ────────────────────────────────────────────────────────
-- Standard: all 15 groups, 25 steps
INSERT OR IGNORE INTO pipeline_templates (id, name, display_name, description, config, is_default) VALUES
('tpl_standard', 'standard', 'Standard', 'Full recon pipeline — 15 groups, 25 steps',
'{
  "groups": [
    {"id":"g01","name":"Passive Enumeration","position":1,"parallel":true,
     "steps":[
       {"step_id":"subfinder","position":1,"enabled":true},
       {"step_id":"amass","position":2,"enabled":true},
       {"step_id":"tlsx","position":3,"enabled":true},
       {"step_id":"assetfinder","position":4,"enabled":true},
       {"step_id":"crt_sh","position":5,"enabled":true},
       {"step_id":"gau","position":6,"enabled":true}
     ]},
    {"id":"g02","name":"DNS Brute-force (Default Wordlist)","position":2,"parallel":false,
     "steps":[{"step_id":"puredns_default","position":1,"enabled":true}]},
    {"id":"g03","name":"Consolidate R1","position":3,"parallel":false,
     "steps":[{"step_id":"consolidate_r1","position":1,"enabled":true}]},
    {"id":"g04","name":"HTTP Probe R1","position":4,"parallel":false,
     "steps":[{"step_id":"httpx_r1","position":1,"enabled":true}]},
    {"id":"g05","name":"Permutation Generation","position":5,"parallel":false,
     "steps":[{"step_id":"alterx","position":1,"enabled":true}]},
    {"id":"g06","name":"DNS Resolve Permutations","position":6,"parallel":false,
     "steps":[{"step_id":"puredns_permutation","position":1,"enabled":true}]},
    {"id":"g07","name":"Consolidate R2","position":7,"parallel":false,
     "steps":[{"step_id":"consolidate_r2","position":1,"enabled":true}]},
    {"id":"g08","name":"HTTP Probe R2","position":8,"parallel":false,
     "steps":[{"step_id":"httpx_r2","position":1,"enabled":true}]},
    {"id":"g09","name":"JS Crawling","position":9,"parallel":true,
     "steps":[
       {"step_id":"katana","position":1,"enabled":true},
       {"step_id":"subdomainizer","position":2,"enabled":true}
     ]},
    {"id":"g10","name":"Consolidate R3","position":10,"parallel":false,
     "steps":[{"step_id":"consolidate_r3","position":1,"enabled":true}]},
    {"id":"g11","name":"HTTP Probe R3","position":11,"parallel":false,
     "steps":[{"step_id":"httpx_r3","position":1,"enabled":true}]},
    {"id":"g12","name":"Port Scanning","position":12,"parallel":false,
     "steps":[{"step_id":"naabu","position":1,"enabled":true}]},
    {"id":"g13","name":"Takeover Detection","position":13,"parallel":false,
     "steps":[{"step_id":"nuclei_takeover","position":1,"enabled":true}]},
    {"id":"g14","name":"Screenshots","position":14,"parallel":false,
     "steps":[{"step_id":"gowitness","position":1,"enabled":true}]},
    {"id":"g15","name":"Diff Engine","position":15,"parallel":false,
     "steps":[{"step_id":"diff","position":1,"enabled":true}]}
  ]
}',
1);

-- SaaS/Cloud: standard + cloud_enum + s3scanner
INSERT OR IGNORE INTO pipeline_templates (id, name, display_name, description, config, is_default) VALUES
('tpl_saas', 'saas', 'SaaS / Cloud', 'Standard + cloud asset discovery (cloud_enum, s3scanner)',
'{
  "groups": [
    {"id":"g01","name":"Passive Enumeration","position":1,"parallel":true,
     "steps":[
       {"step_id":"subfinder","position":1,"enabled":true},
       {"step_id":"amass","position":2,"enabled":true},
       {"step_id":"tlsx","position":3,"enabled":true},
       {"step_id":"assetfinder","position":4,"enabled":true},
       {"step_id":"crt_sh","position":5,"enabled":true},
       {"step_id":"gau","position":6,"enabled":true},
       {"step_id":"cloud_enum","position":7,"enabled":true}
     ]},
    {"id":"g02","name":"DNS Brute-force (Default Wordlist)","position":2,"parallel":false,
     "steps":[{"step_id":"puredns_default","position":1,"enabled":true}]},
    {"id":"g03","name":"Consolidate R1","position":3,"parallel":false,
     "steps":[{"step_id":"consolidate_r1","position":1,"enabled":true}]},
    {"id":"g04","name":"HTTP Probe R1","position":4,"parallel":false,
     "steps":[{"step_id":"httpx_r1","position":1,"enabled":true}]},
    {"id":"g05","name":"Permutation Generation","position":5,"parallel":false,
     "steps":[{"step_id":"alterx","position":1,"enabled":true}]},
    {"id":"g06","name":"DNS Resolve Permutations","position":6,"parallel":false,
     "steps":[{"step_id":"puredns_permutation","position":1,"enabled":true}]},
    {"id":"g07","name":"Consolidate R2","position":7,"parallel":false,
     "steps":[{"step_id":"consolidate_r2","position":1,"enabled":true}]},
    {"id":"g08","name":"HTTP Probe R2","position":8,"parallel":false,
     "steps":[{"step_id":"httpx_r2","position":1,"enabled":true}]},
    {"id":"g09","name":"JS Crawling","position":9,"parallel":true,
     "steps":[
       {"step_id":"katana","position":1,"enabled":true},
       {"step_id":"subdomainizer","position":2,"enabled":true}
     ]},
    {"id":"g10","name":"Consolidate R3","position":10,"parallel":false,
     "steps":[{"step_id":"consolidate_r3","position":1,"enabled":true}]},
    {"id":"g11","name":"HTTP Probe R3","position":11,"parallel":false,
     "steps":[{"step_id":"httpx_r3","position":1,"enabled":true}]},
    {"id":"g12","name":"Port Scanning","position":12,"parallel":false,
     "steps":[{"step_id":"naabu","position":1,"enabled":true}]},
    {"id":"g13","name":"S3 Bucket Scan","position":13,"parallel":false,
     "steps":[{"step_id":"s3scanner","position":1,"enabled":true}]},
    {"id":"g14","name":"Takeover Detection","position":14,"parallel":false,
     "steps":[{"step_id":"nuclei_takeover","position":1,"enabled":true}]},
    {"id":"g15","name":"Screenshots","position":15,"parallel":false,
     "steps":[{"step_id":"gowitness","position":1,"enabled":true}]}
  ]
}',
0);

-- Corporate: standard + WAF detection + extended port range
INSERT OR IGNORE INTO pipeline_templates (id, name, display_name, description, config, is_default) VALUES
('tpl_corporate', 'corporate', 'Corporate', 'Standard + WAF fingerprinting + extended port range',
'{
  "groups": [
    {"id":"g01","name":"Passive Enumeration","position":1,"parallel":true,
     "steps":[
       {"step_id":"subfinder","position":1,"enabled":true},
       {"step_id":"amass","position":2,"enabled":true},
       {"step_id":"tlsx","position":3,"enabled":true},
       {"step_id":"assetfinder","position":4,"enabled":true},
       {"step_id":"crt_sh","position":5,"enabled":true},
       {"step_id":"gau","position":6,"enabled":true}
     ]},
    {"id":"g02","name":"DNS Brute-force (Default Wordlist)","position":2,"parallel":false,
     "steps":[{"step_id":"puredns_default","position":1,"enabled":true}]},
    {"id":"g03","name":"Consolidate R1","position":3,"parallel":false,
     "steps":[{"step_id":"consolidate_r1","position":1,"enabled":true}]},
    {"id":"g04","name":"HTTP Probe R1","position":4,"parallel":false,
     "steps":[{"step_id":"httpx_r1","position":1,"enabled":true}]},
    {"id":"g05","name":"WAF Detection","position":5,"parallel":false,
     "steps":[{"step_id":"wafw00f","position":1,"enabled":true}]},
    {"id":"g06","name":"Permutation Generation","position":6,"parallel":false,
     "steps":[{"step_id":"alterx","position":1,"enabled":true}]},
    {"id":"g07","name":"DNS Resolve Permutations","position":7,"parallel":false,
     "steps":[{"step_id":"puredns_permutation","position":1,"enabled":true}]},
    {"id":"g08","name":"Consolidate R2","position":8,"parallel":false,
     "steps":[{"step_id":"consolidate_r2","position":1,"enabled":true}]},
    {"id":"g09","name":"HTTP Probe R2","position":9,"parallel":false,
     "steps":[{"step_id":"httpx_r2","position":1,"enabled":true}]},
    {"id":"g10","name":"JS Crawling","position":10,"parallel":true,
     "steps":[
       {"step_id":"katana","position":1,"enabled":true},
       {"step_id":"subdomainizer","position":2,"enabled":true}
     ]},
    {"id":"g11","name":"Consolidate R3","position":11,"parallel":false,
     "steps":[{"step_id":"consolidate_r3","position":1,"enabled":true}]},
    {"id":"g12","name":"HTTP Probe R3","position":12,"parallel":false,
     "steps":[{"step_id":"httpx_r3","position":1,"enabled":true}]},
    {"id":"g13","name":"Port Scanning (Extended)","position":13,"parallel":false,
     "steps":[{"step_id":"naabu_full","position":1,"enabled":true}]},
    {"id":"g14","name":"Takeover Detection","position":14,"parallel":false,
     "steps":[{"step_id":"nuclei_takeover","position":1,"enabled":true}]},
    {"id":"g15","name":"Screenshots","position":15,"parallel":false,
     "steps":[{"step_id":"gowitness","position":1,"enabled":true}]}
  ]
}',
0);

-- Minimal: passive + consolidate + httpx only (fastest)
INSERT OR IGNORE INTO pipeline_templates (id, name, display_name, description, config, is_default) VALUES
('tpl_minimal', 'minimal', 'Minimal', 'Passive enumeration + consolidate + HTTP probe only (fastest)',
'{
  "groups": [
    {"id":"g01","name":"Passive Enumeration","position":1,"parallel":true,
     "steps":[
       {"step_id":"subfinder","position":1,"enabled":true},
       {"step_id":"tlsx","position":2,"enabled":true},
       {"step_id":"crt_sh","position":3,"enabled":true}
     ]},
    {"id":"g02","name":"Consolidate R1","position":2,"parallel":false,
     "steps":[{"step_id":"consolidate_r1","position":1,"enabled":true}]},
    {"id":"g03","name":"HTTP Probe R1","position":3,"parallel":false,
     "steps":[{"step_id":"httpx_r1","position":1,"enabled":true}]}
  ]
}',
0);
