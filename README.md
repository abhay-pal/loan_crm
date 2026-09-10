# APS Loan CRM

A private browser-based CRM for a loan sales and processing team, built from
the `Loan_CRM_Preeti.pdf` requirements.

## Included

- Role-based login with seeded Admin, Manager, Agent, and Auditor users
- Lead creation, duplicate detection, CSV upload, saved views, filters, and CSV export
- Manual and automatic assignment, capacity checks, list view, and Kanban view
- Full lead workspace with editable borrower details, stage movement, mandatory remarks, notes, calls, follow-ups, tasks, and document checklist
- Document upload/download backed by the configured object bucket
- In-app notifications, daily queue, dashboards, reports, settings, users, recycle bin behavior, audit trail, and login history
- D1-backed CRM state and session storage with generated Drizzle migrations

## Demo Accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin / Owner | admin@apsloancrm.com | Preeti@123 |
| Team Manager | manager@apsloancrm.com | Team@123 |
| Loan Officer / Agent | agent@apsloancrm.com | Agent@123 |
| Viewer / Auditor | auditor@apsloancrm.com | Audit@123 |

The admin account has email OTP enabled in the preview. Use `246810`.

## Commands

```bash
npm run dev
npm run lint
npm test
npm run db:generate
```
