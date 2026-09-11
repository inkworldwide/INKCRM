# Database Dump (inkcrm_bank)
Dumped on: 2026-09-11T11:34:44.845Z

## Contents
This directory contains full JSON / compressed JSONL.GZ dumps of all MongoDB collections from the inkcrm_bank database.
- Large collections (customrecords: 166k docs, activities: 107k docs, auditlogs: 29k docs) are compressed with Gzip to easily stay well within GitHub repository file limits (<100MB per file).
- Configuration & metadata collections (status, moduledefinitions, roles, users, organizations, workflows, dashboardlayouts) are human-readable formatted JSON.

## How to Restore
To restore this database dump on any machine running MongoDB:
```bash
node database_dump/restore.js
```
