-- ============================================================
-- Migration 005 — Service fingerprinting columns + template update
-- Forward-only: never modify this file.
-- ============================================================

-- Enrich naabu_results with service fingerprinting data.
-- `host` now stores the domain/hostname (preferred over IP for subdomain tracking).
-- `ip`   stores the resolved IP address.
-- `service`         — canonical label: http, https, ssh, smb, ftp, smtp, etc.
-- `service_version` — version string extracted from banner/handshake
-- `service_source`  — which tool identified it: 'zgrab2' or 'nmap'
-- `banner`          — first few bytes / raw banner from the port

ALTER TABLE naabu_results ADD COLUMN ip              TEXT;
ALTER TABLE naabu_results ADD COLUMN service         TEXT;
ALTER TABLE naabu_results ADD COLUMN service_version TEXT;
ALTER TABLE naabu_results ADD COLUMN service_source  TEXT;
ALTER TABLE naabu_results ADD COLUMN banner          TEXT;

-- Update pipeline templates to include zgrab2_service + httpx_ports steps
-- after naabu / naabu_full in the Port Scanning group.
-- These UPDATEs replace the g12 / g13 "Port Scanning" group JSON inline.
-- Migration 002 uses INSERT OR IGNORE so templates already exist in the DB;
-- we patch them here to add the new steps.

-- tpl_standard: g12 "Port Scanning" → add zgrab2_service + httpx_ports
UPDATE pipeline_templates SET config =
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
    {"id":"g12","name":"Port Scanning & Service Detection","position":12,"parallel":false,
     "steps":[
       {"step_id":"naabu","position":1,"enabled":true},
       {"step_id":"zgrab2_service","position":2,"enabled":true},
       {"step_id":"httpx_ports","position":3,"enabled":true}
     ]},
    {"id":"g13","name":"Takeover Detection","position":13,"parallel":false,
     "steps":[{"step_id":"nuclei_takeover","position":1,"enabled":true}]},
    {"id":"g14","name":"Screenshots","position":14,"parallel":false,
     "steps":[{"step_id":"gowitness","position":1,"enabled":true}]},
    {"id":"g15","name":"Diff Engine","position":15,"parallel":false,
     "steps":[{"step_id":"diff","position":1,"enabled":true}]}
  ]
}'
WHERE id = 'tpl_standard';

-- tpl_saas: g12 same update
UPDATE pipeline_templates SET config =
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
    {"id":"g12","name":"Port Scanning & Service Detection","position":12,"parallel":false,
     "steps":[
       {"step_id":"naabu","position":1,"enabled":true},
       {"step_id":"zgrab2_service","position":2,"enabled":true},
       {"step_id":"httpx_ports","position":3,"enabled":true}
     ]},
    {"id":"g13","name":"S3 Bucket Scan","position":13,"parallel":false,
     "steps":[{"step_id":"s3scanner","position":1,"enabled":true}]},
    {"id":"g14","name":"Takeover Detection","position":14,"parallel":false,
     "steps":[{"step_id":"nuclei_takeover","position":1,"enabled":true}]},
    {"id":"g15","name":"Screenshots","position":15,"parallel":false,
     "steps":[{"step_id":"gowitness","position":1,"enabled":true}]}
  ]
}'
WHERE id = 'tpl_saas';

-- tpl_corporate: g13 "Port Scanning (Extended)" → add zgrab2_service + httpx_ports
UPDATE pipeline_templates SET config =
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
    {"id":"g13","name":"Port Scanning & Service Detection (Extended)","position":13,"parallel":false,
     "steps":[
       {"step_id":"naabu_full","position":1,"enabled":true},
       {"step_id":"zgrab2_service","position":2,"enabled":true},
       {"step_id":"httpx_ports","position":3,"enabled":true}
     ]},
    {"id":"g14","name":"Takeover Detection","position":14,"parallel":false,
     "steps":[{"step_id":"nuclei_takeover","position":1,"enabled":true}]},
    {"id":"g15","name":"Screenshots","position":15,"parallel":false,
     "steps":[{"step_id":"gowitness","position":1,"enabled":true}]}
  ]
}'
WHERE id = 'tpl_corporate';

-- tpl_minimal has no port scanning group — no change needed.
