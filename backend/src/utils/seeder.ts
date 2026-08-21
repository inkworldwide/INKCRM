import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { encrypt } from './encryption';

// Import models
import Organization from '../models/Organization';
import Role from '../models/Role';
import User from '../models/User';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import DashboardLayout from '../models/DashboardLayout';
import Workflow from '../models/Workflow';
import Status from '../models/Status';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/inkcrm';

async function seed() {
  if (mongoose.connection.readyState === 0) {
    console.log('Connecting to database:', MONGODB_URI);
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB.');
  } else {
    console.log('Using existing Mongoose database connection.');
  }

  // Clear Database
  console.log('Clearing old collections...');
  await Organization.deleteMany({});
  await Role.deleteMany({});
  await User.deleteMany({});
  await ModuleDefinition.deleteMany({});
  await CustomRecord.deleteMany({});
  await DashboardLayout.deleteMany({});
  await Workflow.deleteMany({});
  await Status.deleteMany({});
  console.log('Database cleared.');

  // 1. Create Organizations
  console.log('Seeding Organizations...');
  const salesOrg = await Organization.create({
    name: 'inkSales Enterprises',
    subdomain: 'sales',
    logoUrl: '/logo.png',
    faviconUrl: '/favicon.ico',
    themeSettings: {
      primaryColor: '79 70 229', // Indigo
      sidebarBg: '#0f172a',
      headerBg: '#ffffff',
      fontFamily: 'Inter',
      mode: 'dark'
    },
    enabledModules: ['dashboard', 'leads', 'campaigns', 'deals', 'companies', 'tasks', 'settings', 'reports', 'workflows'],
    subscription: { plan: 'enterprise', status: 'active', expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) }
  });

  const schoolOrg = await Organization.create({
    name: 'Acme International School',
    subdomain: 'school',
    logoUrl: '/logo.png',
    faviconUrl: '/favicon.ico',
    themeSettings: {
      primaryColor: '16 185 129', // Emerald
      sidebarBg: '#064e3b',
      headerBg: '#f0fdf4',
      fontFamily: 'Outfit',
      mode: 'light'
    },
    enabledModules: ['dashboard', 'leads', 'campaigns', 'students', 'courses', 'tasks', 'settings', 'reports'],
    subscription: { plan: 'growth', status: 'active', expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000) }
  });

  const hospitalOrg = await Organization.create({
    name: 'Metro Care Hospital',
    subdomain: 'hospital',
    logoUrl: '/logo.png',
    faviconUrl: '/favicon.ico',
    themeSettings: {
      primaryColor: '13 148 136', // Teal
      sidebarBg: '#115e59',
      headerBg: '#f0fdfa',
      fontFamily: 'Roboto',
      mode: 'light'
    },
    enabledModules: ['dashboard', 'leads', 'campaigns', 'patients', 'appointments', 'tasks', 'settings', 'reports'],
    subscription: { plan: 'enterprise', status: 'active', expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) }
  });

  console.log('Organizations seeded.');

  // 2. Setup Roles & Permissions Helper
  const createPermissions = (moduleNames: string[]) => {
    return {
      modules: moduleNames.map((name) => ({
        moduleName: name,
        create: true,
        read: 'all' as const,
        update: 'all' as const,
        delete: 'all' as const
      })),
      fields: [],
      menus: ['dashboard', ...moduleNames, 'workflows', 'reports', 'settings']
    };
  };

  console.log('Seeding Roles...');
  // Sales Roles
  const salesAdminRole = await Role.create({
    organizationId: salesOrg._id,
    name: 'Super Admin',
    description: 'Full organizational access',
    isSystem: true,
    permissions: createPermissions(['leads', 'deals', 'companies'])
  });

  const partnerRole = await Role.create({
    organizationId: salesOrg._id,
    name: 'PARTNER',
    description: 'Partner role with standard access',
    isSystem: false,
    permissions: createPermissions(['leads', 'deals', 'companies'])
  });

  const ariaManagerRole = await Role.create({
    organizationId: salesOrg._id,
    name: 'ARIA SALES MANAGER',
    description: 'Area Sales Manager role',
    isSystem: false,
    permissions: createPermissions(['leads', 'deals', 'companies'])
  });

  const adminRole = await Role.create({
    organizationId: salesOrg._id,
    name: 'ADMIN',
    description: 'Admin role',
    isSystem: false,
    permissions: createPermissions(['leads', 'deals', 'companies'])
  });

  const teliCallerRole = await Role.create({
    organizationId: salesOrg._id,
    name: 'TELI CALLER',
    description: 'Telecaller calling team role',
    isSystem: false,
    permissions: createPermissions(['leads', 'deals', 'companies'])
  });

  // School Roles
  const schoolAdminRole = await Role.create({
    organizationId: schoolOrg._id,
    name: 'Super Admin',
    description: 'School Administrator',
    isSystem: true,
    permissions: createPermissions(['students', 'courses'])
  });

  const teacherRole = await Role.create({
    organizationId: schoolOrg._id,
    name: 'Teacher',
    description: 'Faculty members',
    isSystem: false,
    permissions: createPermissions(['students', 'courses'])
  });

  // Hospital Roles
  const hospitalAdminRole = await Role.create({
    organizationId: hospitalOrg._id,
    name: 'Super Admin',
    description: 'Hospital Administrator',
    isSystem: true,
    permissions: createPermissions(['patients', 'appointments'])
  });

  console.log('Roles seeded.');

  // 3. Create Users
  console.log('Seeding Admin Users...');
  const passwordHash = await bcrypt.hash('password', 10);

  const mockEmbedding = Array(128).fill(0.1);
  const encryptedEmbedding = encrypt(JSON.stringify(mockEmbedding));

  const salesAdmin = await User.create({
    organizationId: salesOrg._id,
    roleId: salesAdminRole._id,
    firstName: 'Ink',
    lastName: 'CRM',
    email: 'ink@crm.com',
    passwordHash,
    isVerified: true,
    department: 'Management',
    skipFace: true,
    skipLocation: true,
    twoFactor: { enabled: false },
    faceRecognition: {
      enabled: true,
      encryptedEmbedding,
      enrolledAt: new Date()
    }
  });

  // Create Rajabaksh Ilyala (Super Admin, Reporting Manager: Ink CRM)
  const rajabakshaUser = await User.create({
    organizationId: salesOrg._id,
    roleId: salesAdminRole._id,
    firstName: 'Rajabaksh',
    lastName: 'Ilyala',
    email: 'ink@rajabaksha.com',
    passwordHash,
    isVerified: true,
    userCode: 'AGE-RAJA',
    department: 'SALES MANAGER',
    reportingManager: salesAdmin._id,
    skipFace: true,
    skipLocation: true,
    isActive: true
  });

  // Create Ink Naushad (Reporting Manager: Rajabaksh Ilyala)
  const naushadUser = await User.create({
    organizationId: salesOrg._id,
    roleId: adminRole._id,
    firstName: 'Ink',
    lastName: 'Naushad',
    email: 'ink@naushad.com',
    passwordHash,
    isVerified: true,
    userCode: 'AGE-NAUSHAD',
    department: 'SALES MANAGER',
    reportingManager: rajabakshaUser._id,
    skipFace: true,
    skipLocation: true,
    isActive: true
  });

  // Create Ink Sharfu (Reporting Manager: Ink Naushad)
  const sharfuUser = await User.create({
    organizationId: salesOrg._id,
    roleId: adminRole._id,
    firstName: 'Ink',
    lastName: 'Sharfu',
    email: 'ink@sharfu',
    passwordHash,
    isVerified: true,
    userCode: 'AGE-SHARFU',
    department: 'SALES MANAGER',
    reportingManager: naushadUser._id,
    skipFace: true,
    skipLocation: true,
    isActive: true
  });

  // Create Mohammed Hashmat (Reporting Manager: Ink Sharfu)
  await User.create({
    organizationId: salesOrg._id,
    roleId: adminRole._id,
    firstName: 'Mohammed',
    lastName: 'Hashmat',
    email: 'ink@hashmat',
    passwordHash,
    isVerified: true,
    userCode: 'AGE-HASHMAT',
    department: 'SALES MANAGER',
    reportingManager: sharfuUser._id,
    skipFace: true,
    skipLocation: true,
    isActive: true
  });

  // Seed sample Sales Agents reporting to Ink CRM
  await User.create({
    organizationId: salesOrg._id,
    roleId: teliCallerRole._id,
    firstName: 'Suma',
    lastName: 'Dhar',
    email: 'agent.suma@gmail.com',
    passwordHash,
    isVerified: true,
    userCode: 'AGE-SUMA',
    department: 'Telemarketing',
    reportingManager: salesAdmin._id,
    skipFace: true,
    skipLocation: true,
    isActive: true
  });

  await User.create({
    organizationId: salesOrg._id,
    roleId: teliCallerRole._id,
    firstName: 'Priya',
    lastName: 'Sharma',
    email: 'agent.priya@gmail.com',
    passwordHash,
    isVerified: true,
    userCode: 'AGE-PRIYA',
    department: 'Telemarketing',
    reportingManager: salesAdmin._id,
    skipFace: true,
    skipLocation: true,
    isActive: true
  });

  await User.create({
    organizationId: salesOrg._id,
    roleId: ariaManagerRole._id,
    firstName: 'Sunita',
    lastName: 'Devi',
    email: 'agent.sunita@gmail.com',
    passwordHash,
    isVerified: true,
    userCode: 'AGE-SUNITA',
    department: 'AREA SALES MANAGER',
    reportingManager: salesAdmin._id,
    skipFace: true,
    skipLocation: true,
    isActive: true
  });

  await User.create({
    organizationId: salesOrg._id,
    roleId: partnerRole._id,
    firstName: 'Ankit',
    lastName: 'Verma',
    email: 'agent.ankit@gmail.com',
    passwordHash,
    isVerified: true,
    userCode: 'AGE-ANKIT',
    department: 'PARTNER',
    reportingManager: salesAdmin._id,
    skipFace: true,
    skipLocation: true,
    isActive: true
  });

  const schoolAdmin = await User.create({
    organizationId: schoolOrg._id,
    roleId: schoolAdminRole._id,
    firstName: 'Albus',
    lastName: 'Dumbledore',
    email: 'admin@school.com',
    passwordHash,
    isVerified: true,
    twoFactor: { enabled: false }
  });

  // Seed standard Teachers matching user screenshot
  await User.create({
    organizationId: schoolOrg._id,
    roleId: teacherRole._id,
    firstName: 'Teacher',
    lastName: 'Suma',
    email: 'suma@gmail.com',
    passwordHash,
    isVerified: true,
    userCode: 'TCH-SUMA',
    skipFace: true,
    skipLocation: true,
    isActive: true
  });

  await User.create({
    organizationId: schoolOrg._id,
    roleId: teacherRole._id,
    firstName: 'Priya',
    lastName: 'Sharma',
    email: 'priya@gmail.com',
    passwordHash,
    isVerified: true,
    userCode: 'TCH-PRIYA',
    skipFace: true,
    skipLocation: true,
    isActive: true
  });

  await User.create({
    organizationId: schoolOrg._id,
    roleId: teacherRole._id,
    firstName: 'Sunita',
    lastName: 'Devi',
    email: 'sunita@gmail.com',
    passwordHash,
    isVerified: true,
    userCode: 'TCH-SUNITA',
    skipFace: true,
    skipLocation: true,
    isActive: true
  });

  await User.create({
    organizationId: schoolOrg._id,
    roleId: teacherRole._id,
    firstName: 'Ankit',
    lastName: 'Verma',
    email: 'ankit@gmail.com',
    passwordHash,
    isVerified: true,
    userCode: 'TCH-ANKIT',
    skipFace: true,
    skipLocation: true,
    isActive: true
  });

  const hospitalAdmin = await User.create({
    organizationId: hospitalOrg._id,
    roleId: hospitalAdminRole._id,
    firstName: 'Gregory',
    lastName: 'House',
    email: 'admin@hospital.com',
    passwordHash,
    isVerified: true,
    twoFactor: { enabled: false }
  });

  console.log('Admin Users seeded.');

  // 4. Create Module Definitions
  console.log('Seeding Module Definitions...');

  // --- Sales Modules ---
  const leadModule = await ModuleDefinition.create({
    organizationId: salesOrg._id,
    name: 'Lead',
    singularLabel: 'Lead',
    pluralLabel: 'Leads',
    apiPath: 'leads',
    icon: 'UserPlus',
    isSystem: true,
    fields: [
      // Loan Details
      {
        name: 'source',
        label: 'Source',
        type: 'dropdown',
        required: false,
        unique: false,
        options: ['Website', 'Referral', 'Cold Call', 'Social Media', 'Rajabaksh Ilyala']
      },
      {
        name: 'loanType',
        label: 'Loan Type',
        type: 'dropdown',
        required: true,
        unique: false,
        defaultValue: 'SALARIED PERSONAL LOAN',
        options: ['SALARIED PERSONAL LOAN', 'BUSINESS LOAN', 'HOME LOAN', 'LAP']
      },
      { name: 'budget', label: 'Loan Amount', type: 'currency', required: false, unique: false },
      { name: 'dataCode', label: 'Data Code', type: 'text', required: false, unique: false },
      {
        name: 'businessPartner',
        label: 'Business Partners',
        type: 'dropdown',
        required: false,
        unique: false,
        options: ['AXIS BANK', 'HDFC BANK', 'ICICI BANK', 'SBI']
      },
      { name: 'psm', label: 'PSM', type: 'text', required: false, unique: false },
      {
        name: 'status',
        label: 'Current Status',
        type: 'dropdown',
        required: true,
        unique: false,
        defaultValue: 'New',
        options: ['New', 'Hot', 'Warm', 'Cedil Pending', 'Document Pending', 'Approval Pending', 'Approved', 'Disbursed', 'Rejected', 'Followup', 'Dropped', 'Pending']
      },
      { name: 'caseDetails', label: 'Case Details', type: 'text', required: false, unique: false },
      {
        name: 'assignToTeam',
        label: 'Assign To Team',
        type: 'dropdown',
        required: false,
        unique: false,
        options: ['Select One', 'Team A', 'Team B']
      },
      { name: 'assignedTo', label: 'Assign To Agent', type: 'text', required: false, unique: false },
      { name: 'followUpDate', label: 'Follow-up Date', type: 'date', required: false, unique: false },
      { name: 'notes', label: 'Remarks', type: 'rich-text', required: false, unique: false },
      
      // Personal Details
      { name: 'firstName', label: 'First Name', type: 'text', required: true, unique: false },
      { name: 'lastName', label: 'Last Name', type: 'text', required: true, unique: false },
      { name: 'company', label: 'Company Name', type: 'text', required: false, unique: false },
      { name: 'salary', label: 'Salary', type: 'number', required: false, unique: false },
      { name: 'phone', label: 'Mobile', type: 'phone', required: false, unique: false },
      { name: 'email', label: 'E-Mail', type: 'email', required: true, unique: false },
      { name: 'presentAddress', label: 'Present Address', type: 'rich-text', required: false, unique: false },
      { name: 'city', label: 'City', type: 'text', required: false, unique: false },
      { name: 'pinCode', label: 'PinCode', type: 'text', required: false, unique: false },
      {
        name: 'state',
        label: 'State',
        type: 'dropdown',
        required: false,
        unique: false,
        options: ['KARNATAKA', 'MAHARASHTRA', 'DELHI', 'TAMIL NADU']
      },
      {
        name: 'country',
        label: 'Country',
        type: 'dropdown',
        required: false,
        unique: false,
        defaultValue: 'INDIA',
        options: ['INDIA']
      },
      { name: 'leadScore', label: 'Lead Score', type: 'number', required: false, unique: false, defaultValue: '50' }
    ],
    relationships: [{ targetModule: 'Company', type: 'many-to-one', fieldName: 'companyId' }]
  });

  const dealModule = await ModuleDefinition.create({
    organizationId: salesOrg._id,
    name: 'Deal',
    singularLabel: 'Deal',
    pluralLabel: 'Deals',
    apiPath: 'deals',
    icon: 'TrendingUp',
    isSystem: true,
    fields: [
      { name: 'dealName', label: 'Deal Name', type: 'text', required: true, unique: false },
      { name: 'amount', label: 'Deal Amount', type: 'currency', required: true, unique: false },
      {
        name: 'stage',
        label: 'Stage',
        type: 'dropdown',
        required: true,
        unique: false,
        defaultValue: 'Prospecting',
        options: ['Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost']
      },
      { name: 'closeDate', label: 'Expected Close Date', type: 'date', required: true, unique: false },
      { name: 'probability', label: 'Win Probability (%)', type: 'number', required: false, unique: false }
    ],
    relationships: [{ targetModule: 'Company', type: 'many-to-one', fieldName: 'companyId' }]
  });

  const companyModule = await ModuleDefinition.create({
    organizationId: salesOrg._id,
    name: 'Company',
    singularLabel: 'Company',
    pluralLabel: 'Companies',
    apiPath: 'companies',
    icon: 'Briefcase',
    isSystem: true,
    fields: [
      { name: 'companyName', label: 'Company Name', type: 'text', required: true, unique: true },
      { name: 'website', label: 'Website', type: 'url', required: false, unique: false },
      { name: 'employees', label: 'Employee Count', type: 'number', required: false, unique: false },
      {
        name: 'industry',
        label: 'Industry',
        type: 'dropdown',
        required: false,
        unique: false,
        options: ['Software', 'Finance', 'Manufacturing', 'Retail', 'Healthcare']
      }
    ],
    relationships: []
  });

  const campaignModule = await ModuleDefinition.create({
    organizationId: salesOrg._id,
    name: 'Campaign',
    singularLabel: 'Campaign',
    pluralLabel: 'Campaigns',
    apiPath: 'campaigns',
    icon: 'Target',
    isSystem: true,
    fields: [
      { name: 'campaignName', label: 'Campaign Name', type: 'text', required: true, unique: true },
      {
        name: 'status',
        label: 'Status',
        type: 'dropdown',
        required: true,
        unique: false,
        defaultValue: 'Planned',
        options: ['Planned', 'Active', 'Completed', 'Cancelled']
      },
      {
        name: 'type',
        label: 'Type',
        type: 'dropdown',
        required: true,
        unique: false,
        defaultValue: 'Email',
        options: ['Email', 'Social Media', 'Cold Call', 'Webinar', 'Event']
      },
      { name: 'budget', label: 'Budget', type: 'currency', required: false, unique: false },
      { name: 'startDate', label: 'Start Date', type: 'date', required: false, unique: false },
      { name: 'endDate', label: 'End Date', type: 'date', required: false, unique: false },
      { name: 'notes', label: 'Notes', type: 'rich-text', required: false, unique: false }
    ],
    relationships: []
  });

  const campaignAssignmentModule = await ModuleDefinition.create({
    organizationId: salesOrg._id,
    name: 'CampaignAssignment',
    singularLabel: 'Campaign Assignment',
    pluralLabel: 'Campaign Assignments',
    apiPath: 'campaignassignments',
    icon: 'UserCheck',
    isSystem: true,
    fields: [
      { name: 'assignmentName', label: 'Assignment Title', type: 'text', required: true, unique: false },
      {
        name: 'campaign',
        label: 'Campaign',
        type: 'dropdown',
        required: true,
        unique: false,
        options: ['Summer Promo 2026', 'Q3 Cold Call Drive', 'Enterprise API Webinar']
      },
      {
        name: 'lead',
        label: 'Assigned Lead',
        type: 'dropdown',
        required: true,
        unique: false,
        options: ['Sarah Malone', 'Michael Chen', 'Emma Watson']
      },
      { name: 'assignedDate', label: 'Assigned Date', type: 'date', required: true, unique: false }
    ],
    relationships: []
  });

  // --- Settings Custom Modules for Sales ---
  const departmentModule = await ModuleDefinition.create({
    organizationId: salesOrg._id,
    name: 'Department',
    singularLabel: 'Department',
    pluralLabel: 'Departments',
    apiPath: 'departments',
    icon: 'Network',
    isSystem: true,
    fields: [
      { name: 'name', label: 'Department Name', type: 'text', required: true, unique: true },
      { name: 'code', label: 'Department Code', type: 'text', required: true, unique: true }
    ],
    relationships: []
  });

  const productModule = await ModuleDefinition.create({
    organizationId: salesOrg._id,
    name: 'Product',
    singularLabel: 'Product',
    pluralLabel: 'Products',
    apiPath: 'products',
    icon: 'Package',
    isSystem: true,
    fields: [
      { name: 'code', label: 'Product Code', type: 'text', required: true, unique: true },
      { name: 'name', label: 'Product Name', type: 'text', required: true, unique: true }
    ],
    relationships: []
  });

  const bankMasterModule = await ModuleDefinition.create({
    organizationId: salesOrg._id,
    name: 'BankMaster',
    singularLabel: 'Bank Master',
    pluralLabel: 'Bank Masters',
    apiPath: 'bankmasters',
    icon: 'Landmark',
    isSystem: true,
    fields: [
      { name: 'bankName', label: 'Bank Name', type: 'text', required: true, unique: true },
      { name: 'code', label: 'Bank Code', type: 'text', required: true, unique: true }
    ],
    relationships: []
  });

  const bankingPartnerModule = await ModuleDefinition.create({
    organizationId: salesOrg._id,
    name: 'BankingPartner',
    singularLabel: 'Banking Partner',
    pluralLabel: 'Banking Partners',
    apiPath: 'bankingpartners',
    icon: 'Briefcase',
    isSystem: true,
    fields: [
      { name: 'bank', label: 'Bank Name', type: 'text', required: true, unique: false },
      { name: 'loanType', label: 'Loan Type', type: 'text', required: true, unique: false },
      { name: 'psm', label: 'PSM', type: 'text', required: true, unique: false }
    ],
    relationships: []
  });

  // --- School Modules ---
  const studentModule = await ModuleDefinition.create({
    organizationId: schoolOrg._id,
    name: 'Student',
    singularLabel: 'Student',
    pluralLabel: 'Students',
    apiPath: 'students',
    icon: 'GraduationCap',
    isSystem: true,
    fields: [
      { name: 'studentId', label: 'Enrollment Number', type: 'text', required: true, unique: true },
      { name: 'fullName', label: 'Full Name', type: 'text', required: true, unique: false },
      { name: 'email', label: 'Student Email', type: 'email', required: true, unique: true },
      { name: 'dob', label: 'Date of Birth', type: 'date', required: true, unique: false },
      {
        name: 'gradeLevel',
        label: 'Grade Level',
        type: 'dropdown',
        required: true,
        unique: false,
        options: ['Freshman', 'Sophomore', 'Junior', 'Senior']
      },
      { name: 'gpa', label: 'GPA', type: 'number', required: false, unique: false, defaultValue: '4.0' }
    ],
    relationships: []
  });

  const courseModule = await ModuleDefinition.create({
    organizationId: schoolOrg._id,
    name: 'Course',
    singularLabel: 'Course',
    pluralLabel: 'Courses',
    apiPath: 'courses',
    icon: 'BookOpen',
    isSystem: true,
    fields: [
      { name: 'courseCode', label: 'Course Code', type: 'text', required: true, unique: true },
      { name: 'courseName', label: 'Course Name', type: 'text', required: true, unique: false },
      { name: 'credits', label: 'Credits', type: 'number', required: true, unique: false, defaultValue: '3' },
      { name: 'department', label: 'Department', type: 'text', required: false, unique: false }
    ],
    relationships: []
  });

  // --- Hospital Modules ---
  const patientModule = await ModuleDefinition.create({
    organizationId: hospitalOrg._id,
    name: 'Patient',
    singularLabel: 'Patient',
    pluralLabel: 'Patients',
    apiPath: 'patients',
    icon: 'Heart',
    isSystem: true,
    fields: [
      { name: 'mrn', label: 'Medical Record Number', type: 'text', required: true, unique: true },
      { name: 'fullName', label: 'Patient Name', type: 'text', required: true, unique: false },
      { name: 'dob', label: 'Date of Birth', type: 'date', required: true, unique: false },
      {
        name: 'bloodGroup',
        label: 'Blood Type',
        type: 'dropdown',
        required: false,
        unique: false,
        options: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']
      },
      { name: 'allergies', label: 'Allergies', type: 'text', required: false, unique: false },
      { name: 'emergencyPhone', label: 'Emergency Contact', type: 'phone', required: true, unique: false }
    ],
    relationships: []
  });

  const appointmentModule = await ModuleDefinition.create({
    organizationId: hospitalOrg._id,
    name: 'Appointment',
    singularLabel: 'Appointment',
    pluralLabel: 'Appointments',
    apiPath: 'appointments',
    icon: 'Calendar',
    isSystem: true,
    fields: [
      { name: 'appointmentDate', label: 'Appointment Date', type: 'date', required: true, unique: false },
      { name: 'doctorName', label: 'Doctor', type: 'text', required: true, unique: false },
      {
        name: 'status',
        label: 'Status',
        type: 'dropdown',
        required: true,
        unique: false,
        defaultValue: 'Scheduled',
        options: ['Scheduled', 'Completed', 'Cancelled']
      },
      { name: 'reason', label: 'Reason for Visit', type: 'rich-text', required: false, unique: false }
    ],
    relationships: [{ targetModule: 'Patient', type: 'many-to-one', fieldName: 'patientId' }]
  });

  console.log('Module Definitions seeded.');

  // 5. Create Custom Records
  console.log('Seeding Custom Records...');

  // --- Sales Records ---
  const stripeCompany = await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: companyModule._id,
    data: {
      companyName: 'Stripe Inc',
      website: 'https://stripe.com',
      employees: 8000,
      industry: 'Finance'
    },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });

  const appleCompany = await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: companyModule._id,
    data: {
      companyName: 'Apple Inc',
      website: 'https://apple.com',
      employees: 150000,
      industry: 'Software'
    },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });

  const teslaCompany = await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: companyModule._id,
    data: {
      companyName: 'Tesla Motors',
      website: 'https://tesla.com',
      employees: 90000,
      industry: 'Manufacturing'
    },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });

  const netflixCompany = await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: companyModule._id,
    data: {
      companyName: 'Netflix Inc',
      website: 'https://netflix.com',
      employees: 12000,
      industry: 'Retail'
    },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });

  // Seed dynamic Statuses for Sales Organization
  console.log('Seeding Statuses...');
  const defaultStatuses = [
    { name: 'New', color: '#64748b', icon: 'Circle', pipelinePosition: 1, order: 1 },
    { name: 'Hot', color: '#ef4444', icon: 'Flame', pipelinePosition: 2, order: 2 },
    { name: 'Warm', color: '#f59e0b', icon: 'Sun', pipelinePosition: 3, order: 3 },
    { name: 'Not Reachable', color: '#94a3b8', icon: 'PhoneMissed', pipelinePosition: 4, order: 4 },
    { name: 'Cedil Pending', color: '#ec4899', icon: 'FileWarning', pipelinePosition: 5, order: 5 },
    { name: 'Document Pending', color: '#14b8a6', icon: 'FileText', pipelinePosition: 6, order: 6 },
    { name: 'Approval Pending', color: '#f97316', icon: 'Clock', pipelinePosition: 7, order: 7 },
    { name: 'Approved', color: '#eab308', icon: 'CheckCircle', pipelinePosition: 8, order: 8 },
    { name: 'Disbursed', color: '#10b981', icon: 'Banknote', pipelinePosition: 9, order: 9, isFinal: true, isSuccess: true },
    { name: 'Rejected', color: '#ef4444', icon: 'XOctagon', pipelinePosition: 10, order: 10, isFinal: true, isSuccess: false },
    { name: 'Followup', color: '#3b82f6', icon: 'PhoneCall', pipelinePosition: 11, order: 11 },
    { name: 'Dropped', color: '#ef4444', icon: 'ArrowDownCircle', pipelinePosition: 12, order: 12, isFinal: true, isSuccess: false },
    { name: 'Pending', color: '#eab308', icon: 'Hourglass', pipelinePosition: 13, order: 13 }
  ];

  for (const s of defaultStatuses) {
    await Status.create({
      organizationId: salesOrg._id,
      ...s
    });
  }

  // Seed settings custom records (Departments, Products, Bank Masters, Banking Partners)
  console.log('Seeding settings module custom records...');
  const defaultDepts = [
    { name: 'Telemarketing', code: 'TELEMARKETING' },
    { name: 'Management', code: 'MANAGEMENT' },
    { name: 'SALES MANAGER', code: 'SALES_MANAGER' },
    { name: 'Accounts', code: 'ACCOUNTS' },
    { name: 'RELATIONSHIP MANAGER', code: 'RELATIONSHIP_MANAGER' },
    { name: 'PRODUCTS SALES MANAGER', code: 'PRODUCTS_SALES_MANAGER' },
    { name: 'AREA SALES MANAGER', code: 'AREA_SALES_MANAGER' },
    { name: 'PARTNER', code: 'PARTNER' },
    { name: 'BUSINESS CORRESPONDENT', code: 'BUSINESS_CORRESPONDENT' },
    { name: 'SPOKE', code: 'SPOKE' }
  ];

  for (const dept of defaultDepts) {
    await CustomRecord.create({
      organizationId: salesOrg._id,
      moduleId: departmentModule._id,
      data: { name: dept.name, code: dept.code },
      createdBy: salesAdmin._id,
      updatedBy: salesAdmin._id
    });
  }

  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: productModule._id,
    data: { name: 'SALARIED PERSONAL LOAN', code: 'SALARIED_PERSONAL_LOAN' },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: productModule._id,
    data: { name: 'BUSINESS LOAN', code: 'BUSINESS_LOAN' },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: productModule._id,
    data: { name: 'HOME LOAN', code: 'HOME_LOAN' },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: productModule._id,
    data: { name: 'LAP', code: 'LAP' },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });

  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: bankMasterModule._id,
    data: { bankName: 'State Bank of India', code: 'bank_sbi' },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: bankMasterModule._id,
    data: { bankName: 'HDFC Bank', code: 'bank_hdfc' },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: bankMasterModule._id,
    data: { bankName: 'ICICI Bank', code: 'bank_icici' },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: bankMasterModule._id,
    data: { bankName: 'Axis Bank', code: 'bank_axis' },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: bankMasterModule._id,
    data: { bankName: 'IndusInd Bank', code: 'bank_indusind' },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: bankMasterModule._id,
    data: { bankName: 'Kotak Mahindra Bank', code: 'bank_kotak' },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: bankMasterModule._id,
    data: { bankName: 'Punjab National Bank', code: 'bank_pnb' },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: bankMasterModule._id,
    data: { bankName: 'Bank of Baroda', code: 'bank_bob' },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: bankMasterModule._id,
    data: { bankName: 'Canara Bank', code: 'bank_canara' },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: bankMasterModule._id,
    data: { bankName: 'IDFC FIRST Bank', code: 'bank_idfc' },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });

  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: bankingPartnerModule._id,
    data: { bank: 'State Bank of India, HDFC Bank', loanType: 'LOAN AGAINST PROPERTY LOAN', psm: 'Ink CRM' },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });

  // Leads (Matching dashboard layout counts: 5 Hot, 1 Warm, 1 Doc Pending, 4 Disbursed, 3 Followup, 3 Dropped, 1 Today's Followup)
  console.log('Seeding Leads...');
  const today = new Date();
  
  // 5 Hot Leads
  for (let i = 1; i <= 5; i++) {
    await CustomRecord.create({
      organizationId: salesOrg._id,
      moduleId: leadModule._id,
      data: {
        firstName: `HotLead_${i}`,
        lastName: 'Test',
        company: 'LeadCorp',
        email: `hot_${i}@test.com`,
        status: 'Hot',
        source: 'Website',
        leadScore: 90,
        budget: 10000 + i * 2000,
        assignedTo: 'Ink CRM'
      },
      createdBy: salesAdmin._id,
      updatedBy: salesAdmin._id
    });
  }

  // 1 Warm Lead
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: leadModule._id,
    data: {
      firstName: 'WarmLead_1',
      lastName: 'Test',
      company: 'Acme Inc',
      email: 'warm@test.com',
      status: 'Warm',
      source: 'Referral',
      leadScore: 70,
      budget: 8000,
      assignedTo: 'Ink CRM'
    },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });

  // 1 Document Pending
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: leadModule._id,
    data: {
      firstName: 'DocPendingLead_1',
      lastName: 'Test',
      company: 'TechFlow',
      email: 'docpending@test.com',
      status: 'Document Pending',
      source: 'Cold Call',
      leadScore: 60,
      budget: 4500,
      assignedTo: 'Ink CRM'
    },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });

  // 4 Disbursed Leads
  for (let i = 1; i <= 4; i++) {
    await CustomRecord.create({
      organizationId: salesOrg._id,
      moduleId: leadModule._id,
      data: {
        firstName: `DisbursedLead_${i}`,
        lastName: 'Test',
        company: 'PartnerCorp',
        email: `disbursed_${i}@test.com`,
        status: 'Disbursed',
        source: 'Website',
        leadScore: 100,
        budget: 20000,
        assignedTo: 'Ink CRM'
      },
      createdBy: salesAdmin._id,
      updatedBy: salesAdmin._id
    });
  }

  // 3 Followup
  for (let i = 1; i <= 3; i++) {
    await CustomRecord.create({
      organizationId: salesOrg._id,
      moduleId: leadModule._id,
      data: {
        firstName: `FollowupLead_${i}`,
        lastName: 'Test',
        company: 'FollowInc',
        email: `follow_${i}@test.com`,
        status: 'Followup',
        source: 'Social Media',
        leadScore: 50,
        budget: 5000,
        assignedTo: 'Ink CRM',
        followUpDate: today // Set as today
      },
      createdBy: salesAdmin._id,
      updatedBy: salesAdmin._id
    });
  }

  // 3 Dropped Leads
  for (let i = 1; i <= 3; i++) {
    await CustomRecord.create({
      organizationId: salesOrg._id,
      moduleId: leadModule._id,
      data: {
        firstName: `DroppedLead_${i}`,
        lastName: 'Test',
        company: 'DropCorp',
        email: `dropped_${i}@test.com`,
        status: 'Dropped',
        source: 'Website',
        leadScore: 10,
        budget: 1500,
        assignedTo: 'Ink CRM'
      },
      createdBy: salesAdmin._id,
      updatedBy: salesAdmin._id
    });
  }

  // Standard seeded leads for backward compatibility
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: leadModule._id,
    data: {
      firstName: 'Sarah',
      lastName: 'Malone',
      company: 'TechFlow.ai',
      email: 'sarah@techflow.ai',
      phone: '123-456-7890',
      status: 'Negotiation',
      source: 'Website',
      leadScore: 85,
      budget: 18500,
      notes: '<p>Sarah is very interested in our payment integration platform.</p>',
      companyId: stripeCompany._id,
      followUpDate: today, // Today's follow-up list details
      assignedTo: 'Ink CRM'
    },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });

  // Deals
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: dealModule._id,
    data: {
      dealName: 'Apple Mobile Suite Deal',
      amount: 150000,
      stage: 'Proposal',
      closeDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
      probability: 60,
      companyId: appleCompany._id
    },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });

  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: dealModule._id,
    data: {
      dealName: 'Tesla Autopilot Licensing',
      amount: 300000,
      stage: 'Negotiation',
      closeDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      probability: 80,
      companyId: teslaCompany._id
    },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });

  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: dealModule._id,
    data: {
      dealName: 'Netflix CDN Optimization',
      amount: 90000,
      stage: 'Qualification',
      closeDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      probability: 40,
      companyId: netflixCompany._id
    },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });

  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: dealModule._id,
    data: {
      dealName: 'Stripe Global Extension',
      amount: 120000,
      stage: 'Closed Won',
      closeDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      probability: 100,
      companyId: stripeCompany._id
    },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });

  // --- Campaign Records ---
  console.log('Seeding Campaigns...');
  const mockCampaigns = [
    { campaignName: 'test raja', createdAt: new Date('2026-07-01T11:40:00') },
    { campaignName: 'apmc-cate-a -2k-4k-17-06-26', createdAt: new Date('2026-06-23T07:02:00') },
    { campaignName: 'b2b-b1-10k-20k-23-06-26', createdAt: new Date('2026-06-23T06:28:00') },
    { campaignName: 'apmc-cate-a-4k-12k-12-06-26', createdAt: new Date('2026-06-12T06:15:00') },
    { campaignName: 'vc-ka01-01-10k-11-06-26', createdAt: new Date('2026-06-11T08:55:00') },
    { campaignName: 'B2B-B2-25-35K-05-06-26', createdAt: new Date('2026-06-05T13:02:00') },
    { campaignName: 'KTK-PL-1001-1100-03-06-26', createdAt: new Date('2026-06-03T08:43:00') },
    { campaignName: 'crmdemo2', createdAt: new Date('2026-06-01T07:25:00') },
    { campaignName: 'B2B-F1-27-05-26', createdAt: new Date('2026-05-27T07:12:00') },
    { campaignName: 'GOVT-PL-DEMO-26-05-26', createdAt: new Date('2026-05-26T12:48:00') },
    { campaignName: 'BOMMANAHALLI-E-PL-26-05-26', createdAt: new Date('2026-05-26T09:13:00') },
    { campaignName: 'KA-PL-BLY-21-05-26', createdAt: new Date('2026-05-21T11:18:00') },
    { campaignName: 'B2B-B1-01 TO 10K-20-05-26', createdAt: new Date('2026-05-20T11:51:00') },
    { campaignName: 'ALAND-EPL-19-05-26', createdAt: new Date('2026-05-19T05:50:00') },
    { campaignName: 'KVB-DB-19-05-26', createdAt: new Date('2026-05-19T05:29:00') }
  ];

  for (const camp of mockCampaigns) {
    const doc = new CustomRecord({
      organizationId: salesOrg._id,
      moduleId: campaignModule._id,
      data: {
        campaignName: camp.campaignName,
        status: 'Active',
        type: 'Email',
        budget: 10000
      },
      createdBy: salesAdmin._id,
      updatedBy: salesAdmin._id,
      createdAt: camp.createdAt,
      updatedAt: camp.createdAt
    });
    await doc.save();
  }

  // --- Campaign Assignment Records ---
  await CustomRecord.create({
    organizationId: salesOrg._id,
    moduleId: campaignAssignmentModule._id,
    data: {
      assignmentName: 'Sarah Malone - Summer Promo 2026',
      campaign: 'Summer Promo 2026',
      lead: 'Sarah Malone',
      assignedDate: today
    },
    createdBy: salesAdmin._id,
    updatedBy: salesAdmin._id
  });

  // --- School Records ---
  const cs101Course = await CustomRecord.create({
    organizationId: schoolOrg._id,
    moduleId: courseModule._id,
    data: {
      courseCode: 'CS101',
      courseName: 'Introduction to Computer Science',
      credits: 4,
      department: 'Computer Science'
    },
    createdBy: schoolAdmin._id,
    updatedBy: schoolAdmin._id
  });

  await CustomRecord.create({
    organizationId: schoolOrg._id,
    moduleId: courseModule._id,
    data: {
      courseCode: 'MATH201',
      courseName: 'Advanced Calculus',
      credits: 3,
      department: 'Mathematics'
    },
    createdBy: schoolAdmin._id,
    updatedBy: schoolAdmin._id
  });

  await CustomRecord.create({
    organizationId: schoolOrg._id,
    moduleId: courseModule._id,
    data: {
      courseCode: 'PHYS301',
      courseName: 'Quantum Mechanics',
      credits: 4,
      department: 'Physics'
    },
    createdBy: schoolAdmin._id,
    updatedBy: schoolAdmin._id
  });

  // Students
  await CustomRecord.create({
    organizationId: schoolOrg._id,
    moduleId: studentModule._id,
    data: {
      studentId: 'STU-2026-001',
      fullName: 'Harry Potter',
      email: 'harry.potter@hogwarts.edu',
      dob: new Date('2008-07-31'),
      gradeLevel: 'Junior',
      gpa: 3.6
    },
    createdBy: schoolAdmin._id,
    updatedBy: schoolAdmin._id
  });

  await CustomRecord.create({
    organizationId: schoolOrg._id,
    moduleId: studentModule._id,
    data: {
      studentId: 'STU-2026-002',
      fullName: 'Hermione Granger',
      email: 'hermione@hogwarts.edu',
      dob: new Date('2008-09-19'),
      gradeLevel: 'Senior',
      gpa: 4.0
    },
    createdBy: schoolAdmin._id,
    updatedBy: schoolAdmin._id
  });

  await CustomRecord.create({
    organizationId: schoolOrg._id,
    moduleId: studentModule._id,
    data: {
      studentId: 'STU-2026-003',
      fullName: 'Ron Weasley',
      email: 'ron@hogwarts.edu',
      dob: new Date('2008-03-01'),
      gradeLevel: 'Junior',
      gpa: 2.8
    },
    createdBy: schoolAdmin._id,
    updatedBy: schoolAdmin._id
  });

  await CustomRecord.create({
    organizationId: schoolOrg._id,
    moduleId: studentModule._id,
    data: {
      studentId: 'STU-2026-004',
      fullName: 'Draco Malfoy',
      email: 'draco@hogwarts.edu',
      dob: new Date('2008-06-05'),
      gradeLevel: 'Senior',
      gpa: 3.4
    },
    createdBy: schoolAdmin._id,
    updatedBy: schoolAdmin._id
  });

  // --- Hospital Records ---
  const patientAlice = await CustomRecord.create({
    organizationId: hospitalOrg._id,
    moduleId: patientModule._id,
    data: {
      mrn: 'MRN-4493-2',
      fullName: 'Alice Wonders',
      dob: new Date('1992-04-10'),
      bloodGroup: 'O+',
      allergies: 'Penicillin',
      emergencyPhone: '555-019-2834'
    },
    createdBy: hospitalAdmin._id,
    updatedBy: hospitalAdmin._id
  });

  const patientBob = await CustomRecord.create({
    organizationId: hospitalOrg._id,
    moduleId: patientModule._id,
    data: {
      mrn: 'MRN-1029-3',
      fullName: 'Bob Builder',
      dob: new Date('1985-05-12'),
      bloodGroup: 'A+',
      allergies: 'None',
      emergencyPhone: '555-021-9988'
    },
    createdBy: hospitalAdmin._id,
    updatedBy: hospitalAdmin._id
  });

  const patientCharlie = await CustomRecord.create({
    organizationId: hospitalOrg._id,
    moduleId: patientModule._id,
    data: {
      mrn: 'MRN-8849-1',
      fullName: 'Charlie Brown',
      dob: new Date('2001-10-30'),
      bloodGroup: 'B-',
      allergies: 'Peanuts',
      emergencyPhone: '555-102-4433'
    },
    createdBy: hospitalAdmin._id,
    updatedBy: hospitalAdmin._id
  });

  // Appointments
  await CustomRecord.create({
    organizationId: hospitalOrg._id,
    moduleId: appointmentModule._id,
    data: {
      appointmentDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      doctorName: 'Dr. Gregory House',
      status: 'Scheduled',
      reason: '<p>Routine diagnostic follow-up on allergy sensitivity.</p>',
      patientId: patientAlice._id
    },
    createdBy: hospitalAdmin._id,
    updatedBy: hospitalAdmin._id
  });

  await CustomRecord.create({
    organizationId: hospitalOrg._id,
    moduleId: appointmentModule._id,
    data: {
      appointmentDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
      doctorName: 'Dr. Allison Cameron',
      status: 'Scheduled',
      reason: '<p>Annual cardiovascular diagnostic test.</p>',
      patientId: patientBob._id
    },
    createdBy: hospitalAdmin._id,
    updatedBy: hospitalAdmin._id
  });

  await CustomRecord.create({
    organizationId: hospitalOrg._id,
    moduleId: appointmentModule._id,
    data: {
      appointmentDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      doctorName: 'Dr. Eric Foreman',
      status: 'Completed',
      reason: '<p>Follow up consultation.</p>',
      patientId: patientCharlie._id
    },
    createdBy: hospitalAdmin._id,
    updatedBy: hospitalAdmin._id
  });

  console.log('Custom Records seeded.');

  // 6. Seed Workflows
  console.log('Seeding Workflows...');
  await Workflow.create({
    organizationId: salesOrg._id,
    moduleId: leadModule._id,
    name: 'Qualified Lead Automation',
    trigger: {
      event: 'update',
      fieldTrigger: 'status'
    },
    conditions: [
      {
        field: 'status',
        operator: 'equals',
        value: 'Qualified'
      }
    ],
    actions: [
      {
        type: 'create_task',
        params: {
          title: 'Immediate Call: Qualified Lead Follow-up',
          description: 'A lead was marked Qualified. Ring them up and progress them into Deal Stage.',
          priority: 'High'
        }
      },
      {
        type: 'notification',
        params: {
          title: 'Lead Qualified!',
          message: 'Lead status changed to Qualified. Lead Score updated.'
        }
      }
    ],
    isEnabled: true
  });
  console.log('Workflows seeded.');

  // 7. Seed Dashboard layouts
  console.log('Seeding Dashboard Layouts...');
  await DashboardLayout.create({
    organizationId: salesOrg._id,
    userId: salesAdmin._id,
    name: 'Sales Overview',
    isDefault: true,
    widgets: [
      { id: 'widget_1', type: 'leads_count', title: 'Total Leads', x: 0, y: 0, w: 4, h: 2, config: {} },
      { id: 'widget_2', type: 'deals_count', title: 'Open Deals', x: 4, y: 0, w: 4, h: 2, config: {} },
      { id: 'widget_3', type: 'revenue', title: 'Revenue Closed', x: 8, y: 0, w: 4, h: 2, config: {} },
      { id: 'widget_4', type: 'sales_funnel', title: 'Sales Pipeline Funnel', x: 0, y: 2, w: 8, h: 4, config: {} },
      { id: 'widget_5', type: 'recent_activities', title: 'Recent Activity Timeline', x: 8, y: 2, w: 4, h: 4, config: {} }
    ]
  });

  await DashboardLayout.create({
    organizationId: schoolOrg._id,
    userId: schoolAdmin._id,
    name: 'School Portal Dashboard',
    isDefault: true,
    widgets: [
      { id: 'sch_widget_1', type: 'students_count', title: 'Enrolled Students', x: 0, y: 0, w: 6, h: 2, config: {} },
      { id: 'sch_widget_2', type: 'courses_count', title: 'Active Courses', x: 6, y: 0, w: 6, h: 2, config: {} }
    ]
  });

  await DashboardLayout.create({
    organizationId: hospitalOrg._id,
    userId: hospitalAdmin._id,
    name: 'Clinical Operations Dashboard',
    isDefault: true,
    widgets: [
      { id: 'hosp_widget_1', type: 'patients_count', title: 'Active Patients', x: 0, y: 0, w: 6, h: 2, config: {} },
      { id: 'hosp_widget_2', type: 'appointments_count', title: 'Today\'s Visits', x: 6, y: 0, w: 6, h: 2, config: {} }
    ]
  });

  console.log('Dashboard Layouts seeded.');

  console.log('Database Seeding Completed Successfully!');
}

export async function seedDatabase(shouldDisconnect = false): Promise<void> {
  await seed();
  if (shouldDisconnect) {
    await mongoose.disconnect();
  }
}

export async function seedNewTenantData(organizationId: mongoose.Types.ObjectId) {
  // 1. Create Module Definitions (Lead, Deal, Company)
  const leadModule = await ModuleDefinition.create({
    organizationId,
    name: 'Lead',
    singularLabel: 'Lead',
    pluralLabel: 'Leads',
    apiPath: 'leads',
    icon: 'UserPlus',
    isSystem: true,
    fields: [
      {
        name: 'source',
        label: 'Source',
        type: 'dropdown',
        required: false,
        unique: false,
        options: ['Website', 'Referral', 'Cold Call', 'Social Media', 'Rajabaksh Ilyala']
      },
      {
        name: 'loanType',
        label: 'Loan Type',
        type: 'dropdown',
        required: true,
        unique: false,
        defaultValue: 'SALARIED PERSONAL LOAN',
        options: ['SALARIED PERSONAL LOAN', 'BUSINESS LOAN', 'HOME LOAN', 'LAP']
      },
      { name: 'budget', label: 'Loan Amount', type: 'currency', required: false, unique: false },
      { name: 'dataCode', label: 'Data Code', type: 'text', required: false, unique: false },
      {
        name: 'status',
        label: 'Status',
        type: 'dropdown',
        required: true,
        unique: false,
        defaultValue: 'New',
        options: [
          'New',
          'Hot',
          'Warm',
          'Cedil Pending',
          'Document Pending',
          'Approval Pending',
          'Approved',
          'Disbursed',
          'Rejected',
          'Followup',
          'Dropped',
          'Pending'
        ]
      },
      { name: 'bankName', label: 'Bank Name', type: 'text', required: false, unique: false }
    ]
  });

  const companyModule = await ModuleDefinition.create({
    organizationId,
    name: 'Company',
    singularLabel: 'Company',
    pluralLabel: 'Companies',
    apiPath: 'companies',
    icon: 'Building2',
    isSystem: true,
    fields: [
      { name: 'companyName', label: 'Company Name', type: 'text', required: true, unique: true },
      { name: 'website', label: 'Website', type: 'text', required: false, unique: false },
      { name: 'employees', label: 'Employees', type: 'number', required: false, unique: false },
      { name: 'industry', label: 'Industry', type: 'text', required: false, unique: false }
    ]
  });

  const dealModule = await ModuleDefinition.create({
    organizationId,
    name: 'Deal',
    singularLabel: 'Deal',
    pluralLabel: 'Deals',
    apiPath: 'deals',
    icon: 'Briefcase',
    isSystem: true,
    fields: [
      { name: 'dealName', label: 'Deal Name', type: 'text', required: true, unique: false },
      { name: 'amount', label: 'Amount', type: 'currency', required: true, unique: false },
      { name: 'stage', label: 'Stage', type: 'text', required: true, unique: false },
      { name: 'closingDate', label: 'Closing Date', type: 'date', required: false, unique: false }
    ]
  });

  // 2. Create default statuses
  const defaultStatuses = [
    { name: 'New', color: '#6366f1', icon: 'Sparkles', pipelinePosition: 1, order: 1 },
    { name: 'Hot', color: '#ef4444', icon: 'Flame', pipelinePosition: 2, order: 2 },
    { name: 'Warm', color: '#f59e0b', icon: 'Sun', pipelinePosition: 3, order: 3 },
    { name: 'Not Reachable', color: '#94a3b8', icon: 'PhoneMissed', pipelinePosition: 4, order: 4 },
    { name: 'Cedil Pending', color: '#ec4899', icon: 'FileWarning', pipelinePosition: 5, order: 5 },
    { name: 'Document Pending', color: '#14b8a6', icon: 'FileText', pipelinePosition: 6, order: 6 },
    { name: 'Approval Pending', color: '#f97316', icon: 'Clock', pipelinePosition: 7, order: 7 },
    { name: 'Approved', color: '#10b981', icon: 'CheckCircle', pipelinePosition: 8, order: 8 },
    { name: 'Disbursed', color: '#10b981', icon: 'Banknote', pipelinePosition: 9, order: 9, isFinal: true, isSuccess: true },
    { name: 'Rejected', color: '#ef4444', icon: 'XOctagon', pipelinePosition: 10, order: 10, isFinal: true, isSuccess: false },
    { name: 'Followup', color: '#3b82f6', icon: 'PhoneCall', pipelinePosition: 11, order: 11 },
    { name: 'Dropped', color: '#ef4444', icon: 'ArrowDownCircle', pipelinePosition: 12, order: 12, isFinal: true, isSuccess: false },
    { name: 'Pending', color: '#eab308', icon: 'Hourglass', pipelinePosition: 13, order: 13 }
  ];

  for (const s of defaultStatuses) {
    await Status.create({
      organizationId,
      ...s
    });
  }

  // 3. Create default dashboard layout
  await DashboardLayout.create({
    organizationId,
    name: 'Sales Dashboard',
    isDefault: true,
    widgets: [
      { id: 'widget_1', type: 'leads_funnel', title: 'Leads Funnel', x: 0, y: 0, w: 12, h: 4, config: {} }
    ]
  });

  // 4. Create some sample Leads (CustomRecord)
  const sampleLeads = [
    {
      firstName: 'Raja',
      lastName: 'Baksh',
      email: 'raja.baksh@gmail.com',
      phone: '9876543210',
      status: 'New',
      loanType: 'SALARIED PERSONAL LOAN',
      budget: 500000,
      source: 'Website',
      bankName: 'HDFC Bank'
    },
    {
      firstName: 'Suma',
      lastName: 'Dhar',
      email: 'suma.dhar@yahoo.com',
      phone: '8765432109',
      status: 'Followup',
      loanType: 'BUSINESS LOAN',
      budget: 1500000,
      source: 'Referral',
      bankName: 'ICICI Bank'
    },
    {
      firstName: 'Ankit',
      lastName: 'Sharma',
      email: 'ankit.sharma@outlook.com',
      phone: '7654321098',
      status: 'Document Pending',
      loanType: 'HOME LOAN',
      budget: 3500000,
      source: 'Cold Call',
      bankName: 'SBI'
    }
  ];

  for (const lead of sampleLeads) {
    await CustomRecord.create({
      organizationId,
      moduleId: leadModule._id,
      data: lead
    });
  }

  console.log(`Successfully seeded sample data for new organization: ${organizationId}`);
}

if (require.main === module) {
  seedDatabase(true).catch((err) => {
    console.error('Error seeding database:', err);
    process.exit(1);
  });
}
