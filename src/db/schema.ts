import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// 1. Roles & Permissions
export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(), // SUPER_ADMIN | ADMIN | RECRUITER
  displayName: text('display_name').notNull(),
  description: text('description').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  module: text('module').notNull(),
  description: text('description').notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: serial('id').primaryKey(),
    roleId: integer('role_id')
      .references(() => roles.id, { onDelete: 'cascade' })
      .notNull(),
    permissionId: integer('permission_id')
      .references(() => permissions.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (table) => [uniqueIndex('role_permission_unique_idx').on(table.roleId, table.permissionId)],
);

// 2. Users & Auth
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').notNull().unique(), // Firebase UID or local usr_<uuid>
    email: text('email').notNull().unique(),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash'),
    roleId: integer('role_id')
      .references(() => roles.id)
      .notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    failedLoginAttempts: integer('failed_login_attempts').default(0).notNull(),
    lockedUntil: timestamp('locked_until'),
    passwordResetTokenHash: text('password_reset_token_hash'),
    passwordResetExpiresAt: timestamp('password_reset_expires_at'),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('users_email_idx').on(table.email), index('users_role_idx').on(table.roleId)],
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    roleId: integer('role_id')
      .references(() => roles.id, { onDelete: 'cascade' })
      .notNull(),
    assignedBy: integer('assigned_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('user_role_unique_idx').on(table.userId, table.roleId)],
);

export const twoFactorSettings = pgTable('two_factor_settings', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  enabled: boolean('enabled').default(false).notNull(),
  secretEncrypted: text('secret_encrypted'),
  backupCodesHashJson: jsonb('backup_codes_hash_json').$type<string[]>().default([]).notNull(),
  emailOtpHash: text('email_otp_hash'),
  emailOtpExpiresAt: timestamp('email_otp_expires_at'),
  verifiedAt: timestamp('verified_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const loginSessions = pgTable(
  'login_sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    sessionTokenHash: text('session_token_hash').notNull().unique(),
    deviceInfo: text('device_info').notNull(),
    ipAddress: text('ip_address').notNull(),
    userAgent: text('user_agent').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    lastActiveAt: timestamp('last_active_at').defaultNow().notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
);

// 3. Recruiters & Jobs
export const recruiters = pgTable('recruiters', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  employeeCode: text('employee_code').notNull().unique(),
  department: text('department').default('Talent Acquisition').notNull(),
  specialization: text('specialization').default('Full-Cycle Hiring').notNull(),
  targetMonthlyHires: integer('target_monthly_hires').default(6).notNull(),
  canCreateRecruiters: boolean('can_create_recruiters').default(false).notNull(),
  canExportSensitive: boolean('can_export_sensitive').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const jobs = pgTable(
  'jobs',
  {
    id: serial('id').primaryKey(),
    jobCode: text('job_code').notNull().unique(),
    title: text('title').notNull(),
    department: text('department').notNull(),
    clientCompany: text('client_company').notNull(),
    location: text('location').notNull(),
    employmentType: text('employment_type').notNull(), // Full-Time | Contract | Hybrid
    experienceMin: integer('experience_min').default(0).notNull(),
    experienceMax: integer('experience_max').default(5).notNull(),
    salaryRange: text('salary_range').notNull(),
    vacancies: integer('vacancies').default(1).notNull(),
    requiredSkills: text('required_skills').notNull(),
    description: text('description').notNull(),
    closingDate: text('closing_date').notNull(),
    status: text('status').default('OPEN').notNull(), // OPEN | PAUSED | CLOSED | FILLED
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('jobs_status_idx').on(table.status)],
);

export const jobRecruiters = pgTable(
  'job_recruiters',
  {
    id: serial('id').primaryKey(),
    jobId: integer('job_id')
      .references(() => jobs.id, { onDelete: 'cascade' })
      .notNull(),
    recruiterId: integer('recruiter_id')
      .references(() => recruiters.id, { onDelete: 'cascade' })
      .notNull(),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('job_recruiter_unique_idx').on(table.jobId, table.recruiterId)],
);

// 4. Candidates & Recruitment Lifecycle
export const candidates = pgTable(
  'candidates',
  {
    id: serial('id').primaryKey(),
    candidateCode: text('candidate_code').notNull().unique(),
    fullName: text('full_name').notNull(),
    mobile: text('mobile').notNull(),
    email: text('email').notNull(),
    dob: text('dob'),
    gender: text('gender'),
    educationSummary: text('education_summary'),
    totalExperienceYears: text('total_experience_years').default('0').notNull(),
    currentCompany: text('current_company'),
    previousCompany: text('previous_company'),
    currentSalary: text('current_salary'),
    expectedSalary: text('expected_salary'),
    noticePeriodDays: integer('notice_period_days').default(30),
    skills: text('skills').notNull(),
    resumeFileId: integer('resume_file_id'),
    source: text('source').default('Direct').notNull(),
    currentStatus: text('current_status').default('NEW_CANDIDATE').notNull(),
    assignedRecruiterId: integer('assigned_recruiter_id').references(() => recruiters.id),
    jobId: integer('job_id').references(() => jobs.id),
    joiningDate: text('joining_date'),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('candidates_email_idx').on(table.email),
    index('candidates_status_idx').on(table.currentStatus),
    index('candidates_recruiter_idx').on(table.assignedRecruiterId),
  ],
);

export const candidateAddresses = pgTable('candidate_addresses', {
  id: serial('id').primaryKey(),
  candidateId: integer('candidate_id')
    .references(() => candidates.id, { onDelete: 'cascade' })
    .notNull(),
  addressType: text('address_type').notNull(), // CURRENT | PERMANENT
  line1: text('line1').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  pincode: text('pincode').notNull(),
  country: text('country').default('India').notNull(),
});

export const candidateEducation = pgTable('candidate_education', {
  id: serial('id').primaryKey(),
  candidateId: integer('candidate_id')
    .references(() => candidates.id, { onDelete: 'cascade' })
    .notNull(),
  level: text('level').notNull(),
  institution: text('institution').notNull(),
  boardOrUniversity: text('board_or_university').notNull(),
  yearOfPassing: text('year_of_passing').notNull(),
  percentageOrCgpa: text('percentage_or_cgpa').notNull(),
});

export const candidateEmployment = pgTable('candidate_employment', {
  id: serial('id').primaryKey(),
  candidateId: integer('candidate_id')
    .references(() => candidates.id, { onDelete: 'cascade' })
    .notNull(),
  companyName: text('company_name').notNull(),
  designation: text('designation').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  lastCtc: text('last_ctc'),
  reasonForLeaving: text('reason_for_leaving'),
});

export const candidateAssignments = pgTable('candidate_assignments', {
  id: serial('id').primaryKey(),
  candidateId: integer('candidate_id')
    .references(() => candidates.id, { onDelete: 'cascade' })
    .notNull(),
  recruiterId: integer('recruiter_id')
    .references(() => recruiters.id)
    .notNull(),
  assignedBy: integer('assigned_by').references(() => users.id),
  notes: text('notes'),
  assignedAt: timestamp('assigned_at').defaultNow().notNull(),
});

export const recruitmentStatusHistory = pgTable(
  'recruitment_status_history',
  {
    id: serial('id').primaryKey(),
    candidateId: integer('candidate_id')
      .references(() => candidates.id, { onDelete: 'cascade' })
      .notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    remarks: text('remarks'),
    changedBy: integer('changed_by').references(() => users.id),
    changedAt: timestamp('changed_at').defaultNow().notNull(),
  },
  (table) => [index('status_history_cand_idx').on(table.candidateId)],
);

export const interviews = pgTable(
  'interviews',
  {
    id: serial('id').primaryKey(),
    candidateId: integer('candidate_id')
      .references(() => candidates.id, { onDelete: 'cascade' })
      .notNull(),
    jobId: integer('job_id').references(() => jobs.id),
    roundName: text('round_name').notNull(),
    scheduledAt: timestamp('scheduled_at').notNull(),
    durationMinutes: integer('duration_minutes').default(45).notNull(),
    mode: text('mode').default('VIDEO').notNull(), // VIDEO | IN_PERSON | PHONE
    meetingLinkOrVenue: text('meeting_link_or_venue').notNull(),
    interviewerName: text('interviewer_name').notNull(),
    interviewerEmail: text('interviewer_email'),
    status: text('status').default('SCHEDULED').notNull(), // SCHEDULED | COMPLETED | CANCELLED | RESCHEDULED
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('interviews_cand_idx').on(table.candidateId)],
);

export const interviewFeedback = pgTable('interview_feedback', {
  id: serial('id').primaryKey(),
  interviewId: integer('interview_id')
    .references(() => interviews.id, { onDelete: 'cascade' })
    .notNull(),
  technicalRating: integer('technical_rating').notNull(),
  communicationRating: integer('communication_rating').notNull(),
  cultureRating: integer('culture_rating').notNull(),
  recommendation: text('recommendation').notNull(), // STRONG_HIRE | HIRE | HOLD | REJECT
  comments: text('comments').notNull(),
  submittedBy: integer('submitted_by').references(() => users.id),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
});

export const offers = pgTable('offers', {
  id: serial('id').primaryKey(),
  candidateId: integer('candidate_id')
    .references(() => candidates.id, { onDelete: 'cascade' })
    .notNull(),
  jobId: integer('job_id').references(() => jobs.id),
  offeredCtc: text('offered_ctc').notNull(),
  designation: text('designation').notNull(),
  joiningDate: text('joining_date').notNull(),
  offerStatus: text('offer_status').default('RELEASED').notNull(), // DRAFT | RELEASED | ACCEPTED | DECLINED | EXPIRED
  releasedAt: timestamp('released_at').defaultNow().notNull(),
  respondedAt: timestamp('responded_at'),
  remarks: text('remarks'),
  createdBy: integer('created_by').references(() => users.id),
});

// 5. Candidate Onboarding & Documents
export const onboardingLinks = pgTable(
  'onboarding_links',
  {
    id: serial('id').primaryKey(),
    candidateId: integer('candidate_id')
      .references(() => candidates.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    tokenPreview: text('token_preview').notNull(),
    createdBy: integer('created_by').references(() => users.id),
    expiresAt: timestamp('expires_at').notNull(),
    isRevoked: boolean('is_revoked').default(false).notNull(),
    status: text('status').default('GENERATED').notNull(),
    otpHash: text('otp_hash'),
    otpExpiresAt: timestamp('otp_expires_at'),
    otpVerifiedAt: timestamp('otp_verified_at'),
    sharedChannel: text('shared_channel'),
    sharedAt: timestamp('shared_at'),
    openedAt: timestamp('opened_at'),
    submittedAt: timestamp('submitted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('onboarding_cand_idx').on(table.candidateId)],
);

export const onboardingSubmissions = pgTable('onboarding_submissions', {
  id: serial('id').primaryKey(),
  onboardingLinkId: integer('onboarding_link_id')
    .references(() => onboardingLinks.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  candidateId: integer('candidate_id')
    .references(() => candidates.id, { onDelete: 'cascade' })
    .notNull(),
  personalInfoJson: jsonb('personal_info_json').$type<Record<string, unknown>>().default({}).notNull(),
  educationInfoJson: jsonb('education_info_json').$type<Record<string, unknown>[]>().default([]).notNull(),
  employmentInfoJson: jsonb('employment_info_json').$type<Record<string, unknown>[]>().default([]).notNull(),
  bankingInfoJson: jsonb('banking_info_json').$type<Record<string, unknown>>().default({}).notNull(),
  consentAccepted: boolean('consent_accepted').default(false).notNull(),
  consentTimestamp: timestamp('consent_timestamp'),
  consentIp: text('consent_ip'),
  dpdpNoticeVersion: text('dpdp_notice_version').default('DPDP-2023-v1.0').notNull(),
  draftStep: integer('draft_step').default(1).notNull(),
  reviewStatus: text('review_status').default('IN_PROGRESS').notNull(), // IN_PROGRESS | SUBMITTED | CHANGES_REQUESTED | APPROVED
  reviewedBy: integer('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  reviewRemarks: text('review_remarks'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const documentCategories = pgTable('document_categories', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  groupName: text('group_name').notNull(), // IDENTITY | EDUCATION | EMPLOYMENT | BANKING | OTHER
  isRequired: boolean('is_required').default(true).notNull(),
  isEnabled: boolean('is_enabled').default(true).notNull(),
  allowMasked: boolean('allow_masked').default(false).notNull(),
  legalNote: text('legal_note'),
  sortOrder: integer('sort_order').default(10).notNull(),
});

export const candidateDocuments = pgTable(
  'candidate_documents',
  {
    id: serial('id').primaryKey(),
    candidateId: integer('candidate_id')
      .references(() => candidates.id, { onDelete: 'cascade' })
      .notNull(),
    categoryId: integer('category_id')
      .references(() => documentCategories.id)
      .notNull(),
    documentName: text('document_name').notNull(),
    originalFileName: text('original_file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSizeBytes: integer('file_size_bytes').notNull(),
    encryptedStoragePath: text('encrypted_storage_path').notNull(),
    encryptionIv: text('encryption_iv').notNull(),
    encryptionTag: text('encryption_tag').notNull(),
    version: integer('version').default(1).notNull(),
    verificationStatus: text('verification_status').default('PENDING').notNull(), // PENDING | APPROVED | REJECTED | REUPLOAD_REQUESTED
    rejectionRemarks: text('rejection_remarks'),
    uploadedByRole: text('uploaded_by_role').default('CANDIDATE').notNull(),
    uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
    verifiedBy: integer('verified_by').references(() => users.id),
    verifiedAt: timestamp('verified_at'),
  },
  (table) => [index('docs_cand_idx').on(table.candidateId)],
);

export const documentVerificationLogs = pgTable('document_verification_logs', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id')
    .references(() => candidateDocuments.id, { onDelete: 'cascade' })
    .notNull(),
  action: text('action').notNull(), // UPLOADED | APPROVED | REJECTED | REUPLOAD_REQUESTED
  remarks: text('remarks'),
  actorUserId: integer('actor_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 6. Notifications, Audit Logs & System Settings
export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    eventType: text('event_type').notNull(),
    entityType: text('entity_type'),
    entityId: integer('entity_id'),
    isRead: boolean('is_read').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('notifications_user_idx').on(table.userId)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorUserId: integer('actor_user_id').references(() => users.id),
    actorEmail: text('actor_email').notNull(),
    actorRole: text('actor_role').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    detailsJson: jsonb('details_json').$type<Record<string, unknown>>().default({}).notNull(),
    ipAddress: text('ip_address').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('audit_created_idx').on(table.createdAt)],
);

export const systemSettings = pgTable('system_settings', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  updatedBy: integer('updated_by').references(() => users.id),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
