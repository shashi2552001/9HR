export const PIPELINE_STAGES = [
  { code: 'NEW_CANDIDATE', label: 'New Candidate', order: 1, tone: 'blue' },
  { code: 'SCREENING', label: 'Screening', order: 2, tone: 'blue' },
  { code: 'SHORTLISTED', label: 'Shortlisted', order: 3, tone: 'blue' },
  { code: 'INTERVIEW_SCHEDULED', label: 'Interview Scheduled', order: 4, tone: 'yellow' },
  { code: 'INTERVIEW_COMPLETED', label: 'Interview Completed', order: 5, tone: 'yellow' },
  { code: 'SELECTED', label: 'Selected', order: 6, tone: 'green' },
  { code: 'OFFER_RELEASED', label: 'Offer Released', order: 7, tone: 'yellow' },
  { code: 'OFFER_ACCEPTED', label: 'Offer Accepted', order: 8, tone: 'green' },
  { code: 'ONBOARDING_PENDING', label: 'Onboarding Pending', order: 9, tone: 'yellow' },
  { code: 'DOCUMENTS_SUBMITTED', label: 'Documents Submitted', order: 10, tone: 'blue' },
  { code: 'DOCUMENTS_VERIFIED', label: 'Documents Verified', order: 11, tone: 'green' },
  { code: 'JOINED', label: 'Joined', order: 12, tone: 'green' },
  { code: 'REJECTED', label: 'Rejected', order: 13, tone: 'red' },
  { code: 'ON_HOLD', label: 'On Hold', order: 14, tone: 'neutral' },
  { code: 'CANDIDATE_WITHDRAWN', label: 'Candidate Withdrawn', order: 15, tone: 'neutral' },
] as const;

export type PipelineStageCode = (typeof PIPELINE_STAGES)[number]['code'];

export const ROLE_NAMES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  RECRUITER: 'RECRUITER',
} as const;

export type RoleName = (typeof ROLE_NAMES)[keyof typeof ROLE_NAMES];

export const PERMISSION_CATALOG = [
  { code: 'users.manage', module: 'Users', description: 'Create, edit, deactivate, and delete Admin/Recruiter users' },
  { code: 'roles.manage', module: 'RBAC', description: 'Configure roles and granular permissions' },
  { code: 'system.settings', module: 'System', description: 'Configure system settings, retention, and 2FA policies' },
  { code: 'audit.view', module: 'Security', description: 'View enterprise audit logs and security alerts' },
  { code: 'sessions.manage', module: 'Security', description: 'Inspect and revoke active login sessions' },
  { code: 'jobs.manage', module: 'Recruitment', description: 'Create and update job openings and assign recruiters' },
  { code: 'candidates.view_all', module: 'Recruitment', description: 'View all candidates across all recruiters' },
  { code: 'candidates.manage', module: 'Recruitment', description: 'Create, edit, import, and update assigned candidates' },
  { code: 'candidates.assign', module: 'Recruitment', description: 'Assign or reassign candidates to recruiters' },
  { code: 'interviews.manage', module: 'Recruitment', description: 'Schedule interviews and record feedback' },
  { code: 'offers.manage', module: 'Recruitment', description: 'Release and track candidate offers' },
  { code: 'onboarding.generate', module: 'Onboarding', description: 'Generate, share, and revoke onboarding links' },
  { code: 'documents.verify', module: 'Onboarding', description: 'Approve, reject, and request re-upload of candidate documents' },
  { code: 'documents.categories', module: 'Onboarding', description: 'Configure document categories and compliance policies' },
  { code: 'reports.all', module: 'Reports', description: 'Generate and export company-wide and sensitive reports' },
  { code: 'reports.personal', module: 'Reports', description: 'View and export personal recruiter performance reports' },
] as const;

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, string[]> = {
  SUPER_ADMIN: PERMISSION_CATALOG.map((p) => p.code),
  ADMIN: [
    'jobs.manage',
    'candidates.view_all',
    'candidates.manage',
    'candidates.assign',
    'interviews.manage',
    'offers.manage',
    'onboarding.generate',
    'documents.verify',
    'reports.all',
  ],
  RECRUITER: [
    'candidates.manage',
    'interviews.manage',
    'offers.manage',
    'onboarding.generate',
    'reports.personal',
  ],
};

export const DEFAULT_DOCUMENT_CATEGORIES = [
  { code: 'ID_AADHAAR', name: 'Aadhaar Card (Masked Recommended)', groupName: 'IDENTITY', isRequired: false, isEnabled: true, allowMasked: true, legalNote: 'Optional under UIDAI/DPDP guidelines. Please upload a masked Aadhaar showing only the last 4 digits.', sortOrder: 1 },
  { code: 'ID_PAN', name: 'PAN Card', groupName: 'IDENTITY', isRequired: true, isEnabled: true, allowMasked: false, legalNote: 'Required for statutory TDS and payroll compliance.', sortOrder: 2 },
  { code: 'ID_PASSPORT', name: 'Passport', groupName: 'IDENTITY', isRequired: false, isEnabled: true, allowMasked: false, legalNote: 'Optional identity and travel verification document.', sortOrder: 3 },
  { code: 'ID_VOTER', name: 'Voter ID', groupName: 'IDENTITY', isRequired: false, isEnabled: true, allowMasked: false, legalNote: 'Optional alternative government photo ID.', sortOrder: 4 },
  { code: 'EDU_10TH', name: '10th Marksheet & Certificate', groupName: 'EDUCATION', isRequired: true, isEnabled: true, allowMasked: false, legalNote: 'Required for date of birth and foundational academic verification.', sortOrder: 10 },
  { code: 'EDU_12TH', name: '12th Marksheet & Certificate', groupName: 'EDUCATION', isRequired: true, isEnabled: true, allowMasked: false, legalNote: 'Required academic record.', sortOrder: 11 },
  { code: 'EDU_GRAD', name: 'Graduation Degree / Provisional Certificate', groupName: 'EDUCATION', isRequired: true, isEnabled: true, allowMasked: false, legalNote: 'Required highest qualifying degree proof.', sortOrder: 12 },
  { code: 'EDU_POSTGRAD', name: 'Post-Graduation Certificate', groupName: 'EDUCATION', isRequired: false, isEnabled: true, allowMasked: false, legalNote: 'Required if post-graduate qualification is declared.', sortOrder: 13 },
  { code: 'EDU_OTHER', name: 'Other Educational Certificates', groupName: 'EDUCATION', isRequired: false, isEnabled: true, allowMasked: false, legalNote: 'Optional certifications or diplomas.', sortOrder: 14 },
  { code: 'EMP_OFFER', name: 'Previous Company Offer Letter', groupName: 'EMPLOYMENT', isRequired: false, isEnabled: true, allowMasked: false, legalNote: 'Applicable for experienced candidates.', sortOrder: 20 },
  { code: 'EMP_EXPERIENCE', name: 'Experience Letter', groupName: 'EMPLOYMENT', isRequired: false, isEnabled: true, allowMasked: false, legalNote: 'Applicable for experienced candidates.', sortOrder: 21 },
  { code: 'EMP_RELIEVING', name: 'Relieving Letter', groupName: 'EMPLOYMENT', isRequired: false, isEnabled: true, allowMasked: false, legalNote: 'Required prior to final joining clearance for experienced hires.', sortOrder: 22 },
  { code: 'EMP_PAYSLIPS', name: 'Last 3 Months Salary Slips (Combined PDF)', groupName: 'EMPLOYMENT', isRequired: false, isEnabled: true, allowMasked: false, legalNote: 'Applicable for lateral hires.', sortOrder: 23 },
  { code: 'EMP_BANK_STMT', name: 'Bank Statement (Only if Salary Slips Unavailable)', groupName: 'EMPLOYMENT', isRequired: false, isEnabled: true, allowMasked: true, legalNote: 'Optional; redact non-salary personal transactions.', sortOrder: 24 },
  { code: 'BANK_CHEQUE', name: 'Cancelled Cheque', groupName: 'BANKING', isRequired: true, isEnabled: true, allowMasked: false, legalNote: 'Required for salary disbursement verification.', sortOrder: 30 },
  { code: 'BANK_PASSBOOK', name: 'Bank Passbook Front Page', groupName: 'BANKING', isRequired: false, isEnabled: true, allowMasked: false, legalNote: 'Alternative to cancelled cheque if cheque leaf is unavailable.', sortOrder: 31 },
  { code: 'OTHER_PHOTO', name: 'Passport-Size Photograph', groupName: 'OTHER', isRequired: true, isEnabled: true, allowMasked: false, legalNote: 'Recent colour photograph on light background.', sortOrder: 40 },
  { code: 'OTHER_RESUME', name: 'Updated Resume / CV', groupName: 'OTHER', isRequired: true, isEnabled: true, allowMasked: false, legalNote: 'Latest signed resume.', sortOrder: 41 },
  { code: 'OTHER_ADDRESS', name: 'Current Address Proof', groupName: 'OTHER', isRequired: true, isEnabled: true, allowMasked: false, legalNote: 'Utility bill, rent agreement, or passport/driving licence.', sortOrder: 42 },
] as const;

export const DEFAULT_SYSTEM_SETTINGS = [
  { key: 'enforce_2fa_all_internal', value: 'false', category: 'SECURITY', description: 'Require TOTP 2FA verification for all Super Admin, Admin, and Recruiter logins' },
  { key: 'max_failed_login_attempts', value: '5', category: 'SECURITY', description: 'Maximum consecutive failed logins before account lockout' },
  { key: 'lockout_duration_minutes', value: '15', category: 'SECURITY', description: 'Account lockout duration in minutes' },
  { key: 'session_ttl_hours', value: '24', category: 'SECURITY', description: 'Internal portal session expiry window in hours' },
  { key: 'onboarding_link_ttl_days', value: '7', category: 'ONBOARDING', description: 'Default validity period (days) for candidate onboarding tokens' },
  { key: 'data_retention_days', value: '1095', category: 'COMPLIANCE', description: 'Candidate and document retention period in days under DPDP Act policy' },
  { key: 'aadhaar_collection_mode', value: 'OPTIONAL_MASKED', category: 'COMPLIANCE', description: 'Aadhaar policy: OPTIONAL_MASKED | DISABLED' },
  { key: 'portal_base_url', value: 'https://portal.9hrindia.com', category: 'GENERAL', description: 'Canonical portal URL used in onboarding links and email notifications' },
] as const;
