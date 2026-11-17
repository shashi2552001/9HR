import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  candidates,
  candidateAddresses,
  candidateAssignments,
  documentCategories,
  interviews,
  interviewFeedback,
  jobRecruiters,
  jobs,
  notifications,
  offers,
  onboardingLinks,
  permissions,
  recruiters,
  recruitmentStatusHistory,
  rolePermissions,
  roles,
  systemSettings,
  userRoles,
  users,
} from './schema.ts';
import {
  DEFAULT_DOCUMENT_CATEGORIES,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_SYSTEM_SETTINGS,
  PERMISSION_CATALOG,
} from '../server/constants.ts';
import { generateRandomToken, hashPassword, sha256 } from '../server/security.ts';

let coreSeeded = false;

export async function ensureCoreMetadata(): Promise<void> {
  if (coreSeeded) return;

  // 1. Roles
  const roleDefs = [
    {
      name: 'SUPER_ADMIN',
      displayName: 'Super Admin',
      description: 'Complete platform governance, user & RBAC control, security policies, and system configuration.',
    },
    {
      name: 'ADMIN',
      displayName: 'Admin (HR Operations)',
      description: 'Daily recruitment operations, job openings, recruiter oversight, document verification, and reporting.',
    },
    {
      name: 'RECRUITER',
      displayName: 'Recruiter',
      description: 'Assigned candidate pipeline management, interview scheduling, onboarding link generation, and tracking.',
    },
  ];

  const roleMap = new Map<string, number>();
  for (const r of roleDefs) {
    const [inserted] = await db
      .insert(roles)
      .values(r)
      .onConflictDoUpdate({
        target: roles.name,
        set: { displayName: r.displayName, description: r.description },
      })
      .returning();
    roleMap.set(r.name, inserted.id);
  }

  // 2. Permissions
  const permMap = new Map<string, number>();
  for (const p of PERMISSION_CATALOG) {
    const [inserted] = await db
      .insert(permissions)
      .values(p)
      .onConflictDoUpdate({
        target: permissions.code,
        set: { module: p.module, description: p.description },
      })
      .returning();
    permMap.set(p.code, inserted.id);
  }

  // 3. Role-Permissions mapping (only populate if empty for a role)
  for (const [roleName, permCodes] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const roleId = roleMap.get(roleName);
    if (!roleId) continue;
    const existing = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (existing.length === 0) {
      for (const code of permCodes) {
        const permId = permMap.get(code);
        if (permId) {
          await db.insert(rolePermissions).values({ roleId, permissionId: permId }).onConflictDoNothing();
        }
      }
    }
  }

  // 4. Document Categories
  for (const cat of DEFAULT_DOCUMENT_CATEGORIES) {
    await db
      .insert(documentCategories)
      .values(cat)
      .onConflictDoNothing({ target: documentCategories.code });
  }

  // 5. System Settings
  for (const setting of DEFAULT_SYSTEM_SETTINGS) {
    await db
      .insert(systemSettings)
      .values(setting)
      .onConflictDoNothing({ target: systemSettings.key });
  }

  coreSeeded = true;
}

export async function seedEnterpriseSampleData(createdByUserId: number, primaryRecruiterId?: number): Promise<void> {
  await ensureCoreMetadata();

  const existingJobs = await db.select({ id: jobs.id }).from(jobs).limit(1);
  if (existingJobs.length > 0) return;

  const jobSeeds = [
    {
      jobCode: '9HR-JOB-101',
      title: 'Senior Full-Stack Engineer (TypeScript & React)',
      department: 'Engineering',
      clientCompany: 'FinScale Technologies Pvt. Ltd.',
      location: 'Bengaluru, Karnataka',
      employmentType: 'Full-Time',
      experienceMin: 4,
      experienceMax: 8,
      salaryRange: '₹22 LPA – ₹32 LPA',
      vacancies: 4,
      requiredSkills: 'TypeScript, React, Node.js, PostgreSQL, AWS',
      description: 'Architect scalable fintech payment modules and lead code reviews for core banking web applications.',
      closingDate: '2026-12-30',
      status: 'OPEN',
      createdBy: createdByUserId,
    },
    {
      jobCode: '9HR-JOB-102',
      title: 'Enterprise SAP S/4HANA FICO Consultant',
      department: 'ERP Consulting',
      clientCompany: 'Bharat Industrial Systems Ltd.',
      location: 'Pune, Maharashtra',
      employmentType: 'Full-Time',
      experienceMin: 5,
      experienceMax: 10,
      salaryRange: '₹18 LPA – ₹26 LPA',
      vacancies: 2,
      requiredSkills: 'SAP FICO, S/4HANA, GST Compliance, Asset Accounting',
      description: 'Lead end-to-end SAP S/4HANA financial implementation and statutory compliance integration.',
      closingDate: '2026-12-20',
      status: 'OPEN',
      createdBy: createdByUserId,
    },
    {
      jobCode: '9HR-JOB-103',
      title: 'Cloud DevOps & Kubernetes Architect',
      department: 'Cloud Infrastructure',
      clientCompany: 'Aether Telecom India',
      location: 'Gurugram, Haryana',
      employmentType: 'Hybrid',
      experienceMin: 6,
      experienceMax: 11,
      salaryRange: '₹28 LPA – ₹40 LPA',
      vacancies: 2,
      requiredSkills: 'Kubernetes, Terraform, GCP, CI/CD, Prometheus',
      description: 'Design high-availability multi-region clusters and zero-trust deployment pipelines.',
      closingDate: '2027-01-15',
      status: 'OPEN',
      createdBy: createdByUserId,
    },
    {
      jobCode: '9HR-JOB-104',
      title: 'Human Resources Business Partner',
      department: 'People Operations',
      clientCompany: '9HR India Private Limited',
      location: 'Mumbai, Maharashtra',
      employmentType: 'Full-Time',
      experienceMin: 3,
      experienceMax: 6,
      salaryRange: '₹12 LPA – ₹16 LPA',
      vacancies: 1,
      requiredSkills: 'Employee Relations, Statutory Compliance, Performance Management, HRIS',
      description: 'Drive talent engagement, compliance governance, and regional HR business partnering.',
      closingDate: '2026-12-10',
      status: 'OPEN',
      createdBy: createdByUserId,
    },
  ];

  const insertedJobs = await db.insert(jobs).values(jobSeeds).returning();

  const allRecruiters = await db.select().from(recruiters);
  const recId = primaryRecruiterId || allRecruiters[0]?.id || null;

  if (recId) {
    for (const j of insertedJobs) {
      await db.insert(jobRecruiters).values({ jobId: j.id, recruiterId: recId }).onConflictDoNothing();
    }
  }

  const candidateSeeds = [
    {
      candidateCode: '9HR-2026-0001',
      fullName: 'Aarav Kulkarni',
      mobile: '+91 98201 44510',
      email: 'aarav.kulkarni@example.in',
      dob: '1994-06-14',
      gender: 'Male',
      educationSummary: 'B.Tech Computer Science, NIT Surathkal',
      totalExperienceYears: '6.5',
      currentCompany: 'Razorpay Software',
      previousCompany: 'Infosys Finacle',
      currentSalary: '₹21 LPA',
      expectedSalary: '₹28 LPA',
      noticePeriodDays: 30,
      skills: 'TypeScript, React, Node.js, PostgreSQL, Redis',
      source: 'LinkedIn',
      currentStatus: 'ONBOARDING_PENDING',
      assignedRecruiterId: recId,
      jobId: insertedJobs[0].id,
      joiningDate: '2026-12-01',
      createdBy: createdByUserId,
    },
    {
      candidateCode: '9HR-2026-0002',
      fullName: 'Priya Deshmukh',
      mobile: '+91 98450 22981',
      email: 'priya.deshmukh@example.in',
      dob: '1995-11-02',
      gender: 'Female',
      educationSummary: 'MBA Finance, Symbiosis Pune',
      totalExperienceYears: '5.2',
      currentCompany: 'Deloitte India',
      previousCompany: 'TCS Enterprise Solutions',
      currentSalary: '₹17 LPA',
      expectedSalary: '₹22.5 LPA',
      noticePeriodDays: 45,
      skills: 'SAP S/4HANA, FICO, GST, Cost Controlling',
      source: 'Naukri',
      currentStatus: 'INTERVIEW_SCHEDULED',
      assignedRecruiterId: recId,
      jobId: insertedJobs[1].id,
      joiningDate: null,
      createdBy: createdByUserId,
    },
    {
      candidateCode: '9HR-2026-0003',
      fullName: 'Rohan Malhotra',
      mobile: '+91 99102 77341',
      email: 'rohan.malhotra@example.in',
      dob: '1991-03-27',
      gender: 'Male',
      educationSummary: 'M.Tech Cloud Systems, IIIT Hyderabad',
      totalExperienceYears: '8.0',
      currentCompany: 'Jio Platforms',
      previousCompany: 'Wipro Cloud',
      currentSalary: '₹30 LPA',
      expectedSalary: '₹36 LPA',
      noticePeriodDays: 60,
      skills: 'Kubernetes, Terraform, GCP, Istio, Go',
      source: 'Employee Referral',
      currentStatus: 'OFFER_ACCEPTED',
      assignedRecruiterId: recId,
      jobId: insertedJobs[2].id,
      joiningDate: '2026-12-15',
      createdBy: createdByUserId,
    },
    {
      candidateCode: '9HR-2026-0004',
      fullName: 'Sneha Iyer',
      mobile: '+91 97400 88219',
      email: 'sneha.iyer@example.in',
      dob: '1996-08-19',
      gender: 'Female',
      educationSummary: 'PGDM HR, XLRI Jamshedpur',
      totalExperienceYears: '4.1',
      currentCompany: 'Zoho Corp',
      previousCompany: 'Freshworks',
      currentSalary: '₹11.5 LPA',
      expectedSalary: '₹14.5 LPA',
      noticePeriodDays: 30,
      skills: 'HRBP, Labour Law Compliance, POSH, HRIS',
      source: 'Direct Career Portal',
      currentStatus: 'SELECTED',
      assignedRecruiterId: recId,
      jobId: insertedJobs[3].id,
      joiningDate: '2026-12-08',
      createdBy: createdByUserId,
    },
    {
      candidateCode: '9HR-2026-0005',
      fullName: 'Vikramaditya Nair',
      mobile: '+91 98114 33902',
      email: 'vikram.nair@example.in',
      dob: '1997-01-09',
      gender: 'Male',
      educationSummary: 'B.E. Information Technology, Mumbai University',
      totalExperienceYears: '4.5',
      currentCompany: 'Mindtree',
      previousCompany: 'LTIMindtree',
      currentSalary: '₹16 LPA',
      expectedSalary: '₹23 LPA',
      noticePeriodDays: 30,
      skills: 'React, Next.js, TypeScript, GraphQL',
      source: 'LinkedIn',
      currentStatus: 'SHORTLISTED',
      assignedRecruiterId: recId,
      jobId: insertedJobs[0].id,
      joiningDate: null,
      createdBy: createdByUserId,
    },
    {
      candidateCode: '9HR-2026-0006',
      fullName: 'Ananya Chatterjee',
      mobile: '+91 98301 55670',
      email: 'ananya.chatterjee@example.in',
      dob: '1993-04-22',
      gender: 'Female',
      educationSummary: 'B.Tech ECE, Jadavpur University',
      totalExperienceYears: '7.0',
      currentCompany: 'Cognizant',
      previousCompany: 'Capgemini',
      currentSalary: '₹20 LPA',
      expectedSalary: '₹26 LPA',
      noticePeriodDays: 15,
      skills: 'TypeScript, AWS, Microservices, PostgreSQL',
      source: 'Naukri',
      currentStatus: 'JOINED',
      assignedRecruiterId: recId,
      jobId: insertedJobs[0].id,
      joiningDate: '2026-11-04',
      createdBy: createdByUserId,
    },
  ];

  const insertedCandidates = await db.insert(candidates).values(candidateSeeds).returning();

  for (const cand of insertedCandidates) {
    if (recId) {
      await db.insert(candidateAssignments).values({
        candidateId: cand.id,
        recruiterId: recId,
        assignedBy: createdByUserId,
        notes: 'Initial portfolio assignment',
      });
    }
    await db.insert(candidateAddresses).values({
      candidateId: cand.id,
      addressType: 'CURRENT',
      line1: 'Indiranagar 100 Feet Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560038',
      country: 'India',
    });
    await db.insert(recruitmentStatusHistory).values({
      candidateId: cand.id,
      fromStatus: 'NEW_CANDIDATE',
      toStatus: cand.currentStatus,
      remarks: 'Candidate progressed through enterprise recruitment workflow',
      changedBy: createdByUserId,
    });
  }

  // Interview for Priya Deshmukh
  const [priyaInterview] = await db
    .insert(interviews)
    .values({
      candidateId: insertedCandidates[1].id,
      jobId: insertedJobs[1].id,
      roundName: 'Technical Architecture & SAP S/4HANA Panel',
      scheduledAt: new Date(Date.now() + 86400 * 1000 * 2),
      durationMinutes: 60,
      mode: 'VIDEO',
      meetingLinkOrVenue: 'https://meet.9hrindia.com/panel-sap-2026',
      interviewerName: 'Rajeshwari Menon (Principal Consultant)',
      interviewerEmail: 'rajeshwari.menon@9hrindia.com',
      status: 'SCHEDULED',
      createdBy: createdByUserId,
    })
    .returning();

  // Completed interview + feedback for Sneha Iyer
  const [snehaInterview] = await db
    .insert(interviews)
    .values({
      candidateId: insertedCandidates[3].id,
      jobId: insertedJobs[3].id,
      roundName: 'Leadership & People Strategy Panel',
      scheduledAt: new Date(Date.now() - 86400 * 1000 * 3),
      durationMinutes: 45,
      mode: 'VIDEO',
      meetingLinkOrVenue: 'https://meet.9hrindia.com/hrbp-final',
      interviewerName: 'Siddharth Rao (VP People)',
      interviewerEmail: 'siddharth.rao@9hrindia.com',
      status: 'COMPLETED',
      createdBy: createdByUserId,
    })
    .returning();

  await db.insert(interviewFeedback).values({
    interviewId: snehaInterview.id,
    technicalRating: 5,
    communicationRating: 5,
    cultureRating: 5,
    recommendation: 'STRONG_HIRE',
    comments: 'Deep expertise in Indian labour compliance, DPDP policies, and scaling fast-growth engineering teams.',
    submittedBy: createdByUserId,
  });

  // Offer for Rohan Malhotra
  await db.insert(offers).values({
    candidateId: insertedCandidates[2].id,
    jobId: insertedJobs[2].id,
    offeredCtc: '₹35.5 LPA',
    designation: 'Lead Cloud & Kubernetes Architect',
    joiningDate: '2026-12-15',
    offerStatus: 'ACCEPTED',
    respondedAt: new Date(Date.now() - 86400 * 1000),
    remarks: 'Signed offer accepted; ready for pre-joining onboarding link.',
    createdBy: createdByUserId,
  });

  // Active onboarding link for Aarav Kulkarni
  const rawToken = generateRandomToken(24);
  await db.insert(onboardingLinks).values({
    candidateId: insertedCandidates[0].id,
    tokenHash: sha256(rawToken),
    tokenPreview: `${rawToken.slice(0, 8)}...${rawToken.slice(-6)}`,
    createdBy: createdByUserId,
    expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
    status: 'GENERATED',
  });

  // Welcome notification
  await db.insert(notifications).values({
    userId: createdByUserId,
    title: '9HR India Enterprise Portal Ready',
    message: `Workspace initialized with ${insertedJobs.length} active job openings and ${insertedCandidates.length} candidate profiles.`,
    eventType: 'SYSTEM_READY',
    entityType: 'SYSTEM',
  });

  void priyaInterview;
}

// CLI execution support (`npm run db:seed`)
const isDirectCli = process.argv[1]?.endsWith('seed.ts');
if (isDirectCli) {
  (async () => {
    try {
      await ensureCoreMetadata();
      const existing = await db.select({ id: users.id }).from(users).limit(1);
      if (existing.length === 0) {
        const superEmail = (process.env.INITIAL_SUPERADMIN_EMAIL || 'superadmin@9hrindia.com').toLowerCase();
        const superPass = process.env.INITIAL_SUPERADMIN_PASSWORD || generateRandomToken(10);
        const adminPass = process.env.SEED_ADMIN_PASSWORD || generateRandomToken(10);
        const recPass = process.env.SEED_RECRUITER_PASSWORD || generateRandomToken(10);

        const allRoles = await db.select().from(roles);
        const roleByName = new Map(allRoles.map((r) => [r.name, r.id]));

        const [superUser] = await db
          .insert(users)
          .values({
            uid: `usr_${generateRandomToken(12)}`,
            email: superEmail,
            fullName: 'Vikram Singhania (Super Admin)',
            phone: '+91 98200 10001',
            passwordHash: await hashPassword(superPass),
            roleId: roleByName.get('SUPER_ADMIN')!,
            isActive: true,
          })
          .returning();

        const [adminUser] = await db
          .insert(users)
          .values({
            uid: `usr_${generateRandomToken(12)}`,
            email: 'admin@9hrindia.com',
            fullName: 'Meera Krishnan (HR Admin)',
            phone: '+91 98200 10002',
            passwordHash: await hashPassword(adminPass),
            roleId: roleByName.get('ADMIN')!,
            isActive: true,
          })
          .returning();

        const [recUser] = await db
          .insert(users)
          .values({
            uid: `usr_${generateRandomToken(12)}`,
            email: 'recruiter@9hrindia.com',
            fullName: 'Arjun Mehta (Lead Recruiter)',
            phone: '+91 98200 10003',
            passwordHash: await hashPassword(recPass),
            roleId: roleByName.get('RECRUITER')!,
            isActive: true,
          })
          .returning();

        await db.insert(userRoles).values([
          { userId: superUser.id, roleId: roleByName.get('SUPER_ADMIN')!, assignedBy: superUser.id },
          { userId: adminUser.id, roleId: roleByName.get('ADMIN')!, assignedBy: superUser.id },
          { userId: recUser.id, roleId: roleByName.get('RECRUITER')!, assignedBy: superUser.id },
        ]);

        const [recProfile] = await db
          .insert(recruiters)
          .values({
            userId: recUser.id,
            employeeCode: '9HR-REC-001',
            department: 'Technology & Leadership Hiring',
            specialization: 'Engineering & Cloud',
            targetMonthlyHires: 8,
          })
          .returning();

        await seedEnterpriseSampleData(superUser.id, recProfile.id);

        console.log('9HR India database seeded successfully.');
        if (!process.env.INITIAL_SUPERADMIN_PASSWORD) {
          console.log(`Generated initial Super Admin (${superEmail}) password: ${superPass}`);
          console.log(`Generated Admin (admin@9hrindia.com) password: ${adminPass}`);
          console.log(`Generated Recruiter (recruiter@9hrindia.com) password: ${recPass}`);
        }
      } else {
        console.log('Core metadata ensured; users already present.');
      }
      process.exit(0);
    } catch (error) {
      console.error('Seed failed:', error);
      process.exit(1);
    }
  })();
}
